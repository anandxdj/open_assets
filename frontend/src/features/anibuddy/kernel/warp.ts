// Per-triangle affine warp, distortion metric, and seam bleed.
//
// Ported from lib/deform.ts lines 202-262.
//
// Each triangle gets the unique affine map taking its rest (source) corners to
// its posed (destination) corners. The rasterizer then draws the source image
// through that map, clipped to the destination triangle. No pixels are
// invented: every output pixel is a resampled source pixel.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/warp.py.

import { KernelConstants } from "./constants";
import { Numeric } from "./numeric";
import type { WarpBatch } from "./types";

export const Warp = {
  /**
   * Build the affine warp for every triangle, plus the frame's stats.
   *
   * `srcVerts` and `dstVerts` are flat stride 2, float64, in SOURCE PIXELS.
   * `scaleX`/`scaleY` map source pixels onto the destination surface; the
   * kernel defaults to 1 and leaves that scaling to the rasterizer, which is
   * the only component that knows its own resolution.
   *
   * The operation order inside the loop -- including that d1x and d2x are
   * DELTAS from the first corner, and that the centroid is averaged from those
   * deltas rather than from the absolute corners -- has to match the Python
   * kernel term for term.
   */
  triangles(
    srcVerts: Float64Array,
    dstVerts: Float64Array,
    tris: Uint32Array,
    scaleX = 1,
    scaleY = 1,
  ): WarpBatch {
    const triangleCount = tris.length / 3;
    const matrices: number[] = [];
    const bled: number[] = [];
    const kept: number[] = [];

    let maxStretch = 1;
    let flippedTriangles = 0;
    let degenerateTriangles = 0;

    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const i0 = tris[triangle * 3];
      const i1 = tris[triangle * 3 + 1];
      const i2 = tris[triangle * 3 + 2];

      const s0x = srcVerts[i0 * 2];
      const s0y = srcVerts[i0 * 2 + 1];
      const s1x = srcVerts[i1 * 2] - s0x;
      const s1y = srcVerts[i1 * 2 + 1] - s0y;
      const s2x = srcVerts[i2 * 2] - s0x;
      const s2y = srcVerts[i2 * 2 + 1] - s0y;

      // Twice the signed source area. Below the threshold the source triangle
      // is a sliver and its inverse is meaningless, so the affine map derived
      // from it would be numerical noise.
      const detS = s1x * s2y - s2x * s1y;
      if (Math.abs(detS) < KernelConstants.MIN_TRIANGLE_AREA) {
        degenerateTriangles++;
        continue;
      }

      const d0x = dstVerts[i0 * 2] * scaleX;
      const d0y = dstVerts[i0 * 2 + 1] * scaleY;
      const d1x = dstVerts[i1 * 2] * scaleX - d0x;
      const d1y = dstVerts[i1 * 2 + 1] * scaleY - d0y;
      const d2x = dstVerts[i2 * 2] * scaleX - d0x;
      const d2y = dstVerts[i2 * 2 + 1] * scaleY - d0y;

      // A = D * S^-1, in canvas order [a c; b d] with translation (e, f).
      // Canvas order, not row-major: setTransform takes (a, b, c, d, e, f) as
      // columns, so keeping the kernel in that layout means the rasterizer
      // passes it straight through.
      const a = (d1x * s2y - d2x * s1y) / detS;
      const c = (d2x * s1x - d1x * s2x) / detS;
      const b = (d1y * s2y - d2y * s1y) / detS;
      const d = (d2y * s1x - d1y * s2x) / detS;
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        !Number.isFinite(c) ||
        !Number.isFinite(d)
      ) {
        degenerateTriangles++;
        continue;
      }

      const e = d0x - (a * s0x + c * s0y);
      const f = d0y - (b * s0x + d * s0y);

      // Closed-form singular values of a 2x2. sigmaMax / sigmaMin is how far
      // this patch of artwork has been smeared out of shape: 1 means rigid,
      // large means the user's linework is being stretched into mush and
      // deserves to be told so.
      //
      // sqrt(x*x + y*y) rather than hypot: see numeric.ts. The v3 code used
      // Math.hypot here; that is the one place this port deliberately changes
      // an operation.
      const halfSum = (a + d) / 2;
      const halfDifferenceRotation = (b - c) / 2;
      const halfDifference = (a - d) / 2;
      const halfSumShear = (b + c) / 2;
      const rotationPart = Numeric.length(halfSum, halfDifferenceRotation);
      const shearPart = Numeric.length(halfDifference, halfSumShear);
      const sigmaMax = rotationPart + shearPart;
      const sigmaMin = Math.abs(rotationPart - shearPart);

      if (sigmaMin > KernelConstants.SINGULAR_EPSILON) {
        const stretch = sigmaMax / sigmaMin;
        // A collapsed triangle would report Infinity and swamp the metric, so
        // only finite ratios raise the frame's worst case.
        if (Number.isFinite(stretch) && stretch > maxStretch) maxStretch = stretch;
      }

      if (a * d - b * c < 0) flippedTriangles++;

      // Adjacent clipped triangles leave hairline antialiasing gaps along every
      // shared edge, which reads as a cracked figure. Pushing each destination
      // triangle half a pixel outward about its centroid makes neighbours
      // overlap by a hair instead.
      const centroidX = (d0x + (d0x + d1x) + (d0x + d2x)) / 3;
      const centroidY = (d0y + (d0y + d1y) + (d0y + d2y)) / 3;
      const p0 = Warp.bleed(d0x, d0y, centroidX, centroidY);
      const p1 = Warp.bleed(d0x + d1x, d0y + d1y, centroidX, centroidY);
      const p2 = Warp.bleed(d0x + d2x, d0y + d2y, centroidX, centroidY);

      matrices.push(a, b, c, d, e, f);
      bled.push(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
      kept.push(triangle);
    }

    return {
      matrices: Float32Array.from(matrices),
      bled: Float32Array.from(bled),
      triangleIndex: Uint32Array.from(kept),
      maxStretch: Numeric.scalarToStorage(maxStretch),
      flippedTriangles,
      degenerateTriangles,
    };
  },

  /**
   * Push one destination corner SEAM_BLEED px away from the centroid.
   *
   * A corner sitting on the centroid has no outward direction, so it stays put
   * rather than being pushed in an arbitrary one.
   */
  bleed(pointX: number, pointY: number, centroidX: number, centroidY: number): [number, number] {
    const vectorX = pointX - centroidX;
    const vectorY = pointY - centroidY;
    const length = Numeric.length(vectorX, vectorY);
    if (length < KernelConstants.BLEED_LENGTH_EPSILON) return [pointX, pointY];
    return [
      pointX + (vectorX / length) * KernelConstants.SEAM_BLEED,
      pointY + (vectorY / length) * KernelConstants.SEAM_BLEED,
    ];
  },
} as const;
