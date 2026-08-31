// Spline ribbon warp along a joint chain, for tails, tentacles and ropes.
//
// New in v5; no v3 reference exists, so this design and the Python twin are the
// reference for each other.
//
// The control polyline IS a chain of joints. That is the whole trick: a tail
// already needs a joint chain to be posable, so reusing it as the spline's
// control points means the spline is animated by ordinary forward kinematics
// and needs no deformer-specific animation channels. Rest control points come
// from the joints' rest positions, posed control points from the FK solve.
//
// The emitted geometry is a ribbon: two vertices per sample, offset along the
// curve normal by half the LOCAL thickness, and two triangles per segment.
// Source vertices come from running the identical evaluation over the REST
// control points, so the artwork slides along the curve rather than swimming
// across it.
//
// Taper
// -----
// SplineDeformer.thickness is a track, not a scalar, and it is indexed by
// normalized position along the spine rather than by joint: with m entries, the
// width at curve parameter u is the track sampled at u * (m - 1). Decoupling the
// track's length from the chain's is what lets a chain the joint budget cut
// short still taper over its whole length, and it makes m === 1 a uniform ribbon
// rather than a special case anyone has to branch on.
//
// The same half-width is used for the rest ribbon and the posed one. Tapering
// the posed ribbon alone would change the artwork's width without changing where
// it reads from, which is a texture stretch rather than a shape.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/spline.py.

import { KernelConstants } from "./constants";
import { Curves } from "./curves";
import { Numeric } from "./numeric";
import type { Asset, DeformedMesh, Point, SolvedSkeleton, SplineDeformer } from "./types";

export const Spline = {
  evaluate(deformer: SplineDeformer, asset: Asset, skeleton: SolvedSkeleton): DeformedMesh {
    const restPoints: Point[] = [];
    const posedPoints: Point[] = [];
    for (const jointId of deformer.joints) {
      const rest = skeleton.restPositions.get(jointId);
      if (!rest) continue;
      restPoints.push(rest);
      posedPoints.push(skeleton.positions.get(jointId) ?? rest);
    }
    if (restPoints.length < 2) {
      throw new Error("A spline deformer needs at least two resolvable joints.");
    }

    const halfWidths = deformer.thickness.map((value) => (value * asset.figureHeight) / 2);
    if (halfWidths.length === 0) {
      throw new Error("A spline deformer needs at least one thickness value.");
    }
    return {
      srcVerts: Spline.ribbon(restPoints, deformer.segments, halfWidths),
      dstVerts: Spline.ribbon(posedPoints, deformer.segments, halfWidths),
      tris: Spline.triangulate(deformer.segments),
    };
  },

  /**
   * The taper track sampled at the k-th of (segments + 1) samples.
   *
   * `(k * (m - 1)) / segments` multiplies before dividing, matching the
   * parameter arithmetic in `ribbon` and the degree conversion in `numeric`.
   * Written the other way it is a different function in the last bit, and this
   * value scales every ribbon vertex.
   */
  halfWidthAt(halfWidths: readonly number[], k: number, segments: number): number {
    const last = halfWidths.length - 1;
    if (last <= 0) return halfWidths[0];
    const track = (k * last) / segments;
    let index = Math.floor(track);
    if (index > last - 1) index = last - 1;
    const local = track - index;
    const low = halfWidths[index];
    return low + (halfWidths[index + 1] - low) * local;
  },

  /**
   * Sample the curve and offset each sample along its normal.
   *
   * Flat stride 2, 2 * (segments + 1) points. Vertex 2k sits on the positive
   * normal side, 2k + 1 on the negative, so the ribbon's two rails interleave
   * and the triangle indices below stay simple.
   *
   * Samples are spaced uniformly in PARAMETER, not in arc length. Arc-length
   * reparameterization would need an iterative solve whose convergence path is
   * one more thing to keep identical across two languages, and the visual
   * difference on a joint chain with roughly even spacing is not worth that
   * risk.
   */
  ribbon(points: Point[], segments: number, halfWidths: readonly number[]): Float64Array {
    const spanCount = points.length - 1;
    const sampleCount = segments + 1;
    const out = new Float64Array(sampleCount * 4);

    const [fallbackX, fallbackY] = Spline.chordDirection(points);

    for (let k = 0; k < sampleCount; k++) {
      const halfThickness = Spline.halfWidthAt(halfWidths, k, segments);
      // (k * spans) / segments, multiply first, to match the Python kernel.
      const globalT = (k * spanCount) / segments;
      let span = Math.floor(globalT);
      if (span > spanCount - 1) span = spanCount - 1;
      const localT = globalT - span;

      const p0 = span - 1 >= 0 ? points[span - 1] : points[0];
      const p1 = points[span];
      const p2 = points[span + 1];
      const p3 = span + 2 < points.length ? points[span + 2] : points[points.length - 1];

      const bezier = Curves.catmullRomToBezier(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      const [x, y, tangentX, tangentY] = Curves.bezierPointAndTangent(
        bezier[0],
        bezier[1],
        bezier[2],
        bezier[3],
        bezier[4],
        bezier[5],
        bezier[6],
        bezier[7],
        localT,
      );

      const length = Numeric.length(tangentX, tangentY);
      let normalX: number;
      let normalY: number;
      if (length < KernelConstants.SPLINE_TANGENT_EPSILON) {
        // Coincident control points leave no direction to rotate the normal
        // from. Falling back to the overall chord is stateless, so both kernels
        // reach it identically; carrying the previous sample's normal forward
        // would make the result depend on which samples happened to be
        // degenerate.
        normalX = -fallbackY;
        normalY = fallbackX;
      } else {
        normalX = -tangentY / length;
        normalY = tangentX / length;
      }

      out[k * 4] = x + normalX * halfThickness;
      out[k * 4 + 1] = y + normalY * halfThickness;
      out[k * 4 + 2] = x - normalX * halfThickness;
      out[k * 4 + 3] = y - normalY * halfThickness;
    }

    return out;
  },

  /**
   * Two triangles per segment.
   *
   * Winding matches the lattice grid so a rig mixing deformers reports
   * orientation flips consistently.
   */
  triangulate(segments: number): Uint32Array {
    const tris = new Uint32Array(segments * 6);
    for (let k = 0; k < segments; k++) {
      const a = k * 2;
      tris[k * 6] = a;
      tris[k * 6 + 1] = a + 1;
      tris[k * 6 + 2] = a + 3;
      tris[k * 6 + 3] = a;
      tris[k * 6 + 4] = a + 3;
      tris[k * 6 + 5] = a + 2;
    }
    return tris;
  },

  /**
   * Unit direction from the first control point to the last.
   *
   * Used only as the degenerate-tangent fallback. If the chain itself is a
   * single point there is genuinely no direction, so it resolves to +x -- an
   * arbitrary but deterministic choice, identical in both kernels.
   */
  chordDirection(points: Point[]): [number, number] {
    const dx = points[points.length - 1].x - points[0].x;
    const dy = points[points.length - 1].y - points[0].y;
    const length = Numeric.length(dx, dy);
    if (length < KernelConstants.SPLINE_TANGENT_EPSILON) return [1, 0];
    return [dx / length, dy / length];
  },
} as const;
