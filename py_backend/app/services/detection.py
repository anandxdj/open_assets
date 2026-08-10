import uuid
from typing import Literal, Optional

import cv2
import numpy as np

from app.core.config import settings
from app.models.schemas import DetectedBox

DetectionMode = Literal["auto", "light", "dark", "sampled"]


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


def _parse_background_color(value: Optional[str]) -> Optional[np.ndarray]:
    if not value:
        return None
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        return None
    try:
        rgb = [int(raw[index : index + 2], 16) for index in range(0, 6, 2)]
    except ValueError:
        return None
    return np.array([rgb[2], rgb[1], rgb[0]], dtype=np.float32)


def _sample_border_color(img: np.ndarray) -> np.ndarray:
    """Return a robust BGR estimate from a thin border around an opaque sheet."""
    h, w = img.shape[:2]
    border = max(1, min(12, h // 20, w // 20))
    pixels = np.concatenate(
        (
            img[:border, :, :3].reshape(-1, 3),
            img[-border:, :, :3].reshape(-1, 3),
            img[:, :border, :3].reshape(-1, 3),
            img[:, -border:, :3].reshape(-1, 3),
        )
    )
    # The median is stable when a few sprites touch the outer edge.
    return np.median(pixels, axis=0).astype(np.float32)


def _clean_mask(mask: np.ndarray) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    return cv2.dilate(opened, kernel, iterations=1)


def _mask_from_border_distance(img: np.ndarray, background: np.ndarray) -> np.ndarray:
    bgr = img[:, :, :3].astype(np.float32)
    distance = np.linalg.norm(bgr - background, axis=2)
    # Compression creates a small halo around otherwise flat backgrounds.
    return np.where(distance > 28, 255, 0).astype(np.uint8)


def _candidate_masks(
    img: np.ndarray,
    mode: DetectionMode,
    background_color: Optional[str],
) -> list[tuple[str, np.ndarray]]:
    channels = img.shape[2] if img.ndim == 3 else 1
    if channels == 4 and is_transparent(img):
        alpha = img[:, :, 3]
        return [("alpha", np.where(alpha > 10, 255, 0).astype(np.uint8))]

    bgr = img[:, :, :3] if channels >= 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    background = _parse_background_color(background_color)
    if background is None:
        background = _sample_border_color(bgr)

    candidates: list[tuple[str, np.ndarray]] = []
    if mode in ("auto", "dark"):
        # Bright/coloured pixels are foreground on a dark canvas.
        _, mask = cv2.threshold(gray, 15, 255, cv2.THRESH_BINARY)
        candidates.append(("dark-background", mask))
    if mode in ("auto", "light"):
        # Dark pixels are foreground on a light canvas (the legacy behavior).
        _, mask = cv2.threshold(
            gray, settings.BINARY_THRESH_VALUE, 255, cv2.THRESH_BINARY_INV
        )
        candidates.append(("light-background", mask))
    if mode in ("auto", "sampled"):
        candidates.append(("sampled-background", _mask_from_border_distance(bgr, background)))
    if mode == "auto":
        adaptive = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7
        )
        candidates.append(("adaptive", adaptive))

    return [(name, _clean_mask(mask)) for name, mask in candidates]


def _boxes_from_mask(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes: list[tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        if (
            width >= settings.MIN_BOX_WIDTH
            and height >= settings.MIN_BOX_HEIGHT
            and width * height >= settings.MIN_BOX_AREA
        ):
            boxes.append((x, y, width, height))
    return boxes


def _score_candidate(mask: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> float:
    h, w = mask.shape[:2]
    image_area = h * w
    coverage = float(np.count_nonzero(mask)) / image_area
    if not boxes:
        return -100.0

    border_pixels = np.concatenate((mask[0, :], mask[-1, :], mask[:, 0], mask[:, -1]))
    border_coverage = float(np.count_nonzero(border_pixels)) / border_pixels.size
    largest = max(width * height for _, _, width, height in boxes) / image_area
    score = len(boxes) * 8.0 + min(coverage, 0.45) * 20.0
    score -= border_coverage * 35.0
    score -= max(0.0, coverage - 0.7) * 80.0
    score -= max(0.0, largest - 0.8) * 70.0
    if len(boxes) == 1 and largest > 0.9:
        score -= 120.0
    return score


def _confidence(score: float, boxes: list[tuple[int, int, int, int]], mask: np.ndarray) -> float:
    if not boxes:
        return 0.0
    h, w = mask.shape[:2]
    coverage = float(np.count_nonzero(mask)) / (h * w)
    largest = max(width * height for _, _, width, height in boxes) / (h * w)
    if len(boxes) == 1 and largest > 0.9:
        return 0.05
    base = min(0.95, max(0.05, (score + 20.0) / 65.0))
    return round(base * (1.0 - max(0.0, coverage - 0.7)), 2)


def find_bounding_boxes(
    img: np.ndarray,
    mode: DetectionMode = "auto",
    background_color: Optional[str] = None,
) -> dict:
    """Detect assets through a scored ensemble of background-aware masks."""
    h, w = img.shape[:2]
    candidates = _candidate_masks(img, mode, background_color)
    evaluated = [
        (name, mask, _boxes_from_mask(mask)) for name, mask in candidates
    ]
    name, mask, raw_boxes = max(
        evaluated, key=lambda candidate: _score_candidate(candidate[1], candidate[2])
    )
    score = _score_candidate(mask, raw_boxes)
    raw_boxes.sort(key=lambda box: (box[1] // 50, box[0]))
    boxes = [
        DetectedBox(
            id=str(uuid.uuid4()),
            x=x,
            y=y,
            width=width,
            height=height,
            name=f"asset_{index + 1:03d}",
        )
        for index, (x, y, width, height) in enumerate(raw_boxes)
    ]

    confidence = _confidence(score, raw_boxes, mask)
    warning = None
    if not boxes:
        warning = "No distinct assets found. Try a different background mode or draw boxes manually."
    elif confidence < 0.45:
        warning = "Detection is uncertain. Try another background mode or review the boxes before export."

    return {
        "boxes": boxes,
        "image_width": w,
        "image_height": h,
        "detection_mode": name,
        "detection_confidence": confidence,
        "detection_warning": warning,
    }
