// The kernel entry point: pose a rig, get posed geometry back.
//
// VERTEX MATH ONLY. No image decoding, no rasterization, no DOM, no canvas, no
// fetch. The browser calls this and then draws the result with WebGL; the
// render worker calls its Python twin and draws the same result with NumPy and
// Pillow. Anything that is not pure math belongs on the caller's side of that
// line, because everything inside it has to be reproduced twice.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/kernel.py.

import { Deformers } from "./deformers";
import { Fk } from "./fk";
import { Numeric } from "./numeric";
import { PartTree } from "./parts";
import { Skin } from "./skin";
import { Warp } from "./warp";
import type {
  KernelFrame,
  KernelRig,
  PartGeometry,
  PartPoseMap,
  Pose,
  SolvedSkeleton,
} from "./types";

export const AniBuddyKernel = {
  /**
   * Forward kinematics only, for callers that just need joint positions.
   *
   * The editor's joint handles need this without paying for part geometry.
   */
  solve(rig: KernelRig, pose: Pose): SolvedSkeleton {
    return Fk.solve(rig.joints, rig.asset, pose);
  },

  /**
   * Solve the skeleton and the part tree, then evaluate every part.
   *
   * Two solves, in this order, because they are independent: forward kinematics
   * answers "what shape is each layer in?" and the part tree answers "where is
   * each layer?". parts.ts documents the composition in full; the short version
   * is that the tree's world transform is applied to the deformer's OUTPUT,
   * never to its input.
   *
   * Parts are evaluated in the order they appear in the rig, not in z-order.
   * Draw order is the rasterizer's problem; changing evaluation order here
   * would reshuffle the output arrays and break every golden fixture for no
   * gain.
   *
   * `scaleX`/`scaleY` map source pixels onto the destination surface and
   * default to 1. The kernel works in source pixels throughout and only applies
   * this at the final warp, so a preview at half resolution and an export at
   * full resolution differ by exactly one multiply rather than by an entirely
   * different evaluation.
   */
  evaluate(
    rig: KernelRig,
    pose: Pose,
    scaleX = 1,
    scaleY = 1,
    partPose: PartPoseMap = {},
  ): KernelFrame {
    const skeleton = Fk.solve(rig.joints, rig.asset, pose);
    const transforms = PartTree.solve(rig.parts, rig.asset, partPose);
    const parts: PartGeometry[] = [];

    for (const part of rig.parts) {
      const mesh = Deformers.evaluate(part, rig.asset, skeleton);
      const transform = transforms.get(part.id)!;
      // Skipped only when the transform is EXACTLY the identity, where applying
      // it is provably a no-op. See Skin.isIdentity.
      const dstVerts = Skin.isIdentity(transform)
        ? mesh.dstVerts
        : Skin.applyAffine(mesh.dstVerts, transform);
      const warp = Warp.triangles(mesh.srcVerts, dstVerts, mesh.tris, scaleX, scaleY);
      parts.push({
        partId: part.id,
        zIndex: part.zIndex,
        kind: part.deformer.kind,
        // float64 works internally, float32 crosses every boundary. This is the
        // single point where precision is discarded, and it is what makes the
        // two kernels comparable.
        srcVerts: Numeric.toStorage(mesh.srcVerts),
        dstVerts: Numeric.toStorage(dstVerts),
        tris: mesh.tris,
        warp,
        transform,
      });
    }

    return { skeleton, parts };
  },
} as const;
