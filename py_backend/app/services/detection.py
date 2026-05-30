import uuid
import cv2
import numpy as np
from app.core.config import settings
from app.models.schemas import DetectedBox


def is_transparent(img: np.ndarray) -> bool:
    """
    True only if the image has an alpha channel AND a meaningful fraction of
    pixels are actually transparent. A fully-opaque RGBA (alpha == 255 every-
    where) is treated as NOT transparent so it still gets background removal.
    """
    if img.ndim != 3 or img.shape[2] != 4:
        return False

    alpha = img[:, :, 3]
    transparent_pixels = int(np.count_nonzero(alpha < settings.TRANSPARENCY_ALPHA_THRESHOLD))
    total = alpha.size
    if total == 0:
        return False
    return (transparent_pixels / total) >= settings.TRANSPARENCY_MIN_FRACTION


def find_bounding_boxes(img: np.ndarray) -> list[DetectedBox]:
    """
    Detect individual assets in a sprite sheet / icon pack image.

    Strategy:
    - If image has alpha channel (RGBA): use alpha mask to isolate non-transparent regions
    - Otherwise: convert to grayscale and threshold (assumes light/white background)
    """
    h, w = img.shape[:2]
    channels = img.shape[2] if img.ndim == 3 else 1

    if channels == 4:
        # Use alpha channel as mask
        alpha = img[:, :, 3]
        _, thresh = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
    else:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if channels == 3 else img
        _, thresh = cv2.threshold(
            gray, settings.BINARY_THRESH_VALUE, 255, cv2.THRESH_BINARY_INV
        )

    # Small dilation to merge very close fragments of the same icon
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    thresh = cv2.dilate(thresh, kernel, iterations=1)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    raw_boxes: list[tuple[int, int, int, int]] = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        if (
            bw >= settings.MIN_BOX_WIDTH
            and bh >= settings.MIN_BOX_HEIGHT
            and bw * bh >= settings.MIN_BOX_AREA
        ):
            raw_boxes.append((x, y, bw, bh))

    # Sort top-to-bottom, left-to-right so naming is predictable
    raw_boxes.sort(key=lambda b: (b[1] // 50, b[0]))

    boxes: list[DetectedBox] = []
    for i, (x, y, bw, bh) in enumerate(raw_boxes):
        boxes.append(
            DetectedBox(
                id=str(uuid.uuid4()),
                x=x,
                y=y,
                width=bw,
                height=bh,
                name=f"asset_{i + 1:03d}",  # asset_001, asset_002 ...
            )
        )

    return boxes, w, h
