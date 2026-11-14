import unittest

import numpy as np

from app.services.detection import DEFAULT_THRESHOLD, find_bounding_boxes


def _sheet() -> np.ndarray:
    """A black sheet with a solid sprite and two faint smudges (gray 24 and 8)."""
    img = np.zeros((240, 520, 3), dtype=np.uint8)
    img[30:110, 30:110] = (240, 200, 60)  # solid sprite
    img[30:110, 200:280] = (24, 24, 24)  # smudge A: above the default cut-off (15)
    img[30:110, 370:450] = (8, 8, 8)  # smudge B: below the default cut-off
    return img


def _count(threshold: int) -> int:
    return len(find_bounding_boxes(_sheet(), "dark", None, threshold)["boxes"])


class DetectionThresholdTests(unittest.TestCase):
    def test_default_threshold_is_the_unchanged_behaviour(self) -> None:
        img = _sheet()
        baseline = find_bounding_boxes(img, "dark")
        explicit = find_bounding_boxes(img, "dark", None, DEFAULT_THRESHOLD)
        self.assertEqual(
            [(b.x, b.y, b.width, b.height) for b in baseline["boxes"]],
            [(b.x, b.y, b.width, b.height) for b in explicit["boxes"]],
        )
        # The default cut-off of 15 keeps the sprite and smudge A, not smudge B.
        self.assertEqual(len(baseline["boxes"]), 2)

    def test_lower_threshold_is_more_sensitive(self) -> None:
        # At 10 the cut-off drops to 3: all three shapes are foreground.
        self.assertEqual(_count(10), 3)

    def test_higher_threshold_ignores_faint_shapes(self) -> None:
        # At 100 the cut-off doubles to 30: only the sprite is left.
        self.assertEqual(_count(100), 1)


if __name__ == "__main__":
    unittest.main()
