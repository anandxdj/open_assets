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


DEFAULT_THRESHOLD = 50

# --- Background classification --------------------------------------------------------------
#
# ONE rule, shared with the Node backend's flat-colour keyer (backend/src/lib/background.ts). The
# two implementations are held together by backend/src/__tests__/fixtures/background-cases/ (PNG
# sheets with the expected answer), which both test suites read. Change one, change the other.
#
#   ring    the outermost RING pixels of the sheet, RING = max(1, min(4, h // 40, w // 40))
#   colour  the per-channel median of the ring (the mean of the two middle values when the count
#           is even), rounded half up for the #rrggbb form
#   share   how much of the ring is within FLAT_BORDER_TOLERANCE (largest channel difference) of
#           that colour
#   kind    transparent  an alpha channel with at least 1% of its pixels below 250
#           flat         share >= FLAT_BORDER_MIN_SHARE (white, black, grey, a plain colour)
#           chroma       flat, and the colour's channels differ by CHROMA_SPREAD or more
#                        (magenta, green, blue screen): artwork does not contain it on purpose
#           complex      anything else: gradient, texture, photo
FLAT_BORDER_TOLERANCE = 24
FLAT_BORDER_MIN_SHARE = 0.85
CHROMA_SPREAD = 60

BackgroundKind = Literal["transparent", "flat", "chroma", "complex"]


def _border_ring(bgr: np.ndarray) -> np.ndarray:
    h, w = bgr.shape[:2]
    ring = max(1, min(4, h // 40, w // 40))
    return np.concatenate(
        (
            bgr[:ring].reshape(-1, 3),
            bgr[-ring:].reshape(-1, 3),
            bgr[ring:-ring, :ring].reshape(-1, 3),
            bgr[ring:-ring, -ring:].reshape(-1, 3),
        )
    ).astype(np.int16)


def _as_bgr(img: np.ndarray) -> np.ndarray:
    return img[:, :, :3] if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)


def border_flatness(img: np.ndarray) -> float:
    """Share (0 to 1) of the outer ring of pixels that is close to the ring's median colour."""
    pixels = _border_ring(_as_bgr(img))
    median = np.median(pixels, axis=0)
    near = np.abs(pixels - median).max(axis=1) <= FLAT_BORDER_TOLERANCE
    return float(near.mean())


def classify_background(img: np.ndarray) -> dict:
    """The sheet's background: {"kind": transparent | flat | chroma | complex, "color": "#rrggbb" or None}."""
    if is_transparent(img):
        return {"kind": "transparent", "color": None}
    pixels = _border_ring(_as_bgr(img))
    median = np.median(pixels, axis=0)
    share = float((np.abs(pixels - median).max(axis=1) <= FLAT_BORDER_TOLERANCE).mean())
    if share < FLAT_BORDER_MIN_SHARE:
        return {"kind": "complex", "color": None}
    # Round half up (floor(x + 0.5)), the same as JavaScript's Math.round, not numpy's half to even.
    b, g, r = (int(np.floor(v + 0.5)) for v in median)
    kind: BackgroundKind = "chroma" if max(r, g, b) - min(r, g, b) >= CHROMA_SPREAD else "flat"
    return {"kind": kind, "color": f"#{r:02x}{g:02x}{b:02x}"}


def _cutoff(base: float, threshold: int) -> float:
    """Scale a built-in cut-off by the 1-100 threshold (50 = unchanged)."""
    return base * (threshold / DEFAULT_THRESHOLD)


def _mask_from_border_distance(img: np.ndarray, background: np.ndarray, threshold: int = DEFAULT_THRESHOLD) -> np.ndarray:
    bgr = img[:, :, :3].astype(np.float32)
    distance = np.linalg.norm(bgr - background, axis=2)
    # Compression creates a small halo around otherwise flat backgrounds.
    return np.where(distance > _cutoff(28, threshold), 255, 0).astype(np.uint8)


def _candidate_masks(
    img: np.ndarray,
    mode: DetectionMode,
    background_color: Optional[str],
    threshold: int = DEFAULT_THRESHOLD,
) -> list[tuple[str, np.ndarray]]:
    channels = img.shape[2] if img.ndim == 3 else 1
    if channels == 4 and is_transparent(img):
        alpha = img[:, :, 3]
        return [("alpha", np.where(alpha > _cutoff(10, threshold), 255, 0).astype(np.uint8))]

    bgr = img[:, :, :3] if channels >= 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    background = _parse_background_color(background_color)
    if background is None:
        background = _sample_border_color(bgr)

    candidates: list[tuple[str, np.ndarray]] = []
    if mode in ("auto", "dark"):
        # Bright/coloured pixels are foreground on a dark canvas.
        _, mask = cv2.threshold(gray, _cutoff(15, threshold), 255, cv2.THRESH_BINARY)
        candidates.append(("dark-background", mask))
    if mode in ("auto", "light"):
        # Dark pixels are foreground on a light canvas (the legacy behavior).
        # Distance from white is the same idea as the dark case, so it scales too.
        light_cutoff = 255 - _cutoff(255 - settings.BINARY_THRESH_VALUE, threshold)
        _, mask = cv2.threshold(
            gray, min(254.0, max(0.0, light_cutoff)), 255, cv2.THRESH_BINARY_INV
        )
        candidates.append(("light-background", mask))
    if mode in ("auto", "sampled"):
        candidates.append(("sampled-background", _mask_from_border_distance(bgr, background, threshold)))
    if mode == "auto":
        adaptive = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7
        )
        candidates.append(("adaptive", adaptive))

    return [(name, _clean_mask(mask)) for name, mask in candidates]


# Parts of one item that sit a hair apart (a head above its shoulders, the dot of an "i")
# are one asset. Two boxes merge when the gap between them is at most this share of the
# sheet's shorter side (never under 3 px) and they overlap this much on the other axis.
PART_GAP_SHARE = 0.01
PART_MIN_GAP = 3
PART_MIN_OVERLAP = 0.6


def _span_overlap(a_start: int, a_len: int, b_start: int, b_len: int) -> float:
    """Overlap of two 1-D spans as a share of the shorter one."""
    overlap = min(a_start + a_len, b_start + b_len) - max(a_start, b_start)
    return max(0, overlap) / max(1, min(a_len, b_len))


def _merge_detached_parts(
    boxes: list[tuple[int, int, int, int]], short_side: int
) -> list[tuple[int, int, int, int]]:
    gap_limit = max(PART_MIN_GAP, short_side * PART_GAP_SHARE)
    boxes = list(boxes)
    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                ax, ay, aw, ah = boxes[i]
                bx, by, bw, bh = boxes[j]
                gap_x = max(bx - (ax + aw), ax - (bx + bw), 0)
                gap_y = max(by - (ay + ah), ay - (by + bh), 0)
                stacked = gap_y <= gap_limit and _span_overlap(ax, aw, bx, bw) >= PART_MIN_OVERLAP
                side_by_side = gap_x <= gap_limit and _span_overlap(ay, ah, by, bh) >= PART_MIN_OVERLAP
                if not (stacked or side_by_side):
                    continue
                x0, y0 = min(ax, bx), min(ay, by)
                x1, y1 = max(ax + aw, bx + bw), max(ay + ah, by + bh)
                boxes[i] = (x0, y0, x1 - x0, y1 - y0)
                del boxes[j]
                merged = True
                break
            if merged:
                break
    return boxes


ROW_CENTRE_REACH = 0.5


def reading_order(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """
    Sort boxes the way a person reads a grid: row by row, left to right in each row.

    A row is a group of boxes whose vertical centres lie within half the median box height of the
    row's own mean centre (so logos of different heights, or a grid drawn a few pixels off, stay one
    row, while chained drift down a slanted sheet does not merge two rows). Rows go top to bottom.
    """
    if len(boxes) < 2:
        return list(boxes)
    reach = float(np.median([h for _, _, _, h in boxes])) * ROW_CENTRE_REACH
    by_centre = sorted(boxes, key=lambda b: (b[1] + b[3] / 2, b[0]))
    rows: list[list[tuple[int, int, int, int]]] = []
    centres: list[float] = []  # running mean centre of each row
    for box in by_centre:
        centre = box[1] + box[3] / 2
        if rows and abs(centre - centres[-1]) <= reach:
            rows[-1].append(box)
            centres[-1] += (centre - centres[-1]) / len(rows[-1])
        else:
            rows.append([box])
            centres.append(centre)
    order = sorted(range(len(rows)), key=lambda i: centres[i])
    return [box for i in order for box in sorted(rows[i], key=lambda b: (b[0], b[1]))]


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
    return _merge_detached_parts(boxes, min(mask.shape[:2]))


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
    threshold: int = DEFAULT_THRESHOLD,
) -> dict:
    """Detect assets through a scored ensemble of background-aware masks."""
    h, w = img.shape[:2]
    candidates = _candidate_masks(img, mode, background_color, threshold)
    evaluated = [
        (name, mask, _boxes_from_mask(mask)) for name, mask in candidates
    ]
    name, mask, raw_boxes = max(
        evaluated, key=lambda candidate: _score_candidate(candidate[1], candidate[2])
    )
    score = _score_candidate(mask, raw_boxes)
    raw_boxes = reading_order(raw_boxes)
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
    # A transparent sheet has no background to be flat or not (the alpha mask is reliable), and
    # a colour the user picked is their answer to "what is the background".
    uneven_background = name != "alpha" and not background_color and border_flatness(img) < FLAT_BORDER_MIN_SHARE
    if not boxes:
        warning = "No distinct assets found. Try a different background mode or draw boxes manually."
    elif uneven_background:
        warning = (
            "The background is a gradient or texture, not one flat colour, so these boxes are a guess. "
            "Check them before you export."
        )
    elif confidence < 0.45:
        warning = "Detection is uncertain. Try another background mode or review the boxes before export."

    return {
        "boxes": boxes,
        "image_width": w,
        "image_height": h,
        "detection_mode": name,
        "detection_confidence": confidence,
        "detection_warning": warning,
        "background": classify_background(img),
    }
