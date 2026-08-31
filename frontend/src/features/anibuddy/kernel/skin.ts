// Linear blend skinning, and the rigid transforms the other deformers reuse.
//
// Ported from lib/deform.ts `skin` (~line 152).
//
//   v' = sum_j w_j * (P_j * B_j^-1) * v
//
// Because forward kinematics preserves bone lengths (a bone's `scale` channel
// changes where the child is placed, not the bone's own basis), every bone
// transform collapses to a rotation about the rest origin plus a translation --
// no shear, no non-uniform scale, no 3x3 matrix needed. That is what makes the
// inner loop four multiplies and four adds instead of a matrix product.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/skin.py.

import { KernelConstants } from "./constants";
import { Numeric } from "./numeric";
import type { Part, PartTransform, Point, SolvedSkeleton } from "./types";

/**
 * (a, b, originX, originY) of a rotate-scale-then-place affine.
 *
 * The historical name for what types.ts now calls `PartTransform`; kept as an
 * alias because it reads better at the skinning call sites.
 */
export type RigidTransform = PartTransform;

/** The transform that changes nothing. Named because it is compared against. */
const IDENTITY: RigidTransform = [1, 0, 0, 0];

export const Skin = {
  IDENTITY,

  /**
   * Rotation by `degrees` about `restPoint`, landing on `posedPoint`.
   *
   * Delegates to `affineAboutScaled` at unit scale rather than writing the
   * formula a second time. Multiplying by exactly 1 is an IEEE no-op, so this
   * is bit-identical to the standalone version it replaced -- and one formula
   * cannot drift from itself.
   */
  affineAbout(restPoint: Point, posedPoint: Point, degrees: number): RigidTransform {
    return Skin.affineAboutScaled(restPoint, posedPoint, degrees, KernelConstants.REST_SCALE);
  },

  /**
   * Rotate by `degrees` and scale by `scale` about `restPoint`.
   *
   * Returns (a, b, originX, originY) for the map v' = M*v + origin with
   * M = scale * R, and the rest origin folded into the translation:
   * v' = M*(v - rest) + posed. Folding it means the hot loop never subtracts
   * the rest origin per vertex.
   *
   * This one function is the only place the rotate-and-place formula is
   * written, so skinning, rigid parts, lattice parts and the part transform
   * tree cannot disagree about it. `scale` is applied to the rotation matrix
   * rather than as a separate pass because a uniform scale commutes with
   * rotation -- folding it costs two multiplies and removes an ordering
   * question the two kernels would otherwise have to answer identically.
   */
  affineAboutScaled(
    restPoint: Point,
    posedPoint: Point,
    degrees: number,
    scale: number,
  ): RigidTransform {
    const radians = Numeric.radians(degrees);
    const a = Math.cos(radians) * scale;
    const b = Math.sin(radians) * scale;
    const originX = posedPoint.x - (restPoint.x * a - restPoint.y * b);
    const originY = posedPoint.y - (restPoint.x * b + restPoint.y * a);
    return [a, b, originX, originY];
  },

  /**
   * `outer` after `inner`: the transform that applies `inner` first.
   *
   * Term order is the parity contract, the same way the skinning reduction's
   * is. Written as four expressions in a fixed order rather than as a matrix
   * product so neither kernel can reassociate it.
   *
   * Composing with IDENTITY on either side is exact -- `x * 1` and `x + 0` are
   * IEEE no-ops -- which is what lets a rig with no part poses produce
   * byte-identical output to one evaluated before this existed.
   */
  compose(outer: RigidTransform, inner: RigidTransform): RigidTransform {
    const [a1, b1, ox1, oy1] = outer;
    const [a2, b2, ox2, oy2] = inner;
    return [
      a1 * a2 - b1 * b2,
      a1 * b2 + b1 * a2,
      a1 * ox2 - b1 * oy2 + ox1,
      b1 * ox2 + a1 * oy2 + oy1,
    ];
  },

  /**
   * Exact equality against IDENTITY, so the caller may skip the apply.
   *
   * Exact rather than tolerant on purpose. A transform that is *nearly*
   * identity must still be applied, because "nearly" is where a slow drift
   * hides; and when it is exactly identity, applying it is provably a no-op, so
   * skipping cannot change a single bit. That is what makes this branch safe to
   * have in a parity-critical path at all.
   */
  isIdentity(transform: RigidTransform): boolean {
    return (
      transform[0] === IDENTITY[0] &&
      transform[1] === IDENTITY[1] &&
      transform[2] === IDENTITY[2] &&
      transform[3] === IDENTITY[3]
    );
  },

  /**
   * Per-bone transforms, flat stride 4.
   *
   * A bone rotates by its own world angle delta about its PARENT joint. Note
   * this is not the same fixed point as Skin.jointTransform: the two coincide
   * only when the child's `scale` is 1 and it carries no local translation.
   * Skinning uses the parent-origin form because that is what the v3 renderer
   * shipped and what the baked weight matrices were solved against; changing it
   * would silently re-pose every existing rig.
   */
  boneTransforms(skeleton: SolvedSkeleton): Float64Array {
    const count = skeleton.bones.length;
    const out = new Float64Array(count * 4);
    for (let index = 0; index < count; index++) {
      const bone = skeleton.bones[index];
      const rest = skeleton.restPositions.get(bone.parentJoint)!;
      const posed = skeleton.positions.get(bone.parentJoint) ?? rest;
      const delta = skeleton.posedAngles[index] - skeleton.restAngles[index];
      const [cos, sin, originX, originY] = Skin.affineAbout(rest, posed, delta);
      out[index * 4] = cos;
      out[index * 4 + 1] = sin;
      out[index * 4 + 2] = originX;
      out[index * 4 + 3] = originY;
    }
    return out;
  },

  /**
   * The transform a cutout part bound to `jointId` should ride.
   *
   * Rotation is the joint's ACCUMULATED chain angle about the joint's own rest
   * position, landing on its posed position. This is the cutout semantic an
   * artist expects: turning the head joint turns the head layer about the head
   * joint, regardless of what the neck bone did.
   */
  jointTransform(skeleton: SolvedSkeleton, jointId: string): RigidTransform {
    const rest = skeleton.restPositions.get(jointId);
    if (!rest) return IDENTITY;
    const posed = skeleton.positions.get(jointId) ?? rest;
    return Skin.affineAbout(rest, posed, skeleton.accumulated.get(jointId) ?? 0);
  },

  /**
   * The transform a rigid or lattice part rides, fallback included.
   *
   * `boundJointId` is state of the PART, so both deformers that read it resolve
   * it through this one function. It used to be resolved in each caller's wire
   * adapter instead, and the two adapters had drifted: the server bound an
   * unbound lattice to the root and the browser left it untransformed, so the
   * same cape moved on export and stood still in preview.
   *
   * Null, or an id the skeleton does not contain, resolves to the ROOT -- not to
   * the identity. A part pinned to nothing holds still while the figure moves
   * around it, which reads as the part having come loose, whereas a root at rest
   * is the identity anyway.
   */
  bindTransform(skeleton: SolvedSkeleton, part: Part): RigidTransform {
    const bound = part.boundJointId;
    const jointId =
      bound !== null && bound !== undefined && skeleton.restPositions.has(bound)
        ? bound
        : skeleton.root;
    return Skin.jointTransform(skeleton, jointId);
  },

  /** Apply one transform to a flat stride-2 float64 point array. */
  applyAffine(points: Float64Array, transform: RigidTransform): Float64Array {
    const [a, b, originX, originY] = transform;
    const out = new Float64Array(points.length);
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index];
      const y = points[index + 1];
      out[index] = x * a - y * b + originX;
      out[index + 1] = x * b + y * a + originY;
    }
    return out;
  },

  /**
   * Blend bone transforms per vertex. `srcVerts` is flat stride 2, in pixels.
   *
   * Evaluation order is the parity contract:
   *
   * - The reduction runs over BONES in ascending index order, accumulating into
   *   the output. The Python kernel vectorizes across vertices but loops bones
   *   in this same order, because NumPy's sum and matmul reassociate the adds
   *   and produce a different last bit than this straight-line loop.
   * - Non-positive weights contribute exactly nothing. Negative weights are
   *   dropped rather than applied: a negative weight is a solver artifact, and
   *   honouring it drags vertices to places no bone is.
   */
  linearBlend(srcVerts: Float64Array, weights: Float32Array, transforms: Float64Array): Float64Array {
    const vertCount = srcVerts.length / 2;
    const boneCount = transforms.length / 4;
    if (weights.length !== vertCount * boneCount) {
      throw new Error(
        `weights length ${weights.length} does not match ${vertCount} verts x ${boneCount} bones`,
      );
    }

    const out = new Float64Array(vertCount * 2);
    for (let vertex = 0; vertex < vertCount; vertex++) {
      const sx = srcVerts[vertex * 2];
      const sy = srcVerts[vertex * 2 + 1];
      let x = 0;
      let y = 0;
      for (let bone = 0; bone < boneCount; bone++) {
        const weight = weights[vertex * boneCount + bone];
        if (weight <= 0) continue;
        const cos = transforms[bone * 4];
        const sin = transforms[bone * 4 + 1];
        const originX = transforms[bone * 4 + 2];
        const originY = transforms[bone * 4 + 3];
        x += weight * (sx * cos - sy * sin + originX);
        y += weight * (sx * sin + sy * cos + originY);
      }
      out[vertex * 2] = x;
      out[vertex * 2 + 1] = y;
    }
    return out;
  },
} as const;
