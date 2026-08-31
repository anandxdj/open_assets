"""Watershed escalation for parts that touch.

When alpha CC sees one blob but a light erode splits it, the parts are
touching rather than overlapping. Distance-transform peaks become seeds;
``cv2.watershed`` partitions the shared silhouette. Masks stay reversible RLE.
"""

from __future__ import annotations

from typing import List, Optional

import cv2
import numpy as np
from scipy import ndimage

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.decompose.types import PartCandidate, PixelBounds


def touching_probe(fg_mask: np.ndarray) -> bool:
    """True when eroding the foreground splits it into multiple components."""
    binary = (fg_mask > 0).astype(np.uint8)
    if int(np.count_nonzero(binary)) < DecomposeConstants.MIN_COMPONENT_PIXELS:
        return False
    radius = DecomposeConstants.TOUCH_PROBE_ERODE_PX
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
    )
    eroded = cv2.erode(binary, kernel, iterations=1)
    label_count, _ = cv2.connectedComponents(eroded, connectivity=4)
    # label_count includes background label 0
    return (label_count - 1) >= DecomposeConstants.TOUCH_PROBE_MIN_COMPONENTS


def _seed_markers(fg_mask: np.ndarray) -> Optional[np.ndarray]:
    """Build watershed markers from distance-transform peaks inside the FG."""
    binary = (fg_mask > 0).astype(np.uint8)
    distance = ndimage.distance_transform_edt(binary)
    if float(distance.max()) <= 0:
        return None

    # Suppress nearby peaks so each touching part gets one seed.
    min_dist = DecomposeConstants.WATERSHED_SEED_MIN_DISTANCE_PX
    footprint = np.ones((min_dist * 2 + 1, min_dist * 2 + 1), dtype=bool)
    local_max = (distance == ndimage.maximum_filter(distance, footprint=footprint)) & (
        distance >= DecomposeConstants.WATERSHED_SEED_RELATIVE * float(distance.max())
    )
    local_max &= binary.astype(bool)

    labeled_seeds, seed_count = ndimage.label(local_max)
    if seed_count < 2:
        # Fall back to eroded-component centroids when peaks collapse to one.
        radius = DecomposeConstants.TOUCH_PROBE_ERODE_PX
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
        )
        eroded = cv2.erode(binary, kernel, iterations=1)
        cc_count, cc_labels, stats, centroids = cv2.connectedComponentsWithStats(
            eroded, connectivity=4
        )
        if cc_count - 1 < 2:
            return None
        markers = np.zeros(fg_mask.shape, dtype=np.int32)
        for label in range(1, cc_count):
            if int(stats[label, cv2.CC_STAT_AREA]) < 1:
                continue
            cx = int(round(float(centroids[label][0])))
            cy = int(round(float(centroids[label][1])))
            markers[cy, cx] = label
        # Sure background
        markers[binary == 0] = -1
        return markers if int(markers.max()) >= 2 else None

    markers = labeled_seeds.astype(np.int32)
    markers[binary == 0] = -1
    return markers


def watershed_split(
    rgba: np.ndarray,
    fg_mask: np.ndarray,
) -> Optional[List[PartCandidate]]:
    """Partition a touching silhouette. Returns None when split is inconclusive."""
    markers = _seed_markers(fg_mask)
    if markers is None:
        return None

    # watershed needs a 3-channel image; feed BGR of the sheet (alpha ignored).
    if rgba.shape[2] >= 3:
        bgr = rgba[:, :, :3].copy()
    else:
        bgr = cv2.cvtColor(rgba, cv2.COLOR_GRAY2BGR)

    working = markers.copy()
    cv2.watershed(bgr, working)

    binary = fg_mask > 0
    # Watershed labels: -1 = boundary, 0 = unknown, >0 = region.
    region_ids = [int(v) for v in np.unique(working) if v > 0]
    candidates: List[PartCandidate] = []
    for region_id in region_ids:
        part_mask = np.where((working == region_id) & binary, 255, 0).astype(np.uint8)
        area = int(np.count_nonzero(part_mask))
        if area < DecomposeConstants.MIN_COMPONENT_PIXELS:
            continue
        ys, xs = np.nonzero(part_mask)
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        candidates.append(
            PartCandidate(
                bounds=PixelBounds(
                    x=x0,
                    y=y0,
                    width=x1 - x0 + 1,
                    height=y1 - y0 + 1,
                    pixels=area,
                ),
                mask=part_mask,
                provenance="watershed",
                confidence=DecomposeConstants.CONFIDENCE_WATERSHED,
            )
        )

    if len(candidates) < 2:
        return None
    candidates.sort(key=lambda c: (-c.bounds.pixels, c.bounds.y, c.bounds.x))
    return candidates
