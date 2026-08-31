// The four deformer evaluators, behind one dispatch.
//
// Every deformer emits the same thing: a posed triangle mesh in source pixels
// plus the rest mesh that supplies its texture coordinates. That uniformity is
// the reason the layered-cutout model is tractable at all -- the rasterizer, on
// either side of the wire, has exactly one code path no matter which deformer a
// part picked, and adding a fifth deformer later means adding a function here
// and nothing anywhere else.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/deformers.py.

import { KernelConstants } from "./constants";
import { Grid } from "./grid";
import { Lattice } from "./lattice";
import { Skin } from "./skin";
import { Spline } from "./spline";
import {
  KernelInputError,
  type Asset,
  type DeformedMesh,
  type MeshDeformer,
  type Part,
  type SolvedSkeleton,
} from "./types";

export const Deformers = {
  /**
   * Evaluate one part to a posed triangle mesh in source pixels.
   *
   * Takes the whole PART rather than just its deformer: `rect` and
   * `boundJointId` are part state that the rigid and lattice evaluators need,
   * and reading them here is what lets the deformer payloads stop carrying their
   * own copies.
   */
  evaluate(part: Part, asset: Asset, skeleton: SolvedSkeleton): DeformedMesh {
    const deformer = part.deformer;
    switch (deformer.kind) {
      case "rigid":
        return Deformers.rigid(part, asset, skeleton);
      case "mesh":
        return Deformers.mesh(deformer, asset, skeleton);
      case "lattice":
        return Lattice.evaluate(part, deformer, asset, skeleton);
      case "spline":
        return Spline.evaluate(deformer, asset, skeleton);
      default: {
        const unreachable: never = deformer;
        throw new KernelInputError(`Unsupported deformer ${JSON.stringify(unreachable)}.`);
      }
    }
  },

  /**
   * The part's rectangle riding one joint, with zero deformation.
   *
   * Emitted as two triangles rather than as a bare affine so it flows through
   * the same warp and rasterization path as everything else. The transform is
   * the joint transform, which is identical to skinning a four-vertex mesh with
   * a single weight of 1 -- rigid is not a special case of the math, only of
   * the weighting.
   */
  rigid(part: Part, asset: Asset, skeleton: SolvedSkeleton): DeformedMesh {
    const rect = part.rect ?? KernelConstants.FULL_SHEET_RECT;
    const x0 = rect[0] * asset.width;
    const y0 = rect[1] * asset.height;
    const x1 = rect[2] * asset.width;
    const y1 = rect[3] * asset.height;

    // Row-major to match Grid.triangulate: top-left, top-right, bottom-left,
    // bottom-right.
    const srcVerts = Float64Array.from([x0, y0, x1, y0, x0, y1, x1, y1]);
    const dstVerts = Skin.applyAffine(srcVerts, Skin.bindTransform(skeleton, part));
    return { srcVerts, dstVerts, tris: Grid.triangulate(1, 1) };
  },

  /**
   * Triangle mesh driven by linear blend skinning.
   *
   * Weight matrix columns are indexed by DERIVED bone order, so a mismatch
   * between the column count and the bone count means the rig was authored
   * against a different joint list. That is refused rather than truncated: a
   * truncated weight matrix still renders, just with limbs bound to the wrong
   * bones.
   */
  mesh(deformer: MeshDeformer, asset: Asset, skeleton: SolvedSkeleton): DeformedMesh {
    const boneCount = skeleton.bones.length;
    if (deformer.boneCount !== boneCount) {
      throw new KernelInputError(
        `Mesh weights have ${deformer.boneCount} bone columns but the skeleton derives ${boneCount} bones.`,
      );
    }

    const vertCount = deformer.verts.length / 2;
    const srcVerts = new Float64Array(vertCount * 2);
    for (let vertex = 0; vertex < vertCount; vertex++) {
      srcVerts[vertex * 2] = deformer.verts[vertex * 2] * asset.width;
      srcVerts[vertex * 2 + 1] = deformer.verts[vertex * 2 + 1] * asset.height;
    }

    const dstVerts = Skin.linearBlend(srcVerts, deformer.weights, Skin.boneTransforms(skeleton));
    return { srcVerts, dstVerts, tris: deformer.tris };
  },
} as const;
