"""Gutter-grid detection for regular sprite sheets.

Port of ``frontend/src/features/anibuddy/atlas/extract.ts`` ``candidateGrid``.
Finds fully-blank rows/columns (alpha < ALPHA_FLOOR) and treats the resulting
row×col spans as cell candidates when there are at least two cells.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import numpy as np

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.decompose.types import PartCandidate, PixelBounds


def _blank_axes(fg_mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Boolean vectors: True where a whole row/column has no foreground."""
    binary = fg_mask > 0
    blank_rows = ~np.any(binary, axis=1)
    blank_cols = ~np.any(binary, axis=0)
    return blank_rows, blank_cols


def _spans(blank: Sequence[bool] | np.ndarray) -> List[Tuple[int, int]]:
    """Inclusive-start, exclusive-end spans of non-blank runs.

    Mirrors the TypeScript ``spans`` helper in extract.ts exactly, including
    the edge case where the last index is non-blank.
    """
    result: List[Tuple[int, int]] = []
    start: Optional[int] = None
    length = len(blank)
    for index in range(length):
        is_blank = bool(blank[index])
        if not is_blank and start is None:
            start = index
        if (is_blank or index == length - 1) and start is not None:
            end = index if is_blank else index + 1
            result.append((start, end))
            start = None
    return result


def candidate_grid(fg_mask: np.ndarray) -> Optional[List[PartCandidate]]:
    """Return grid cells when transparent gutters imply ≥2 cells, else None."""
    height, width = fg_mask.shape[:2]
    blank_rows, blank_cols = _blank_axes(fg_mask)
    rows = _spans(blank_rows)
    cols = _spans(blank_cols)
    if len(rows) * len(cols) < 2:
        return None

    candidates: List[PartCandidate] = []
    for top, bottom in rows:
        for left, right in cols:
            cell_h = bottom - top
            cell_w = right - left
            if cell_w < 1 or cell_h < 1:
                continue
            cell_mask = np.zeros((height, width), dtype=np.uint8)
            cell_slice = fg_mask[top:bottom, left:right]
            fg_pixels = int(np.count_nonzero(cell_slice))
            if fg_pixels < DecomposeConstants.MIN_CELL_FOREGROUND_PIXELS:
                continue
            cell_mask[top:bottom, left:right] = np.where(cell_slice > 0, 255, 0).astype(
                np.uint8
            )
            candidates.append(
                PartCandidate(
                    bounds=PixelBounds(
                        x=left,
                        y=top,
                        width=cell_w,
                        height=cell_h,
                        pixels=fg_pixels,
                    ),
                    mask=cell_mask,
                    provenance="gutter-grid",
                    confidence=DecomposeConstants.CONFIDENCE_GUTTER_GRID,
                )
            )

    if len(candidates) < 2:
        return None
    candidates.sort(key=lambda c: (c.bounds.y, c.bounds.x))
    return candidates
