"""Spline ribbon warp along a joint chain, for tails, tentacles and ropes.

New in v5; no v3 browser reference exists, so this design is the reference and
the TypeScript kernel mirrors it.

The control polyline IS a chain of joints. That is the whole trick: a tail
already needs a joint chain to be posable, so reusing it as the spline's
control points means the spline is animated by ordinary forward kinematics
and needs no deformer-specific animation channels. Rest control points come
from the joints' rest positions, posed control points from the FK solve.

The emitted geometry is a ribbon: two vertices per sample, offset along the
curve normal by half the LOCAL thickness, and two triangles per segment. Source
vertices come from running the identical evaluation over the REST control
points, so the artwork slides along the curve rather than swimming across it.

Taper
-----
``SplineDeformer.thickness`` is a track, not a scalar, and it is indexed by
normalized position along the spine rather than by joint: with ``m`` entries,
the width at curve parameter ``u`` is the track sampled at ``u * (m - 1)``.
Decoupling the track's length from the chain's is what lets a chain the joint
budget cut short still taper over its whole length, and it makes ``m == 1``
a uniform ribbon rather than a special case anyone has to branch on.

The same half-width is used for the rest ribbon and the posed one. Tapering
the posed ribbon alone would change the artwork's width without changing where
it reads from, which is a texture stretch rather than a shape.
"""

from __future__ import annotations

import numpy as np

from .constants import KernelConstants
from .curves import Curves
from .numeric import Numeric
from .types import INDEX_DTYPE, Asset, SolvedSkeleton, SplineDeformer


class Spline:
    """Spline evaluation. Pure; takes control points, returns a ribbon mesh."""

    __slots__ = ()

    @staticmethod
    def evaluate(
        deformer: SplineDeformer,
        asset: Asset,
        skeleton: SolvedSkeleton,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return ``(src_verts, dst_verts, tris)`` in source pixels, float64."""

        rest_points = [
            skeleton.rest_positions[joint_id]
            for joint_id in deformer.joints
            if joint_id in skeleton.rest_positions
        ]
        posed_points = [
            skeleton.positions.get(joint_id, skeleton.rest_positions[joint_id])
            for joint_id in deformer.joints
            if joint_id in skeleton.rest_positions
        ]
        if len(rest_points) < 2:
            raise ValueError("A spline deformer needs at least two resolvable joints.")

        figure_height = float(asset.figure_height)
        half_widths = tuple(
            (value * figure_height) / 2.0 for value in deformer.thickness
        )
        src = Spline.ribbon(rest_points, deformer.segments, half_widths)
        dst = Spline.ribbon(posed_points, deformer.segments, half_widths)
        return src, dst, Spline.triangulate(deformer.segments)

    @staticmethod
    def half_width_at(half_widths: tuple[float, ...], k: int, segments: int) -> float:
        """The taper track sampled at the ``k``-th of ``segments + 1`` samples.

        ``(k * (m - 1)) / segments`` multiplies before dividing, matching the
        parameter arithmetic in ``ribbon`` and the degree conversion in
        ``numeric``. Written the other way it is a different function in the
        last bit, and this value scales every ribbon vertex.
        """

        last = len(half_widths) - 1
        if last <= 0:
            return half_widths[0]
        track = (k * last) / segments
        index = int(track)
        if index > last - 1:
            index = last - 1
        local = track - index
        low = half_widths[index]
        return low + (half_widths[index + 1] - low) * local

    @staticmethod
    def ribbon(
        points: list[tuple[float, float]],
        segments: int,
        half_widths: tuple[float, ...],
    ) -> np.ndarray:
        """Sample the curve and offset each sample along its normal.

        Shape ``(2 * (segments + 1), 2)``. Vertex ``2k`` sits on the positive
        normal side, ``2k + 1`` on the negative, so the ribbon's two rails
        interleave and the triangle indices below stay simple.

        Samples are spaced uniformly in PARAMETER, not in arc length.
        Arc-length reparameterization would need an iterative solve whose
        convergence path is one more thing to keep identical across two
        languages, and the visual difference on a joint chain with roughly
        even spacing is not worth that risk.
        """

        span_count = len(points) - 1
        sample_count = segments + 1
        out = np.empty((sample_count * 2, 2), dtype=np.float64)

        fallback_x, fallback_y = Spline._chord_direction(points)

        for k in range(sample_count):
            half_thickness = Spline.half_width_at(half_widths, k, segments)
            # (k * spans) / segments, multiply first, to match the TS kernel.
            global_t = (k * span_count) / segments
            span = int(global_t)
            if span > span_count - 1:
                span = span_count - 1
            local_t = global_t - span

            p0 = points[span - 1] if span - 1 >= 0 else points[0]
            p1 = points[span]
            p2 = points[span + 1]
            p3 = points[span + 2] if span + 2 < len(points) else points[len(points) - 1]

            b0, b1, b2, b3 = Curves.catmull_rom_to_bezier(p0, p1, p2, p3)
            x, y, tangent_x, tangent_y = Curves.bezier_point_and_tangent(b0, b1, b2, b3, local_t)

            length = Numeric.length(tangent_x, tangent_y)
            if length < KernelConstants.SPLINE_TANGENT_EPSILON:
                # Coincident control points leave no direction to rotate the
                # normal from. Falling back to the overall chord is stateless,
                # so both kernels reach it identically; carrying the previous
                # sample's normal forward would make the result depend on which
                # samples happened to be degenerate.
                normal_x = -fallback_y
                normal_y = fallback_x
            else:
                normal_x = -tangent_y / length
                normal_y = tangent_x / length

            out[k * 2, 0] = x + normal_x * half_thickness
            out[k * 2, 1] = y + normal_y * half_thickness
            out[k * 2 + 1, 0] = x - normal_x * half_thickness
            out[k * 2 + 1, 1] = y - normal_y * half_thickness

        return out

    @staticmethod
    def triangulate(segments: int) -> np.ndarray:
        """Two triangles per segment, ``(segments * 2, 3)`` uint32.

        Winding matches the lattice grid so a rig mixing deformers reports
        orientation flips consistently.
        """

        tris = np.empty((segments * 2, 3), dtype=INDEX_DTYPE)
        for k in range(segments):
            a = k * 2
            b = a + 1
            c = a + 3
            d = a + 2
            tris[k * 2] = (a, b, c)
            tris[k * 2 + 1] = (a, c, d)
        return tris

    @staticmethod
    def _chord_direction(points: list[tuple[float, float]]) -> tuple[float, float]:
        """Unit direction from the first control point to the last.

        Used only as the degenerate-tangent fallback. If the chain itself is a
        single point there is genuinely no direction, so it resolves to +x --
        an arbitrary but deterministic choice, identical in both kernels.
        """

        dx = points[len(points) - 1][0] - points[0][0]
        dy = points[len(points) - 1][1] - points[0][1]
        length = Numeric.length(dx, dy)
        if length < KernelConstants.SPLINE_TANGENT_EPSILON:
            return 1.0, 0.0
        return dx / length, dy / length
