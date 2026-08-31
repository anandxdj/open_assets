"""Alpha connected-component extraction.

Port of ``frontend/src/features/anibuddy/atlas/extract.ts`` ``alphaComponents``.
4-connected flood fill over pixels whose alpha ≥ ALPHA_FLOOR.
"""

from __future__ import annotations

from typing import List, Optional

import cv2
import numpy as np

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.decompose.masks import bounds_from_mask
from app.modules.anibuddy.decompose.types import PartCandidate, PixelBounds


def alpha_components(fg_mask: np.ndarray) -> List[PartCandidate]:
    """Return one candidate per 4-connected opaque component.

    Uses OpenCV's connectedComponentsWithStats (4-connectivity) — bit-equivalent
    to the BFS in extract.ts for the same ALPHA_FLOOR threshold.
    """
    binary = (fg_mask > 0).astype(np.uint8)
    label_count, labels, stats, _ = cv2.connectedComponentsWithStats(
        binary, connectivity=4
    )
    candidates: List[PartCandidate] = []
    for label in range(1, label_count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < DecomposeConstants.MIN_COMPONENT_PIXELS:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        part_mask = np.where(labels == label, 255, 0).astype(np.uint8)
        candidates.append(
            PartCandidate(
                bounds=PixelBounds(x=x, y=y, width=w, height=h, pixels=area),
                mask=part_mask,
                provenance="alpha-component",
                confidence=DecomposeConstants.CONFIDENCE_ALPHA_COMPONENT,
            )
        )
    candidates.sort(key=lambda c: (-c.bounds.pixels, c.bounds.y, c.bounds.x))
    return candidates


def whole_sheet_candidate(fg_mask: np.ndarray) -> Optional[PartCandidate]:
    """Degenerate single-part outcome when nothing separable is found."""
    bounds = bounds_from_mask(fg_mask)
    if bounds is None:
        return None
    return PartCandidate(
        bounds=bounds,
        mask=(fg_mask > 0).astype(np.uint8) * 255,
        provenance="alpha-component",
        confidence=DecomposeConstants.CONFIDENCE_WHOLE_SHEET,
    )
