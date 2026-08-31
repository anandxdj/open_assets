"""Per-triangle affine warp, distortion metric, and seam bleed.

Ported from ``frontend/src/features/anibuddy/lib/deform.ts`` lines 202-262.

Each triangle gets the unique affine map taking its rest (source) corners to
its posed (destination) corners. The rasterizer then draws the source image
through that map, clipped to the destination triangle. No pixels are
invented: every output pixel is a resampled source pixel.
"""

from __future__ import annotations

import math

import numpy as np

from .constants import KernelConstants
from .numeric import Numeric
from .types import WarpBatch


class Warp:
    """Triangle warp math. Pure; operates on posed vertex arrays only."""

    __slots__ = ()

    @staticmethod
    def triangles(
        src_verts: np.ndarray,
        dst_verts: np.ndarray,
        tris: np.ndarray,
        scale_x: float = 1.0,
        scale_y: float = 1.0,
    ) -> WarpBatch:
        """Build the affine warp for every triangle, plus the frame's stats.

        ``src_verts`` and ``dst_verts`` are (N, 2) float64 in SOURCE PIXELS.
        ``scale_x``/``scale_y`` map source pixels onto the destination
        surface; the kernel defaults to 1 and leaves that scaling to the
        rasterizer, which is the only component that knows its own resolution.

        The loop is scalar rather than vectorized on purpose. It is the most
        line-by-line comparable code in the kernel, and the operation order
        inside it -- including that ``d1x`` and ``d2x`` are DELTAS from the
        first corner, and that the centroid is averaged from those deltas
        rather than from the absolute corners -- has to match the TypeScript
        kernel term for term. Triangle counts are in the thousands, so the
        cost is bounded and paid once per frame.
        """

        matrices: list[tuple[float, float, float, float, float, float]] = []
        bled: list[tuple[float, float, float, float, float, float]] = []
        kept_index: list[int] = []

        max_stretch = 1.0
        flipped_triangles = 0
        degenerate_triangles = 0

        for triangle in range(tris.shape[0]):
            i0 = int(tris[triangle, 0])
            i1 = int(tris[triangle, 1])
            i2 = int(tris[triangle, 2])

            s0x = float(src_verts[i0, 0])
            s0y = float(src_verts[i0, 1])
            s1x = float(src_verts[i1, 0]) - s0x
            s1y = float(src_verts[i1, 1]) - s0y
            s2x = float(src_verts[i2, 0]) - s0x
            s2y = float(src_verts[i2, 1]) - s0y

            # Twice the signed source area. Below the threshold the source
            # triangle is a sliver and its inverse is meaningless, so the
            # affine map derived from it would be numerical noise.
            det_s = s1x * s2y - s2x * s1y
            if abs(det_s) < KernelConstants.MIN_TRIANGLE_AREA:
                degenerate_triangles += 1
                continue

            d0x = float(dst_verts[i0, 0]) * scale_x
            d0y = float(dst_verts[i0, 1]) * scale_y
            d1x = float(dst_verts[i1, 0]) * scale_x - d0x
            d1y = float(dst_verts[i1, 1]) * scale_y - d0y
            d2x = float(dst_verts[i2, 0]) * scale_x - d0x
            d2y = float(dst_verts[i2, 1]) * scale_y - d0y

            # A = D * S^-1, in canvas order [a c; b d] with translation (e, f).
            # Canvas order, not row-major: the browser's setTransform takes
            # (a, b, c, d, e, f) as columns, and keeping the kernel in that
            # layout means the browser rasterizer passes it straight through.
            a = (d1x * s2y - d2x * s1y) / det_s
            c = (d2x * s1x - d1x * s2x) / det_s
            b = (d1y * s2y - d2y * s1y) / det_s
            d = (d2y * s1x - d1y * s2x) / det_s
            if not (math.isfinite(a) and math.isfinite(b) and math.isfinite(c) and math.isfinite(d)):
                degenerate_triangles += 1
                continue

            e = d0x - (a * s0x + c * s0y)
            f = d0y - (b * s0x + d * s0y)

            # Closed-form singular values of a 2x2. sigma_max / sigma_min is
            # how far this patch of artwork has been smeared out of shape:
            # 1 means rigid, large means the user's linework is being stretched
            # into mush and deserves to be told so.
            #
            # sqrt(x*x + y*y) rather than hypot: see numeric.py. The v3 browser
            # code used Math.hypot here; that is the one place this port
            # deliberately changes an operation.
            half_sum = (a + d) / 2.0
            half_difference_rotation = (b - c) / 2.0
            half_difference = (a - d) / 2.0
            half_sum_shear = (b + c) / 2.0
            rotation_part = Numeric.length(half_sum, half_difference_rotation)
            shear_part = Numeric.length(half_difference, half_sum_shear)
            sigma_max = rotation_part + shear_part
            sigma_min = abs(rotation_part - shear_part)

            if sigma_min > KernelConstants.SINGULAR_EPSILON:
                stretch = sigma_max / sigma_min
                # A collapsed triangle would report infinity and swamp the
                # metric, so only finite ratios raise the frame's worst case.
                if math.isfinite(stretch) and stretch > max_stretch:
                    max_stretch = stretch

            if a * d - b * c < 0.0:
                flipped_triangles += 1

            # Adjacent clipped triangles leave hairline antialiasing gaps along
            # every shared edge, which reads as a cracked figure. Pushing each
            # destination triangle half a pixel outward about its centroid
            # makes neighbours overlap by a hair instead.
            centroid_x = (d0x + (d0x + d1x) + (d0x + d2x)) / 3.0
            centroid_y = (d0y + (d0y + d1y) + (d0y + d2y)) / 3.0
            p0x, p0y = Warp._bleed(d0x, d0y, centroid_x, centroid_y)
            p1x, p1y = Warp._bleed(d0x + d1x, d0y + d1y, centroid_x, centroid_y)
            p2x, p2y = Warp._bleed(d0x + d2x, d0y + d2y, centroid_x, centroid_y)

            matrices.append((a, b, c, d, e, f))
            bled.append((p0x, p0y, p1x, p1y, p2x, p2y))
            kept_index.append(triangle)

        kept = len(kept_index)
        return WarpBatch(
            matrices=Numeric.to_storage(np.asarray(matrices, dtype=np.float64).reshape(kept, 6)),
            bled=Numeric.to_storage(np.asarray(bled, dtype=np.float64).reshape(kept, 3, 2)),
            triangle_index=np.asarray(kept_index, dtype=np.uint32).reshape(kept),
            max_stretch=Numeric.scalar_to_storage(max_stretch),
            flipped_triangles=flipped_triangles,
            degenerate_triangles=degenerate_triangles,
        )

    @staticmethod
    def _bleed(
        point_x: float,
        point_y: float,
        centroid_x: float,
        centroid_y: float,
    ) -> tuple[float, float]:
        """Push one destination corner ``SEAM_BLEED`` px away from the centroid.

        A corner sitting on the centroid has no outward direction, so it stays
        put rather than being pushed in an arbitrary one.
        """

        vector_x = point_x - centroid_x
        vector_y = point_y - centroid_y
        length = Numeric.length(vector_x, vector_y)
        if length < KernelConstants.BLEED_LENGTH_EPSILON:
            return point_x, point_y
        return (
            point_x + (vector_x / length) * KernelConstants.SEAM_BLEED,
            point_y + (vector_y / length) * KernelConstants.SEAM_BLEED,
        )
