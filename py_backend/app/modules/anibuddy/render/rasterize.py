"""Per-triangle affine warp of the user's own pixels, layered by ``zIndex``.

Ported in behaviour from ``frontend/src/features/anibuddy/lib/deform.ts``
lines 202-274 — the render loop, not the math. The math it used is already in
``kernel/warp.py`` and is parity-locked; this module consumes ``Warp.triangles``
output and never re-derives a matrix.

**One code path.** All four deformers emit the same shape: a posed triangle mesh
in source pixels plus the rest mesh as texture coordinates. ``rigid`` is two
triangles, ``mesh`` is a skinned triangulation, ``lattice`` is a warped grid,
``spline`` is a ribbon — and this file cannot tell them apart. That uniformity
is what makes the layered-cutout model tractable, and adding a fifth deformer
must not add a branch here.

**No pixel is ever invented** (R2). Every output sample is a bilinear
resampling of the user's artwork through ``A = D·S⁻¹``, or it is transparent.

Forward-clip versus inverse-map
-------------------------------
The browser draws forward: clip to the destination triangle, set the transform,
blit the whole sheet. Canvas has no inverse-map primitive, so that was the only
option there. Here the same result is produced by inverting ``A`` and gathering,
which is both faster in NumPy and better behaved in one specific way worth
naming: a **per-pixel triangle label map** gives each destination pixel exactly
one owning triangle, so the seam-bleed overlap band is *resolved* rather than
composited twice. The browser's sequential ``clip`` + ``drawImage`` blends the
band against itself, which darkens semi-transparent artwork along every shared
edge. A WebGL preview drawing triangles into a part's own framebuffer behaves
like this file, not like the v3 canvas path, so this is the convergent choice
rather than a divergence.

Alpha
-----
Everything is **premultiplied** float32 while it is being sampled and
composited, and straight only at the boundaries. Bilinear resampling of straight
alpha pulls the RGB of fully transparent pixels into the antialiased fringe of a
cutout, which shows up as a dark or white halo around the figure — the single
most visible way a cutout renderer can be wrong on transparent artwork.
"""

from __future__ import annotations

from typing import Dict, Optional, Sequence, Tuple

import cv2
import numpy as np

from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.kernel import KernelFrame, PartGeometry
from app.modules.anibuddy.render.types import (
    FrameStats,
    PartComposite,
    PartSource,
    RenderError,
    RenderSurface,
)
from app.modules.anibuddy.rig.raster import Raster, rect_pixel_bounds
from app.modules.anibuddy.rig.types import RigError
from app.modules.anibuddy.schemas import RigDocument

_POLY_SCALE: float = float(1 << RenderConstants.POLY_SHIFT_BITS)
_CHANNELS: int = 4
_ALPHA: int = 3
_UINT8_MAX: float = 255.0


def _premultiply(straight: np.ndarray) -> np.ndarray:
    """Straight uint8 RGBA to premultiplied float32 RGBA in 0..1."""
    scaled = straight.astype(np.float32) / np.float32(_UINT8_MAX)
    alpha = scaled[:, :, _ALPHA : _ALPHA + 1]
    out = np.empty_like(scaled)
    out[:, :, :_ALPHA] = scaled[:, :, :_ALPHA] * alpha
    out[:, :, _ALPHA : _ALPHA + 1] = alpha
    return out


def _unpremultiply(premultiplied: np.ndarray) -> np.ndarray:
    """Premultiplied float32 RGBA to straight uint8 RGBA.

    Below ``UNPREMULTIPLY_ALPHA_FLOOR`` the division is skipped and the pixel is
    written fully transparent black. Dividing a value that survived float32
    rounding by an alpha of 1/255 amplifies its quantization error 255-fold,
    which paints visible colour speckle into the near-empty fringe of an
    antialiased edge — the exact place a cutout is judged.
    """
    alpha = premultiplied[:, :, _ALPHA]
    safe = np.maximum(alpha, np.float32(RenderConstants.UNPREMULTIPLY_ALPHA_FLOOR))
    straight = np.empty_like(premultiplied)
    straight[:, :, :_ALPHA] = premultiplied[:, :, :_ALPHA] / safe[:, :, None]
    straight[:, :, _ALPHA] = alpha
    opaque_enough = alpha >= np.float32(RenderConstants.UNPREMULTIPLY_ALPHA_FLOOR)
    straight[:, :, :_ALPHA] *= opaque_enough[:, :, None]
    return np.clip(straight * np.float32(_UINT8_MAX), 0.0, _UINT8_MAX).round().astype(
        np.uint8
    )


def _background_pixel(background: str) -> np.ndarray:
    """The premultiplied RGBA a frame starts from.

    A matte is opaque, so its premultiplied RGB equals its straight RGB. Stated
    rather than implied because the one-line equality is what makes the matte
    path share the composite code with the transparent path.
    """
    if background == RenderConstants.BACKGROUND_TRANSPARENT:
        return np.zeros(_CHANNELS, dtype=np.float32)
    rgb = RenderConstants.BACKGROUND_RGB.get(background)
    if rgb is None:
        raise RenderError(f'Unknown render background "{background}".')
    return np.array(
        [rgb[0] / _UINT8_MAX, rgb[1] / _UINT8_MAX, rgb[2] / _UINT8_MAX, 1.0],
        dtype=np.float32,
    )


class Rasterizer:
    """Turn posed kernel geometry into composited frames."""

    __slots__ = ()

    # --- Source preparation ------------------------------------------------

    @staticmethod
    def part_sources(
        document: RigDocument,
        sheet_rgba: np.ndarray,
        warn,
    ) -> Dict[str, PartSource]:
        """Crop and mask-gate each part's pixels once, for the whole clip.

        The mask gate is load-bearing rather than cosmetic. A ``rigid`` part is
        two triangles spanning its entire ``rect``, so without gating on the
        mask it would resample every neighbour's artwork that happens to overlap
        that rect and draw it as its own. That is not a subtle artifact — it is
        an arm carrying a rectangle of torso with it.

        R8 is preserved: the sheet is never written to. What is built here is a
        *copy* cropped to the rect with the mask applied as an alpha multiplier,
        which is the mask being read as the reversible description it already
        is. ``rig/raster.py`` resolves all four mask kinds and is reused rather
        than reimplemented — four mask kinds decoded in two places is four
        chances for the rig stage's mesh and the render's pixels to disagree
        about which pixels a part owns.

        Done once per render rather than once per frame because a mask does not
        move: only the vertices that sample through it do.
        """
        sheet_h, sheet_w = sheet_rgba.shape[:2]
        sources: Dict[str, PartSource] = {}

        for part in document.parts:
            try:
                raster = Raster.for_part(part, sheet_rgba, sheet_w, sheet_h)
            except RigError as error:
                raise RenderError(
                    f'Part "{part.id}" has an unusable mask: {error}'
                ) from error

            x, y, width, height = rect_pixel_bounds(part, sheet_w, sheet_h)
            crop = sheet_rgba[y : y + height, x : x + width]
            tile = _premultiply(crop)

            gate = raster.mask.astype(np.float32) / np.float32(_UINT8_MAX)
            tile *= gate[:, :, None]

            solid = int(np.count_nonzero(tile[:, :, _ALPHA] > 0.0))
            if solid == 0:
                warn(
                    f'Part "{part.id}" has no opaque pixels inside its mask, so '
                    "it contributes nothing to the render."
                )

            sources[part.id] = PartSource(
                part_id=part.id,
                tile=tile,
                origin_x=x,
                origin_y=y,
                solid_pixels=solid,
            )

        return sources

    # --- Frame assembly ----------------------------------------------------

    @staticmethod
    def frame(
        geometry_by_part: Dict[str, PartGeometry],
        composites: Sequence[PartComposite],
        sources: Dict[str, PartSource],
        surface: RenderSurface,
        background: str,
        sheet_width: int,
        sheet_height: int,
    ) -> Tuple[np.ndarray, FrameStats]:
        """Composite one frame. Returns straight uint8 RGBA and its stats.

        Layers are drawn back to front in the order ``composites`` arrives in,
        which the ``PartPose`` sampler has already sorted by resolved z-index.
        Draw order is decided there and obeyed here; this function never sorts,
        so there is exactly one place a z-order bug can live.

        Geometry and pixels are looked up under DIFFERENT ids. They coincide for
        every part that is not swapped, and a ``swapTo`` separates them: the
        referring part's mesh is drawn, sampling the target part's crop of the
        sheet. ``sheet_width``/``sheet_height`` are needed because
        ``PartComposite.uv_remap`` is sheet-normalized — one definition of the
        remap, shared with the browser's shader, converted to pixels at the one
        place that works in pixels.
        """
        canvas = np.empty(
            (surface.height, surface.width, _CHANNELS), dtype=np.float32
        )
        canvas[:, :] = _background_pixel(background)

        stats = FrameStats()
        for entry in composites:
            geometry = geometry_by_part.get(entry.part_id)
            texture = sources.get(entry.texture_part_id)
            if geometry is None or texture is None:
                continue
            # Gated on the TEXTURE's pixels, not the referring part's. A swapped
            # layer draws its own triangles out of someone else's artwork, so
            # whether its own crop happens to be empty decides nothing; whether
            # the artwork it samples is empty decides everything.
            if texture.solid_pixels == 0:
                continue
            drawn = Rasterizer._draw_part(
                canvas,
                geometry,
                texture,
                entry.uv_remap,
                entry.opacity,
                surface,
                stats,
                sheet_width,
                sheet_height,
            )
            if drawn:
                stats.drawn_parts += 1

        return _unpremultiply(canvas), stats

    @staticmethod
    def _draw_part(
        canvas: np.ndarray,
        geometry: PartGeometry,
        source: PartSource,
        uv_remap: Tuple[float, float, float, float],
        opacity: float,
        surface: RenderSurface,
        stats: FrameStats,
        sheet_width: int,
        sheet_height: int,
    ) -> bool:
        """Warp and composite one part's triangles onto ``canvas``.

        Four steps, in this order for a reason:

        1. **Label map.** Every surviving triangle's bled destination polygon is
           filled with its own row index. Later rows overwrite earlier ones, so
           each destination pixel ends up owned by exactly one triangle and the
           seam-bleed band is decided rather than blended.
        2. **Vectorized inverse map.** The six inverse coefficients are gathered
           per pixel from the label, then the source coordinate is one multiply
           and add per axis across the whole bounding box. This is why the cost
           is one resample per part per frame instead of one per triangle.
        3. **One resample.** ``cv2.remap`` with bilinear interpolation over the
           premultiplied tile, transparent outside it.
        4. **Composite.** Premultiplied source-over, scaled by the layer's
           resolved opacity.

        ``source`` is the tile whose PIXELS are sampled, which is this part's own
        unless a ``swapTo`` redirected it; ``uv_remap`` is what carries this
        part's rect onto that tile's. The identity remap collapses to exactly the
        arithmetic the non-swap path always did, which is why there is no second
        branch through the resampler.
        """
        # The kernel reports its own distortion per part; it is folded in before
        # any early return so a part that lands entirely off-canvas still gets
        # its stretch and flip counts disclosed.
        warp = geometry.warp
        if warp.max_stretch > stats.max_stretch:
            stats.max_stretch = float(warp.max_stretch)
        stats.flipped_triangles += int(warp.flipped_triangles)
        stats.degenerate_triangles += int(warp.degenerate_triangles)

        kept = int(warp.bled.shape[0])
        if kept == 0:
            return False

        bled = np.asarray(warp.bled, dtype=np.float64)
        bounds = Rasterizer._destination_bounds(bled, surface)
        if bounds is None:
            return False
        x0, y0, x1, y1 = bounds
        box_w = x1 - x0
        box_h = y1 - y0

        inverse, invertible = Rasterizer._inverse_matrices(warp.matrices)
        stats.non_invertible_triangles += int(kept - int(np.count_nonzero(invertible)))

        # Every polygon is converted to fixed point in ONE vectorized step rather
        # than per triangle inside the loop below, which keeps NumPy's per-call
        # dispatch off a path that runs thousands of times per frame. Fixed point
        # because the seam bleed is sub-pixel: rounding the bled corners to whole
        # pixels here would discard exactly the half-pixel overlap they exist to
        # create, and the hairline cracks would come back.
        polygons = np.round((bled - (x0, y0)) * _POLY_SCALE).astype(np.int32)

        label = np.zeros((box_h, box_w), dtype=np.int32)
        for row in np.flatnonzero(invertible).tolist():
            # Rows without an inverse are skipped rather than filled: there is no
            # source pixel to read for their interior, and a coordinate derived
            # from a division by ~zero would smear one texel across the triangle.
            cv2.fillPoly(
                label,
                [polygons[row]],
                row + 1,
                lineType=cv2.LINE_8,
                shift=RenderConstants.POLY_SHIFT_BITS,
            )

        # bincount rather than unique: both answer "how many distinct triangles
        # contributed pixels", but unique sorts the whole label map to do it.
        occupancy = np.bincount(label.ravel(), minlength=kept + 1)
        covered_count = int(occupancy.sum() - occupancy[RenderConstants.NO_TRIANGLE_LABEL])
        if covered_count == 0:
            return False
        stats.drawn_triangles += int(
            np.count_nonzero(occupancy[RenderConstants.NO_TRIANGLE_LABEL + 1 :])
        )

        # Destination pixel CENTRES, which is what the affine map was built
        # against: a destination coordinate of x0 is the left edge of pixel x0,
        # and its centre is half a pixel further right. Sampling at edges instead
        # shifts the whole part half a pixel up and left.
        dest_x = (np.arange(x0, x1, dtype=np.float32) + np.float32(0.5))[None, :]
        dest_y = (np.arange(y0, y1, dtype=np.float32) + np.float32(0.5))[:, None]

        # Row 0 of the gathered coefficients is the "no triangle" sentinel, and
        # ``_inverse_matrices`` parks it far outside any tile. So an uncovered
        # pixel resolves to the resampler's transparent border and the coverage
        # mask is applied THROUGH the sampler. The obvious alternative -- keep the
        # boolean mask and multiply the sampled buffer by it -- measured as the
        # single most expensive step in the whole rasterizer, because it walks
        # every pixel of every layer of every frame twice more.
        gathered = inverse[label]
        source_x = gathered[:, :, 0] * dest_x + gathered[:, :, 1] * dest_y + gathered[:, :, 2]
        source_y = gathered[:, :, 3] * dest_x + gathered[:, :, 4] * dest_y + gathered[:, :, 5]

        # Sheet pixels to tile pixel-centre coordinates, through the layer's uv
        # remap. The half-pixel is the mirror of the one above: sheet coordinate
        # ``origin_x + 0.5`` is the centre of tile column 0, which is where
        # ``remap`` expects index 0.
        #
        # The remap's offset is sheet-NORMALIZED, so it is scaled to pixels here
        # and folded into the same subtraction rather than applied as a separate
        # pass over every pixel of every layer. The scale is skipped when it is
        # exactly 1, which is every part that is not swapped: multiplying by 1.0
        # is a no-op in value but not in allocation, and this array is one per
        # layer per frame. Written in place — every operand is already contiguous
        # float32, so ``remap`` takes these without a conversion copy.
        scale_x, scale_y, offset_x, offset_y = uv_remap
        if scale_x != RenderConstants.IDENTITY_UV_REMAP[0]:
            source_x *= np.float32(scale_x)
        if scale_y != RenderConstants.IDENTITY_UV_REMAP[1]:
            source_y *= np.float32(scale_y)
        source_x -= np.float32(source.origin_x + 0.5 - offset_x * sheet_width)
        source_y -= np.float32(source.origin_y + 0.5 - offset_y * sheet_height)

        sampled = cv2.remap(
            source.tile,
            source_x,
            source_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0.0, 0.0, 0.0, 0.0),
        ).reshape(box_h, box_w, _CHANNELS)

        if opacity < 1.0:
            # Scaling all four channels is correct precisely because the buffer
            # is premultiplied: a premultiplied pixel times k is the same pixel
            # at k times the coverage. In straight alpha this would need two
            # different multiplies and would be a classic place to get it wrong.
            sampled *= np.float32(opacity)

        # Premultiplied source-over, in place on the canvas view.
        target = canvas[y0:y1, x0:x1]
        target *= np.float32(1.0) - sampled[:, :, _ALPHA : _ALPHA + 1]
        target += sampled
        return True

    # --- Helpers ----------------------------------------------------------

    @staticmethod
    def _destination_bounds(
        bled: np.ndarray,
        surface: RenderSurface,
    ) -> Optional[Tuple[int, int, int, int]]:
        """Integer bounding box of the bled triangles, clipped to the surface.

        ``floor`` on the low edge and ``ceil`` on the high edge, so a triangle
        covering any part of a pixel gets that pixel offered to the coverage
        test rather than excluded by rounding before the test runs.
        """
        flat = bled.reshape(-1, 2)
        if flat.size == 0 or not np.all(np.isfinite(flat)):
            return None
        x0 = int(np.floor(float(np.min(flat[:, 0]))))
        y0 = int(np.floor(float(np.min(flat[:, 1]))))
        x1 = int(np.ceil(float(np.max(flat[:, 0]))))
        y1 = int(np.ceil(float(np.max(flat[:, 1]))))

        x0 = max(0, min(x0, surface.width))
        y0 = max(0, min(y0, surface.height))
        x1 = max(0, min(x1, surface.width))
        y1 = max(0, min(y1, surface.height))
        if x1 <= x0 or y1 <= y0:
            return None
        return x0, y0, x1, y1

    @staticmethod
    def _inverse_matrices(matrices: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Invert every ``(a, b, c, d, e, f)`` warp, returning gather rows.

        The kernel stores ``A`` in canvas order ``[a c; b d]`` with translation
        ``(e, f)``, mapping SOURCE to DESTINATION. Rasterizing by gather needs
        the other direction, so this is ``A⁻¹`` written out in closed form:

            destination = [a c; b d] · source + (e, f)
            source      = [d -c; -b a] / det · (destination - (e, f))

        Returned as ``(rows + 1, 6)`` with row 0 reserved for the "no triangle"
        label, so the per-pixel gather is a single fancy-index rather than a
        masked lookup. That row is not zero: it maps every uncovered pixel to
        ``UNCOVERED_SOURCE_COORDINATE``, which is outside any tile, so the
        resampler's transparent border does the masking for free. A zero row
        would map them to source ``(0, 0)`` and sample real artwork there.

        A flipped triangle (negative determinant) is inverted and drawn like any
        other, matching the browser: the flip is *reported* through
        ``flippedTriangles`` rather than being grounds to drop the artwork.
        """
        rows = int(matrices.shape[0])
        data = np.asarray(matrices, dtype=np.float64)
        a = data[:, 0]
        b = data[:, 1]
        c = data[:, 2]
        d = data[:, 3]
        e = data[:, 4]
        f = data[:, 5]

        det = a * d - b * c
        invertible = np.isfinite(det) & (
            np.abs(det) >= RenderConstants.MIN_INVERTIBLE_DET
        )
        safe = np.where(invertible, det, 1.0)

        out = np.zeros((rows + 1, 6), dtype=np.float32)
        out[RenderConstants.NO_TRIANGLE_LABEL, 2] = (
            RenderConstants.UNCOVERED_SOURCE_COORDINATE
        )
        out[RenderConstants.NO_TRIANGLE_LABEL, 5] = (
            RenderConstants.UNCOVERED_SOURCE_COORDINATE
        )
        out[1:, 0] = d / safe
        out[1:, 1] = -c / safe
        out[1:, 2] = (c * f - d * e) / safe
        out[1:, 3] = -b / safe
        out[1:, 4] = a / safe
        out[1:, 5] = (b * e - a * f) / safe
        # A non-invertible row is never filled into the label map, so it is never
        # gathered. Parked outside the tile anyway, so that a future caller that
        # does reach it gets transparency rather than the artwork at source (0, 0).
        out[1:][~invertible] = 0.0
        out[1:, 2][~invertible] = RenderConstants.UNCOVERED_SOURCE_COORDINATE
        out[1:, 5][~invertible] = RenderConstants.UNCOVERED_SOURCE_COORDINATE
        return out, invertible

    @staticmethod
    def index_geometry(frame: KernelFrame) -> Dict[str, PartGeometry]:
        """Kernel frame parts keyed by part id.

        The kernel evaluates parts in rig order, not z-order, and says so: draw
        order is the rasterizer's problem. Indexing by id once per frame is how
        the rasterizer solves it without asking the kernel to reshuffle its
        output arrays and invalidate every golden fixture.
        """
        return {part.part_id: part for part in frame.parts}
