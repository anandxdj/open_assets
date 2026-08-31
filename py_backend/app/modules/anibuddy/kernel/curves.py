"""Catmull-Rom and Bezier primitives shared by the lattice and spline deformers.

Uniform parameterization, deliberately. Centripetal Catmull-Rom behaves better
on clustered control points, but it needs ``pow(distance, 0.25)`` per span --
a transcendental, in a hot loop, whose last bit is not guaranteed to agree
between NumPy and V8. Uniform parameterization is pure add and multiply, so
the two kernels agree exactly. Control points here come from a lattice grid or
a joint chain, neither of which clusters badly enough to need centripetal.
"""

from __future__ import annotations

from .constants import KernelConstants


class Curves:
    """Curve evaluation whose operation order is part of the parity contract."""

    __slots__ = ()

    @staticmethod
    def catmull_rom(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
        """Uniform Catmull-Rom through ``p1`` and ``p2``, at local ``t`` in 0..1.

        Written in expanded polynomial form, term by term, rather than Horner.
        Horner is fewer operations but a different rounding sequence, and the
        TypeScript kernel has to match this expression exactly.

        Reproduces linear functions exactly, which is why a rest lattice
        (uniformly spaced control points) evaluates through this path to the
        same positions a plain bilinear grid would give.
        """

        t2 = t * t
        t3 = t2 * t
        return 0.5 * (
            (2.0 * p1)
            + (-p0 + p2) * t
            + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
            + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
        )

    @staticmethod
    def catmull_rom_to_bezier(
        p0: tuple[float, float],
        p1: tuple[float, float],
        p2: tuple[float, float],
        p3: tuple[float, float],
    ) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float], tuple[float, float]]:
        """Convert one Catmull-Rom span into its equivalent cubic Bezier.

        The interior controls sit one sixth of the neighbouring chord away
        from the span endpoints; that factor is what makes the piecewise curve
        C1 continuous across spans. Working in Bezier form afterwards lets the
        evaluator use de Casteljau, which gives the tangent for free.
        """

        sixth = KernelConstants.CATMULL_ROM_SIXTH
        b1 = (p1[0] + (p2[0] - p0[0]) * sixth, p1[1] + (p2[1] - p0[1]) * sixth)
        b2 = (p2[0] - (p3[0] - p1[0]) * sixth, p2[1] - (p3[1] - p1[1]) * sixth)
        return p1, b1, b2, p2

    @staticmethod
    def bezier_point_and_tangent(
        b0: tuple[float, float],
        b1: tuple[float, float],
        b2: tuple[float, float],
        b3: tuple[float, float],
        t: float,
    ) -> tuple[float, float, float, float]:
        """De Casteljau evaluation returning ``(x, y, tangent_x, tangent_y)``.

        De Casteljau rather than the Bernstein form because the final
        subdivision level hands back the tangent as a by-product: the last two
        intermediate points differ by exactly one third of the derivative. One
        evaluation, both answers, no second polynomial to keep in sync.
        """

        mt = 1.0 - t

        q0x = b0[0] * mt + b1[0] * t
        q0y = b0[1] * mt + b1[1] * t
        q1x = b1[0] * mt + b2[0] * t
        q1y = b1[1] * mt + b2[1] * t
        q2x = b2[0] * mt + b3[0] * t
        q2y = b2[1] * mt + b3[1] * t

        r0x = q0x * mt + q1x * t
        r0y = q0y * mt + q1y * t
        r1x = q1x * mt + q2x * t
        r1y = q1y * mt + q2y * t

        x = r0x * mt + r1x * t
        y = r0y * mt + r1y * t
        return x, y, (r1x - r0x) * 3.0, (r1y - r0y) * 3.0
