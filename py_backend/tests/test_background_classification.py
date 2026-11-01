"""
The background rule (transparent / flat / chroma / complex) and reading order.

The classification cases are shared with the Node backend: the same PNG sheets and expected answers
(backend/src/__tests__/fixtures/background-cases) are read by backend/src/__tests__/background.test.ts,
so the two implementations of the rule cannot drift apart unnoticed.
"""
import json
import random
import unittest
from pathlib import Path

import cv2
import numpy as np

from app.services.detection import classify_background, find_bounding_boxes, reading_order

CASES_DIR = Path(__file__).resolve().parents[2] / "backend" / "src" / "__tests__" / "fixtures" / "background-cases"


@unittest.skipUnless((CASES_DIR / "cases.json").exists(), "shared fixtures not checked out")
class SharedBackgroundCases(unittest.TestCase):
    def test_every_shared_sheet_gets_the_expected_kind_and_colour(self) -> None:
        cases = json.loads((CASES_DIR / "cases.json").read_text())
        self.assertGreaterEqual(len(cases), 15)
        for case in cases:
            with self.subTest(case["file"]):
                img = cv2.imdecode(np.fromfile(str(CASES_DIR / case["file"]), np.uint8), cv2.IMREAD_UNCHANGED)
                got = classify_background(img)
                self.assertEqual(got["kind"], case["kind"], case["note"])
                self.assertEqual(got["color"], case["color"], case["note"])


class DetectionReturnsTheBackground(unittest.TestCase):
    def _sheet(self) -> np.ndarray:
        img = np.full((340, 460, 3), 245, dtype=np.uint8)
        img[60:140, 60:140] = (30, 60, 220)
        return img

    def test_find_bounding_boxes_reports_the_background(self) -> None:
        self.assertEqual(find_bounding_boxes(self._sheet())["background"], {"kind": "flat", "color": "#f5f5f5"})

    def test_a_user_picked_colour_does_not_change_what_the_image_is(self) -> None:
        self.assertEqual(find_bounding_boxes(self._sheet(), "sampled", "#282828")["background"]["kind"], "flat")


def _grid(rows: int, cols: int, jitter: int, seed: int, size: int = 60, pitch: int = 100) -> list[tuple[int, int, int, int]]:
    """Boxes of a rows x cols grid in reading order, each nudged by up to `jitter` px, as (x, y, w, h)."""
    rng = random.Random(seed)
    return [
        (c * pitch + rng.randint(-jitter, jitter), r * pitch + rng.randint(-jitter, jitter), size, size)
        for r in range(rows)
        for c in range(cols)
    ]


class ReadingOrder(unittest.TestCase):
    def test_a_jittered_5x6_grid_comes_out_row_by_row(self) -> None:
        # 5 rows x 6 columns of round logos, each off its grid point by up to 14 px, the way the owner's sheet
        # had one logo of the last row sitting a little higher than its neighbours.
        for seed in range(25):
            truth = _grid(5, 6, jitter=14, seed=seed)
            shuffled = truth[:]
            random.Random(seed + 100).shuffle(shuffled)
            self.assertEqual(reading_order(shuffled), truth, f"seed {seed}")

    def test_the_old_fifty_pixel_banding_was_wrong_here(self) -> None:
        # The old key (y // 50, x) put the box at y=48 in a band above the one at y=52 whatever their x:
        # these two are one row, so the left one comes first.
        boxes = [(300, 48, 50, 50), (10, 52, 50, 50), (10, 160, 50, 50), (300, 158, 50, 50)]
        self.assertEqual(
            reading_order(boxes),
            [(10, 52, 50, 50), (300, 48, 50, 50), (10, 160, 50, 50), (300, 158, 50, 50)],
        )

    def test_logos_of_different_heights_stay_in_their_row(self) -> None:
        boxes = [(0, 0, 50, 100), (100, 25, 50, 50), (200, 10, 50, 80), (0, 200, 50, 100), (100, 225, 50, 50)]
        ordered = reading_order(boxes[::-1])
        self.assertEqual([b[0] for b in ordered], [0, 100, 200, 0, 100])
        self.assertEqual([b[1] for b in ordered], [0, 25, 10, 200, 225])

    def test_a_slanted_sheet_does_not_merge_rows(self) -> None:
        # Each row drifts 4 px down per column (a skewed scan); rows are 100 px apart.
        boxes = [(c * 80, r * 100 + c * 4, 60, 60) for r in range(3) for c in range(8)]
        shuffled = boxes[:]
        random.Random(1).shuffle(shuffled)
        self.assertEqual(reading_order(shuffled), boxes)

    def test_none_and_one_box(self) -> None:
        self.assertEqual(reading_order([]), [])
        self.assertEqual(reading_order([(5, 5, 10, 10)]), [(5, 5, 10, 10)])

    def test_find_bounding_boxes_numbers_assets_in_reading_order(self) -> None:
        img = np.full((420, 640, 3), 245, dtype=np.uint8)
        rng = random.Random(4)
        placed = []
        for r in range(3):
            for c in range(4):
                x = 30 + c * 150 + rng.randint(-12, 12)
                y = 30 + r * 120 + rng.randint(-12, 12)
                img[y : y + 60, x : x + 60] = (30, 60, 220)
                placed.append((x, y))
        result = find_bounding_boxes(img)
        self.assertEqual([b.name for b in result["boxes"]], [f"asset_{i:03d}" for i in range(1, 13)])
        for box, (x, y) in zip(result["boxes"], placed):
            self.assertLessEqual(abs(box.x - x) + abs(box.y - y), 6)


if __name__ == "__main__":
    unittest.main()
