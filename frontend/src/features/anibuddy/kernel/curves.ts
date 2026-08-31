// Catmull-Rom and Bezier primitives shared by the lattice and spline deformers.
//
// Uniform parameterization, deliberately. Centripetal Catmull-Rom behaves
// better on clustered control points, but it needs pow(distance, 0.25) per span
// -- a transcendental, in a hot loop, whose last bit is not guaranteed to agree
// between V8 and NumPy. Uniform parameterization is pure add and multiply, so
// the two kernels agree exactly. Control points here come from a lattice grid
// or a joint chain, neither of which clusters badly enough to need centripetal.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/curves.py.

import { KernelConstants } from "./constants";

export const Curves = {
  /**
   * Uniform Catmull-Rom through p1 and p2, at local t in 0..1.
   *
   * Written in expanded polynomial form, term by term, rather than Horner.
   * Horner is fewer operations but a different rounding sequence, and the
   * Python kernel has to match this expression exactly.
   *
   * Reproduces linear functions exactly, which is why a rest lattice (uniformly
   * spaced control points) evaluates through this path to the same positions a
   * plain bilinear grid would give.
   */
  catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  },

  /**
   * Convert one Catmull-Rom span into its equivalent cubic Bezier.
   *
   * The interior controls sit one sixth of the neighbouring chord away from the
   * span endpoints; that factor is what makes the piecewise curve C1 continuous
   * across spans. Working in Bezier form afterwards lets the evaluator use de
   * Casteljau, which gives the tangent for free.
   *
   * Returns a flat [b0x, b0y, b1x, b1y, b2x, b2y, b3x, b3y].
   */
  catmullRomToBezier(
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    p3x: number,
    p3y: number,
  ): [number, number, number, number, number, number, number, number] {
    const sixth = KernelConstants.CATMULL_ROM_SIXTH;
    return [
      p1x,
      p1y,
      p1x + (p2x - p0x) * sixth,
      p1y + (p2y - p0y) * sixth,
      p2x - (p3x - p1x) * sixth,
      p2y - (p3y - p1y) * sixth,
      p2x,
      p2y,
    ];
  },

  /**
   * De Casteljau evaluation returning [x, y, tangentX, tangentY].
   *
   * De Casteljau rather than the Bernstein form because the final subdivision
   * level hands back the tangent as a by-product: the last two intermediate
   * points differ by exactly one third of the derivative. One evaluation, both
   * answers, no second polynomial to keep in sync.
   */
  bezierPointAndTangent(
    b0x: number,
    b0y: number,
    b1x: number,
    b1y: number,
    b2x: number,
    b2y: number,
    b3x: number,
    b3y: number,
    t: number,
  ): [number, number, number, number] {
    const mt = 1 - t;

    const q0x = b0x * mt + b1x * t;
    const q0y = b0y * mt + b1y * t;
    const q1x = b1x * mt + b2x * t;
    const q1y = b1y * mt + b2y * t;
    const q2x = b2x * mt + b3x * t;
    const q2y = b2y * mt + b3y * t;

    const r0x = q0x * mt + q1x * t;
    const r0y = q0y * mt + q1y * t;
    const r1x = q1x * mt + q2x * t;
    const r1y = q1y * mt + q2y * t;

    return [r0x * mt + r1x * t, r0y * mt + r1y * t, (r1x - r0x) * 3, (r1y - r0y) * 3];
  },
} as const;
