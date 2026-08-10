import unittest

import cv2
import numpy as np

from app.routers.enhance import _stroke_clarity


class StrokeClarityTests(unittest.TestCase):
    def test_sharpens_blurred_text_without_changing_the_background(self) -> None:
        clean = np.full((220, 700, 3), (25, 19, 15), dtype=np.uint8)
        cv2.putText(clean, "Transformer Block", (32, 110), cv2.FONT_HERSHEY_SIMPLEX, 1.35, (235, 210, 110), 2, cv2.LINE_AA)
        cv2.rectangle(clean, (30, 135), (670, 190), (90, 210, 150), 2, cv2.LINE_AA)
        blurred = cv2.GaussianBlur(clean, (0, 0), 1.6)

        enhanced = _stroke_clarity(blurred, np.full(blurred.shape[:2], 255, dtype=np.uint8), clarity=7, speck_removal=1)

        clean_gray = cv2.cvtColor(clean, cv2.COLOR_BGR2GRAY).astype(np.float32)
        blurred_gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY).astype(np.float32)
        enhanced_gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY).astype(np.float32)
        text_area = np.s_[60:205, 20:690]
        self.assertLess(
            np.mean((enhanced_gray[text_area] - clean_gray[text_area]) ** 2),
            np.mean((blurred_gray[text_area] - clean_gray[text_area]) ** 2),
        )

        background_area = np.s_[0:30, 0:700]
        self.assertLess(float(np.mean(np.abs(enhanced_gray[background_area] - blurred_gray[background_area]))), 1.5)

    def test_zero_clarity_returns_the_source_pixels(self) -> None:
        image = np.random.default_rng(7).integers(0, 256, (32, 32, 3), dtype=np.uint8)
        alpha = np.full((32, 32), 255, dtype=np.uint8)
        self.assertTrue(np.array_equal(_stroke_clarity(image, alpha, clarity=0, speck_removal=10), image))


if __name__ == "__main__":
    unittest.main()
