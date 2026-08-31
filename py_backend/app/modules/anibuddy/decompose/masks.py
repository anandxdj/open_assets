"""Reversible mask builders and Part promotion.

R8: every mask is a description over unmodified source pixels. This module
never writes into the artwork — it only encodes which pixels a part claims.
"""

from __future__ import annotations

import hashlib
import struct
from typing import List, Optional, Sequence

import numpy as np

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.decompose.types import PartCandidate, PixelBounds
from app.modules.anibuddy.schemas import (
    DeformerRigid,
    MaskAlphaThreshold,
    MaskRect,
    MaskRle,
    NumericBuffer,
    Part,
    PartProvenance,
    Rect,
    Vec2,
)


def alpha_foreground(rgba: np.ndarray) -> np.ndarray:
    """Return a uint8 0/255 foreground mask from an RGBA (or BGRA) sheet."""
    if rgba.ndim != 3 or rgba.shape[2] < 4:
        raise ValueError("decompose requires an image with an alpha channel")
    alpha = rgba[:, :, 3]
    return np.where(alpha >= DecomposeConstants.ALPHA_FLOOR, 255, 0).astype(np.uint8)


def count_foreground(fg_mask: np.ndarray) -> int:
    return int(np.count_nonzero(fg_mask))


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def sheet_normalized_rect(bounds: PixelBounds, sheet_w: int, sheet_h: int) -> Rect:
    return Rect(
        x=_clamp01(bounds.x / sheet_w),
        y=_clamp01(bounds.y / sheet_h),
        width=_clamp01(bounds.width / sheet_w),
        height=_clamp01(bounds.height / sheet_h),
    )


def _u32_inline_buffer(values: Sequence[int]) -> NumericBuffer:
    """Pack run lengths as little-endian u32 with a content hash (wire contract)."""
    ints = [int(v) for v in values]
    if len(ints) > DecomposeConstants.MAX_INLINE_BUFFER_ELEMENTS:
        # Decompose always keeps counts inline for the stage response; oversized
        # masks are a signal the sheet defeated us — truncate is forbidden
        # (would corrupt the RLE). Fail loudly so the worker can retry with
        # external storage later.
        raise ValueError(
            f"RLE counts length {len(ints)} exceeds MAX_INLINE_BUFFER_ELEMENTS "
            f"{DecomposeConstants.MAX_INLINE_BUFFER_ELEMENTS}"
        )
    le_bytes = b"".join(struct.pack("<I", v) for v in ints)
    return NumericBuffer(
        dtype="u32",
        storage="inline",
        length=len(ints),
        sha256=hashlib.sha256(le_bytes).hexdigest(),
        values=[float(v) for v in ints],
        storageKey=None,
    )


def encode_rle_column_major(binary: np.ndarray) -> List[int]:
    """COCO-style RLE, column-major, starting with a background run.

    ``binary`` is HxW with nonzero = foreground. Schema ``MaskRle`` requires
    column-major order from the mask origin.
    """
    if binary.size == 0:
        return [0]
    # Fortran / column-major flatten: x outer, y inner.
    flat = np.asfortranarray(binary.astype(np.uint8)).ravel(order="F")
    counts: List[int] = []
    # First run is always background (0). If the first pixel is FG, emit a
    # zero-length background run so the alternating contract holds.
    current = 0
    run = 0
    for value in flat:
        bit = 1 if value else 0
        if bit == current:
            run += 1
        else:
            counts.append(run)
            run = 1
            current = bit
    counts.append(run)
    return counts


def mask_rle_from_sheet_mask(sheet_mask: np.ndarray, bounds: PixelBounds) -> MaskRle:
    """Crop ``sheet_mask`` to ``bounds`` and encode as reversible RLE."""
    x0, y0 = bounds.x, bounds.y
    x1, y1 = x0 + bounds.width, y0 + bounds.height
    crop = sheet_mask[y0:y1, x0:x1]
    binary = (crop > 0).astype(np.uint8)
    counts = encode_rle_column_major(binary)
    return MaskRle(
        kind="rle",
        origin=Vec2(x=float(x0), y=float(y0)),
        width=int(bounds.width),
        height=int(bounds.height),
        counts=_u32_inline_buffer(counts),
    )


def _pivot_from_mask(sheet_mask: np.ndarray, bounds: PixelBounds) -> Vec2:
    """Centroid of the part mask in part-local normalized coordinates."""
    x0, y0 = bounds.x, bounds.y
    crop = sheet_mask[y0 : y0 + bounds.height, x0 : x0 + bounds.width]
    ys, xs = np.nonzero(crop)
    if len(xs) == 0:
        return Vec2(
            x=DecomposeConstants.DEFAULT_PIVOT_X,
            y=DecomposeConstants.DEFAULT_PIVOT_Y,
        )
    local_x = (float(xs.mean()) + 0.5) / bounds.width
    local_y = (float(ys.mean()) + 0.5) / bounds.height
    return Vec2(x=_clamp01(local_x), y=_clamp01(local_y))


def _wire_mask(candidate: PartCandidate):
    """Pick the reversible mask kind that matches the producing strategy."""
    if candidate.provenance == "gutter-grid":
        return MaskRect(kind="rect")
    if candidate.provenance == "alpha-component":
        return MaskAlphaThreshold(
            kind="alpha-threshold",
            threshold=DecomposeConstants.ALPHA_FLOOR,
        )
    return mask_rle_from_sheet_mask(candidate.mask, candidate.bounds)


def promote_candidate(
    candidate: PartCandidate,
    index: int,
    sheet_w: int,
    sheet_h: int,
) -> Part:
    """Lift an internal candidate into a wire ``Part`` with provisional fields.

    Roles, parents, deformers and skeleton binding are deliberately blank —
    semantics owns those. Decompose only fills geometry descriptors.
    """
    part_id = f"part_{index + 1}"
    provenance: PartProvenance = candidate.provenance  # type: ignore[assignment]
    return Part(
        id=part_id,
        name=f"Part {index + 1}",
        role=DecomposeConstants.DEFAULT_PART_ROLE,  # type: ignore[arg-type]
        mask=_wire_mask(candidate),
        rect=sheet_normalized_rect(candidate.bounds, sheet_w, sheet_h),
        pivot=_pivot_from_mask(candidate.mask, candidate.bounds),
        zIndex=index,
        parentPartId=None,
        attachSlot=None,
        slots=[],
        deformer=DeformerRigid(kind="rigid"),
        boundJointId=None,
        visible=True,
        opacity=DecomposeConstants.DEFAULT_OPACITY,
        confidence=float(candidate.confidence),
        provenance=provenance,
    )


def bounds_from_mask(sheet_mask: np.ndarray) -> Optional[PixelBounds]:
    """Tight AABB of nonzero pixels, or None if empty."""
    ys, xs = np.nonzero(sheet_mask)
    if len(xs) == 0:
        return None
    x0 = int(xs.min())
    y0 = int(ys.min())
    x1 = int(xs.max())
    y1 = int(ys.max())
    return PixelBounds(
        x=x0,
        y=y0,
        width=x1 - x0 + 1,
        height=y1 - y0 + 1,
        pixels=int(len(xs)),
    )


def overlapping_part_pairs(parts: List[Part]) -> List[List[str]]:
    pairs: List[List[str]] = []
    for i, a in enumerate(parts):
        for b in parts[i + 1 :]:
            if _rects_overlap(a.rect, b.rect):
                pairs.append([a.id, b.id])
    return pairs


def _rects_overlap(a: Rect, b: Rect) -> bool:
    return (
        a.x < b.x + b.width
        and a.x + a.width > b.x
        and a.y < b.y + b.height
        and a.y + a.height > b.y
    )


def covered_foreground_pixels(
    candidates: Sequence[PartCandidate],
    fg_mask: np.ndarray,
) -> int:
    """Count foreground pixels claimed by at least one candidate mask."""
    if not candidates:
        return 0
    claimed = np.zeros(fg_mask.shape, dtype=np.uint8)
    for candidate in candidates:
        claimed = np.maximum(claimed, (candidate.mask > 0).astype(np.uint8))
    return int(np.count_nonzero((claimed > 0) & (fg_mask > 0)))
