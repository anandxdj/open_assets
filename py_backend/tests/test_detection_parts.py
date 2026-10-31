import unittest

import numpy as np

from app.services.detection import find_bounding_boxes


def _sheet(gap: int) -> np.ndarray:
    """A black sheet: a head above its shoulders (`gap` px apart) and a separate square far away."""
    img = np.zeros((400, 600, 3), dtype=np.uint8)
    img[40:90, 90:140] = (255, 255, 255)  # head
    img[90 + gap : 130 + gap, 60:170] = (255, 255, 255)  # shoulders
    img[40:130, 400:490] = (255, 120, 0)  # a separate asset
    return img


class DetachedPartsTests(unittest.TestCase):
    def test_parts_a_hair_apart_are_one_asset(self) -> None:
        boxes = find_bounding_boxes(_sheet(gap=5), "dark")["boxes"]
        self.assertEqual(len(boxes), 2)
        person = min(boxes, key=lambda b: b.x)
        self.assertLessEqual(person.y, 40)
        self.assertGreaterEqual(person.y + person.height, 135)

    def test_assets_with_real_space_between_them_stay_separate(self) -> None:
        self.assertEqual(len(find_bounding_boxes(_sheet(gap=60), "dark")["boxes"]), 3)


if __name__ == "__main__":
    unittest.main()
