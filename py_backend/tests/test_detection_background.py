import unittest

import numpy as np

from app.services.detection import border_flatness, find_bounding_boxes


def _sprites(img: np.ndarray) -> np.ndarray:
    img[60:140, 60:140] = (30, 60, 220)
    img[60:140, 300:380] = (40, 200, 40)
    img[200:280, 180:260] = (220, 120, 20)
    return img


def _flat() -> np.ndarray:
    return _sprites(np.full((340, 460, 3), 245, dtype=np.uint8))


def _gradient() -> np.ndarray:
    ramp = np.linspace(40, 235, 460, dtype=np.float32)
    img = np.dstack([np.tile(ramp, (340, 1))] * 3).astype(np.uint8)
    return _sprites(img)


def _noisy_texture() -> np.ndarray:
    rng = np.random.default_rng(7)
    img = np.clip(rng.normal(150, 45, (340, 460, 3)), 0, 255).astype(np.uint8)
    return _sprites(img)


class UnevenBackgroundTests(unittest.TestCase):
    def test_a_flat_sheet_is_not_flagged(self) -> None:
        result = find_bounding_boxes(_flat())
        self.assertEqual(len(result["boxes"]), 3)
        self.assertIsNone(result["detection_warning"])
        self.assertGreater(border_flatness(_flat()), 0.99)

    def test_a_slightly_noisy_flat_sheet_is_not_flagged(self) -> None:
        rng = np.random.default_rng(3)
        img = np.clip(245 + rng.integers(-3, 4, (340, 460, 3)), 0, 255).astype(np.uint8)
        self.assertIsNone(find_bounding_boxes(_sprites(img))["detection_warning"])

    def test_a_gradient_background_says_so(self) -> None:
        result = find_bounding_boxes(_gradient())
        self.assertLess(border_flatness(_gradient()), 0.85)
        self.assertIn("gradient or texture", result["detection_warning"] or "")

    def test_a_textured_background_says_so(self) -> None:
        self.assertIn("gradient or texture", find_bounding_boxes(_noisy_texture())["detection_warning"] or "")

    def test_a_colour_the_user_picked_is_taken_as_the_answer(self) -> None:
        result = find_bounding_boxes(_gradient(), "sampled", "#282828")
        self.assertNotIn("gradient or texture", result["detection_warning"] or "")

    def test_a_transparent_sheet_is_not_flagged(self) -> None:
        img = np.zeros((340, 460, 4), dtype=np.uint8)
        for x0, y0, size in ((60, 60, 80), (300, 60, 80), (180, 200, 80)):
            img[y0 : y0 + size, x0 : x0 + size] = (30, 60, 220, 255)
        result = find_bounding_boxes(img)
        self.assertEqual(result["detection_mode"], "alpha")
        self.assertIsNone(result["detection_warning"])


if __name__ == "__main__":
    unittest.main()
