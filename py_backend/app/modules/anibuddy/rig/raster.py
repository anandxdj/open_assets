"""Resolve a reversible ``Mask`` description into part-local pixels.

R8 says a mask describes and never bakes, so nothing here writes into the
source sheet — it only answers "which pixels does this part claim", inside the
part's own rect. Every downstream geometry step (contour, distance transform,
sampling, triangulation) reads this raster and nothing else, which is what
keeps the four mask kinds from leaking four code paths into the mesher.
"""

from __future__ import annotations

from typing import Optional, Tuple

import cv2
import numpy as np

from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.rig.buffers import Buffers
from app.modules.anibuddy.rig.types import PartRaster, RigError
from app.modules.anibuddy.schemas import (
    MaskAlphaThreshold,
    MaskPolygon,
    MaskRect,
    MaskRle,
    Part,
)

_SOLID: int = 255


def _clamp(value: int, low: int, high: int) -> int:
    return low if value < low else (high if value > high else value)


def rect_pixel_bounds(part: Part, sheet_w: int, sheet_h: int) -> Tuple[int, int, int, int]:
    """``Part.rect`` (sheet-normalized) as integer ``(x, y, width, height)``.

    Rounded rather than truncated so this inverts decompose's
    ``bounds.x / sheet_w`` exactly for any rect that came from a pixel bound —
    truncation would shift a part one pixel left on roughly half of them, and a
    one-pixel shift of the part-local origin is a one-pixel shift of every
    vertex the mesher emits.
    """
    x = _clamp(int(round(part.rect.x * sheet_w)), 0, max(0, sheet_w - 1))
    y = _clamp(int(round(part.rect.y * sheet_h)), 0, max(0, sheet_h - 1))
    width = _clamp(int(round(part.rect.width * sheet_w)), 1, sheet_w - x)
    height = _clamp(int(round(part.rect.height * sheet_h)), 1, sheet_h - y)
    return x, y, width, height


def _alpha_channel(sheet: np.ndarray) -> np.ndarray:
    if sheet.ndim != 3 or sheet.shape[2] < 4:
        raise RigError("The rig stage needs a sheet with an alpha channel.")
    return sheet[:, :, 3]


def _from_rect(width: int, height: int) -> np.ndarray:
    """The degenerate mask: the whole rect is the part."""
    return np.full((height, width), _SOLID, dtype=np.uint8)


def _from_alpha_threshold(
    mask: MaskAlphaThreshold,
    sheet: Optional[np.ndarray],
    bounds: Tuple[int, int, int, int],
) -> np.ndarray:
    if sheet is None:
        raise RigError(
            "An alpha-threshold mask needs the source sheet; none was uploaded "
            "with the rig request."
        )
    x, y, width, height = bounds
    alpha = _alpha_channel(sheet)[y : y + height, x : x + width]
    return np.where(alpha >= mask.threshold, _SOLID, 0).astype(np.uint8)


def _from_polygon(mask: MaskPolygon, width: int, height: int) -> np.ndarray:
    """Fill the outline, then punch the holes back out.

    Polygon coordinates are part-local normalized (R6), so they scale by the
    rect's own pixel size and never by the sheet's.
    """
    canvas = np.zeros((height, width), dtype=np.uint8)

    def to_pixels(flat: np.ndarray) -> np.ndarray:
        pairs = flat.reshape(-1, 2)
        scaled = np.empty_like(pairs)
        scaled[:, 0] = np.clip(pairs[:, 0] * width, 0, width - 1)
        scaled[:, 1] = np.clip(pairs[:, 1] * height, 0, height - 1)
        return np.round(scaled).astype(np.int32)

    outline = to_pixels(Buffers.read_f32(mask.outline))
    if outline.shape[0] < 3:
        raise RigError("A polygon mask needs at least three outline points.")
    cv2.fillPoly(canvas, [outline], _SOLID)
    for hole in mask.holes:
        points = to_pixels(Buffers.read_f32(hole))
        if points.shape[0] >= 3:
            cv2.fillPoly(canvas, [points], 0)
    return canvas


def _from_rle(
    mask: MaskRle,
    bounds: Tuple[int, int, int, int],
) -> np.ndarray:
    """Decode column-major alternating runs, then place them inside the rect.

    The runs are authored against ``MaskRle.origin`` in SOURCE pixels while the
    raster this returns is indexed from the rect's origin. Those two agree for
    a mask decompose produced, but they are separate fields and a correction
    pass can move a rect; offsetting explicitly is cheaper than trusting that
    they still coincide.
    """
    x, y, rect_w, rect_h = bounds
    counts = np.asarray(Buffers.read_f32(mask.counts), dtype=np.int64)
    total = mask.width * mask.height
    if int(counts.sum()) != total:
        raise RigError(
            f"RLE runs sum to {int(counts.sum())} but the mask is "
            f"{mask.width}x{mask.height} = {total} pixels."
        )

    # Runs alternate starting with background, so odd-indexed runs are solid.
    flat = np.zeros(total, dtype=np.uint8)
    cursor = 0
    for index, run in enumerate(counts.tolist()):
        if run <= 0:
            continue
        if index % 2 == 1:
            flat[cursor : cursor + run] = _SOLID
        cursor += run
    decoded = flat.reshape((mask.height, mask.width), order="F")

    canvas = np.zeros((rect_h, rect_w), dtype=np.uint8)
    offset_x = int(round(mask.origin.x)) - x
    offset_y = int(round(mask.origin.y)) - y
    dst_x0 = max(0, offset_x)
    dst_y0 = max(0, offset_y)
    src_x0 = max(0, -offset_x)
    src_y0 = max(0, -offset_y)
    copy_w = min(rect_w - dst_x0, mask.width - src_x0)
    copy_h = min(rect_h - dst_y0, mask.height - src_y0)
    if copy_w > 0 and copy_h > 0:
        canvas[dst_y0 : dst_y0 + copy_h, dst_x0 : dst_x0 + copy_w] = decoded[
            src_y0 : src_y0 + copy_h, src_x0 : src_x0 + copy_w
        ]
    return canvas


class Raster:
    """Mask description to part-local binary raster."""

    __slots__ = ()

    @staticmethod
    def for_part(
        part: Part,
        sheet: Optional[np.ndarray],
        sheet_w: int,
        sheet_h: int,
    ) -> PartRaster:
        """Resolve one part's mask. Raises ``RigError`` on an unusable mask."""
        bounds = rect_pixel_bounds(part, sheet_w, sheet_h)
        x, y, width, height = bounds

        if isinstance(part.mask, MaskRect):
            raster = _from_rect(width, height)
        elif isinstance(part.mask, MaskAlphaThreshold):
            raster = _from_alpha_threshold(part.mask, sheet, bounds)
        elif isinstance(part.mask, MaskPolygon):
            raster = _from_polygon(part.mask, width, height)
        elif isinstance(part.mask, MaskRle):
            raster = _from_rle(part.mask, bounds)
        else:  # pragma: no cover - the union is closed by the schema
            raise RigError(f'Unsupported mask kind "{part.mask.kind}".')

        return PartRaster(
            part_id=part.id,
            mask=raster,
            width=width,
            height=height,
            origin_x=x,
            origin_y=y,
            solid_pixels=int(np.count_nonzero(raster)),
        )

    @staticmethod
    def needs_sheet(part: Part) -> bool:
        """Whether resolving this part's mask requires the source pixels.

        Only ``alpha-threshold`` does: rect, polygon and RLE masks are
        self-describing, which is what lets a re-rig of a corrected
        decomposition run without re-fetching the sheet.
        """
        return isinstance(part.mask, MaskAlphaThreshold)

    @staticmethod
    def is_meshable(raster: PartRaster) -> bool:
        """Whether the raster carries enough area to triangulate.

        The area test is in part-local normalized units so it means the same
        thing for a 32px icon and a 2000px torso, and it uses the schema's own
        ``MIN_TRIANGLE_AREA`` — a part whose entire mask is smaller than one
        renderable triangle cannot produce a mesh worth having.
        """
        if raster.width < RigConstants.MIN_PART_EDGE_PX:
            return False
        if raster.height < RigConstants.MIN_PART_EDGE_PX:
            return False
        return raster.area_fraction >= RigConstants.MIN_TRIANGLE_AREA
