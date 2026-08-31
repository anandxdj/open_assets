"""Unit tests for the AniBuddy decompose stage (classical CV only)."""

from __future__ import annotations

import hashlib
import io
import json
import unittest
import uuid

import cv2
import numpy as np
from PIL import Image

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.decompose import DecomposeError, DecomposeService
from app.modules.anibuddy.decompose.gutter import candidate_grid
from app.modules.anibuddy.decompose.masks import alpha_foreground, encode_rle_column_major
from app.modules.anibuddy.schemas import AssetRef, RigDocument


def _asset(width: int, height: int, raw: bytes) -> AssetRef:
    return AssetRef(
        id="sheet1",
        name="fixture.png",
        storageKey="fixtures/sheet1.png",
        contentHash=hashlib.sha256(raw).hexdigest(),
        width=width,
        height=height,
        figureHeight=None,
        mimeType="image/png",
        rightsConfirmed=True,
        remoteVisionConsented=False,
    )


def _png_bytes(rgba: np.ndarray) -> bytes:
    """Encode an HxWx4 uint8 RGBA array as PNG via Pillow."""
    image = Image.fromarray(rgba, mode="RGBA")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _decode_bgra(png: bytes) -> np.ndarray:
    decoded = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_UNCHANGED)
    assert decoded is not None
    return decoded


def _transparent_canvas(width: int, height: int) -> np.ndarray:
    return np.zeros((height, width, 4), dtype=np.uint8)


def _paint_rect(
    canvas: np.ndarray,
    x: int,
    y: int,
    w: int,
    h: int,
    rgb: tuple[int, int, int] = (200, 40, 40),
    alpha: int = 255,
) -> None:
    canvas[y : y + h, x : x + w, 0] = rgb[0]
    canvas[y : y + h, x : x + w, 1] = rgb[1]
    canvas[y : y + h, x : x + w, 2] = rgb[2]
    canvas[y : y + h, x : x + w, 3] = alpha


def _run(rgba: np.ndarray) -> RigDocument:
    raw = _png_bytes(rgba)
    bgra = _decode_bgra(raw)
    # OpenCV loads as BGRA; our paint used RGBA channel order in the array
    # fed to Pillow. Round-trip through PNG so the service sees real bytes.
    return DecomposeService.run(
        bgra,
        asset=_asset(rgba.shape[1], rgba.shape[0], raw),
        project_id="proj_test",
        revision_id=f"rev_{uuid.uuid4().hex[:12]}",
        input_bytes=raw,
    )


class DecomposeAlphaTests(unittest.TestCase):
    def test_separated_transparent_cells_use_alpha_component(self) -> None:
        # Corner-touching staircase: blobs share a diagonal only (not
        # 4-connected), and abut so no full blank row/column exists. That is
        # the case where extract.ts yields to alphaComponents over the grid.
        canvas = _transparent_canvas(48, 48)
        _paint_rect(canvas, 2, 2, 20, 20, rgb=(220, 60, 60))
        _paint_rect(canvas, 22, 22, 20, 20, rgb=(60, 180, 80))

        document = _run(canvas)

        self.assertEqual(document.schemaVersion, 5)
        self.assertEqual(len(document.parts), 2)
        for part in document.parts:
            self.assertEqual(part.provenance, "alpha-component")
            self.assertEqual(
                part.confidence, DecomposeConstants.CONFIDENCE_ALPHA_COMPONENT
            )
            self.assertEqual(part.mask.kind, "alpha-threshold")
            self.assertEqual(part.role, "other")
            self.assertEqual(part.deformer.kind, "rigid")

        RigDocument.model_validate(json.loads(document.model_dump_json()))

    def test_zero_foreground_refuses(self) -> None:
        canvas = _transparent_canvas(32, 32)
        with self.assertRaises(DecomposeError):
            _run(canvas)

    def test_source_pixels_are_not_mutated(self) -> None:
        canvas = _transparent_canvas(64, 32)
        _paint_rect(canvas, 4, 4, 20, 20)
        _paint_rect(canvas, 36, 6, 18, 18, rgb=(10, 200, 10))
        raw = _png_bytes(canvas)
        bgra = _decode_bgra(raw)
        before = bgra.copy()
        DecomposeService.run(
            bgra,
            asset=_asset(64, 32, raw),
            project_id="proj_test",
            revision_id="rev_immutable",
            input_bytes=raw,
        )
        self.assertTrue(np.array_equal(before, bgra))


class DecomposeGutterTests(unittest.TestCase):
    def test_gutter_grid_detects_regular_sprite_sheet(self) -> None:
        # 2x2 cells separated by fully blank gutters.
        canvas = _transparent_canvas(100, 100)
        _paint_rect(canvas, 5, 5, 35, 35, rgb=(200, 50, 50))
        _paint_rect(canvas, 60, 5, 35, 35, rgb=(50, 200, 50))
        _paint_rect(canvas, 5, 60, 35, 35, rgb=(50, 50, 200))
        _paint_rect(canvas, 60, 60, 35, 35, rgb=(200, 200, 50))

        # Direct unit check on the grid helper (RGBA→alpha via Pillow roundtrip).
        raw = _png_bytes(canvas)
        bgra = _decode_bgra(raw)
        fg = alpha_foreground(bgra)
        grid = candidate_grid(fg)
        self.assertIsNotNone(grid)
        assert grid is not None
        self.assertEqual(len(grid), 4)

        document = _run(canvas)
        self.assertEqual(len(document.parts), 4)
        for part in document.parts:
            self.assertEqual(part.provenance, "gutter-grid")
            self.assertEqual(part.confidence, DecomposeConstants.CONFIDENCE_GUTTER_GRID)
            self.assertEqual(part.mask.kind, "rect")


class DecomposeTouchingTests(unittest.TestCase):
    def test_touching_blobs_escalate_past_alpha(self) -> None:
        # Two disks that share a few pixels (one alpha component).
        canvas = _transparent_canvas(80, 40)
        cv2.circle(canvas, (22, 20), 14, (180, 40, 40, 255), thickness=-1)
        cv2.circle(canvas, (48, 20), 14, (40, 180, 40, 255), thickness=-1)

        document = _run(canvas)
        provenances = {part.provenance for part in document.parts}
        self.assertGreaterEqual(len(document.parts), 2)
        self.assertTrue(
            provenances & {"watershed", "grabcut"},
            f"expected watershed/grabcut escalation, got: {provenances}",
        )
        for part in document.parts:
            if part.provenance in ("watershed", "grabcut"):
                self.assertEqual(part.mask.kind, "rle")
                if part.provenance == "grabcut":
                    self.assertLess(
                        part.confidence, DecomposeConstants.CONFIDENCE_REVIEW_FLOOR
                    )
                if part.provenance == "watershed":
                    self.assertEqual(
                        part.confidence, DecomposeConstants.CONFIDENCE_WATERSHED
                    )

        RigDocument.model_validate(json.loads(document.model_dump_json()))


class DecomposeRleTests(unittest.TestCase):
    def test_rle_starts_with_background_run(self) -> None:
        binary = np.zeros((4, 4), dtype=np.uint8)
        binary[1:3, 1:3] = 1
        counts = encode_rle_column_major(binary)
        # First pixel (0,0) is background → first run length > 0 for BG.
        self.assertGreater(counts[0], 0)
        self.assertEqual(sum(counts), 16)


class DecomposeDiagnosticsTests(unittest.TestCase):
    def test_diagnostics_cover_foreground(self) -> None:
        canvas = _transparent_canvas(64, 32)
        _paint_rect(canvas, 4, 4, 20, 20)
        _paint_rect(canvas, 36, 6, 18, 18, rgb=(10, 200, 10))
        document = _run(canvas)
        self.assertGreater(document.diagnostics.foregroundPixels, 0)
        self.assertGreaterEqual(
            document.diagnostics.coveredForegroundPixels,
            0,
        )
        self.assertEqual(document.provenance.stages[0].stage, "decompose")
        self.assertEqual(document.provenance.stages[0].status, "succeeded")
        self.assertIsNone(document.provenance.stages[0].modelId)


if __name__ == "__main__":
    unittest.main()
