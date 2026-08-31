"""GrabCut escalation for overlapping / shared-silhouette parts.

Last resort in the cascade. Seeds come from distance-transform peaks (same
as watershed); each seed runs an independent grabCut pass constrained to the
foreground hull. Confidence is intentionally below CONFIDENCE_REVIEW_FLOOR.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import cv2
import numpy as np
from scipy import ndimage

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.decompose.types import PartCandidate, PixelBounds


def _peak_centroids(fg_mask: np.ndarray) -> List[Tuple[int, int]]:
    binary = (fg_mask > 0).astype(np.uint8)
    distance = ndimage.distance_transform_edt(binary)
    if float(distance.max()) <= 0:
        return []

    min_dist = DecomposeConstants.WATERSHED_SEED_MIN_DISTANCE_PX
    footprint = np.ones((min_dist * 2 + 1, min_dist * 2 + 1), dtype=bool)
    local_max = (distance == ndimage.maximum_filter(distance, footprint=footprint)) & (
        distance >= DecomposeConstants.WATERSHED_SEED_RELATIVE * float(distance.max())
    )
    local_max &= binary.astype(bool)
    labeled, count = ndimage.label(local_max)
    centroids: List[Tuple[int, int]] = []
    for label in range(1, count + 1):
        ys, xs = np.nonzero(labeled == label)
        if len(xs) == 0:
            continue
        centroids.append((int(round(float(xs.mean()))), int(round(float(ys.mean())))))
    return centroids


def grabcut_split(
    rgba: np.ndarray,
    fg_mask: np.ndarray,
) -> Optional[List[PartCandidate]]:
    """Attempt to separate overlapping parts via seeded grabCut.

    Returns None when fewer than two usable parts are recovered.
    """
    centroids = _peak_centroids(fg_mask)
    if len(centroids) < 2:
        # Synthesize two seeds from the eroded components if peaks failed.
        radius = DecomposeConstants.TOUCH_PROBE_ERODE_PX
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
        )
        eroded = cv2.erode((fg_mask > 0).astype(np.uint8), kernel, iterations=1)
        cc_count, _, stats, cents = cv2.connectedComponentsWithStats(
            eroded, connectivity=4
        )
        centroids = []
        for label in range(1, cc_count):
            if int(stats[label, cv2.CC_STAT_AREA]) < 1:
                continue
            centroids.append(
                (
                    int(round(float(cents[label][0]))),
                    int(round(float(cents[label][1]))),
                )
            )
        if len(centroids) < 2:
            return None

    if rgba.shape[2] >= 3:
        bgr = rgba[:, :, :3].copy()
    else:
        bgr = cv2.cvtColor(rgba, cv2.COLOR_GRAY2BGR)

    height, width = fg_mask.shape[:2]
    binary = (fg_mask > 0).astype(np.uint8)
    pad = DecomposeConstants.GRABCUT_SEED_PAD_PX
    candidates: List[PartCandidate] = []

    for cx, cy in centroids:
        # GrabCut mask: sure BG outside FG hull, probable FG inside, sure FG
        # around the seed. Never invents pixels — only labels existing ones.
        gc_mask = np.full((height, width), cv2.GC_BGD, dtype=np.uint8)
        gc_mask[binary > 0] = cv2.GC_PR_FGD
        x0 = max(0, cx - pad)
        x1 = min(width, cx + pad + 1)
        y0 = max(0, cy - pad)
        y1 = min(height, cy + pad + 1)
        gc_mask[y0:y1, x0:x1] = cv2.GC_FGD

        bgd_model = np.zeros((1, 65), np.float64)
        fgd_model = np.zeros((1, 65), np.float64)
        try:
            cv2.grabCut(
                bgr,
                gc_mask,
                None,
                bgd_model,
                fgd_model,
                DecomposeConstants.GRABCUT_ITERATIONS,
                cv2.GC_INIT_WITH_MASK,
            )
        except cv2.error:
            continue

        part_mask = np.where(
            ((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD)) & (binary > 0),
            255,
            0,
        ).astype(np.uint8)
        area = int(np.count_nonzero(part_mask))
        if area < DecomposeConstants.MIN_COMPONENT_PIXELS:
            continue
        ys, xs = np.nonzero(part_mask)
        bx0, bx1 = int(xs.min()), int(xs.max())
        by0, by1 = int(ys.min()), int(ys.max())
        candidates.append(
            PartCandidate(
                bounds=PixelBounds(
                    x=bx0,
                    y=by0,
                    width=bx1 - bx0 + 1,
                    height=by1 - by0 + 1,
                    pixels=area,
                ),
                mask=part_mask,
                provenance="grabcut",
                confidence=DecomposeConstants.CONFIDENCE_GRABCUT,
            )
        )

    # GrabCut per-seed can produce near-duplicate masks; drop heavy overlaps
    # by keeping the larger of any pair that covers >80% of the smaller.
    candidates = _dedupe_by_overlap(candidates)
    if len(candidates) < 2:
        return None
    candidates.sort(key=lambda c: (-c.bounds.pixels, c.bounds.y, c.bounds.x))
    return candidates


def _dedupe_by_overlap(candidates: List[PartCandidate]) -> List[PartCandidate]:
    kept: List[PartCandidate] = []
    for candidate in sorted(candidates, key=lambda c: -c.bounds.pixels):
        duplicate = False
        for existing in kept:
            overlap = np.count_nonzero((candidate.mask > 0) & (existing.mask > 0))
            smaller = min(candidate.bounds.pixels, existing.bounds.pixels)
            if (
                smaller > 0
                and overlap / smaller > DecomposeConstants.GRABCUT_DEDUP_OVERLAP
            ):
                duplicate = True
                break
        if not duplicate:
            kept.append(candidate)
    return kept
