import base64
import unittest
from unittest import mock

import cv2
import numpy as np
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.routers import crop as crop_router
from app.services import image_io


def _sheet() -> np.ndarray:
    img = np.zeros((100, 200, 4), dtype=np.uint8)
    img[10:50, 10:60] = (10, 200, 30, 255)
    return img


class InlineCropTests(unittest.TestCase):
    def _post(self, inline: bool) -> dict:
        async def fake_download(_url: str) -> np.ndarray:
            return _sheet()

        with mock.patch.object(crop_router, "download_image", fake_download):
            res = TestClient(app).post(
                "/crop",
                json={
                    "image_url": "http://oa-e2e.localhost:4110/storage/originals/x.png",
                    "job_id": "job-1",
                    "inline": inline,
                    "boxes": [
                        {"id": "box_1", "x": 10, "y": 10, "width": 50, "height": 40, "name": "asset_001"},
                        {"id": "box_2", "x": 500, "y": 500, "width": 5, "height": 5, "name": "outside"},
                    ],
                },
            )
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_inline_crop_returns_png_bytes_and_uploads_nothing(self) -> None:
        with mock.patch("app.services.cloudinary_client.upload_bytes") as upload:
            body = self._post(inline=True)
        upload.assert_not_called()
        self.assertEqual(len(body["assets"]), 1)
        asset = body["assets"][0]
        self.assertEqual((asset["id"], asset["name"]), ("box_1", "asset_001"))
        self.assertEqual(asset["cropped_url"], "")
        png = cv2.imdecode(np.frombuffer(base64.b64decode(asset["data_base64"]), np.uint8), cv2.IMREAD_UNCHANGED)
        self.assertEqual(png.shape, (40, 50, 4))
        self.assertTrue((png[:, :, 3] == 255).all())

    def test_default_crop_still_uploads(self) -> None:
        fake = {"secure_url": "https://res.cloudinary.com/x/a.png", "public_id": "open_assets/crops/job-1/asset_001"}
        with mock.patch("app.services.cloudinary_client.upload_bytes", return_value=fake) as upload:
            body = self._post(inline=False)
        upload.assert_called_once()
        asset = body["assets"][0]
        self.assertEqual(asset["cropped_url"], fake["secure_url"])
        self.assertEqual(asset["public_id"], fake["public_id"])
        self.assertIsNone(asset["data_base64"])


class ImageUrlPolicyTests(unittest.TestCase):
    def _check(self, url: str, *, private: bool, hosts: str) -> None:
        with mock.patch.object(image_io.settings, "ALLOW_PRIVATE_IMAGE_HOSTS", private), mock.patch.object(
            image_io.settings, "ALLOWED_IMAGE_HOSTS", hosts
        ):
            image_io._validate_image_url(url)

    def test_default_policy_is_unchanged(self) -> None:
        self._check("https://res.cloudinary.com/x/a.png", private=False, hosts="res.cloudinary.com,cloudinary.com")
        for url in (
            "http://res.cloudinary.com/x/a.png",
            "https://localhost/x.png",
            "https://127.0.0.1/x.png",
            "https://evil.example.com/x.png",
        ):
            with self.assertRaises(HTTPException, msg=url):
                self._check(url, private=False, hosts="res.cloudinary.com,cloudinary.com")

    def test_local_mode_allows_http_loopback_but_only_listed_hosts(self) -> None:
        hosts = "oa-e2e.localhost,127.0.0.1"
        self._check("http://oa-e2e.localhost:4110/storage/a.png", private=True, hosts=hosts)
        self._check("http://127.0.0.1:4110/storage/a.png", private=True, hosts=hosts)
        for url in (
            "http://169.254.169.254/latest/meta-data",
            "http://localhost:4110/storage/a.png",
            "http://evil.example.com/a.png",
            "http://oa-e2e.localhost.evil.com/a.png",
            "file:///etc/passwd",
            "ftp://oa-e2e.localhost/a.png",
        ):
            with self.assertRaises(HTTPException, msg=url):
                self._check(url, private=True, hosts=hosts)

    def test_local_mode_without_an_allowlist_refuses_everything(self) -> None:
        with self.assertRaises(HTTPException):
            self._check("http://127.0.0.1:4110/storage/a.png", private=True, hosts="")


if __name__ == "__main__":
    unittest.main()
