"""The four deformer evaluators, behind one dispatch.

Every deformer emits the same thing: a posed triangle mesh in source pixels
plus the rest mesh that supplies its texture coordinates. That uniformity is
the reason the layered-cutout model is tractable at all -- the rasterizer, on
either side of the wire, has exactly one code path no matter which deformer a
part picked, and adding a fifth deformer later means adding a function here
and nothing anywhere else.
"""

from __future__ import annotations

import numpy as np

from .grid import Grid
from .lattice import Lattice
from .skin import Skin
from .spline import Spline
from .types import (
    Asset,
    KernelInputError,
    LatticeDeformer,
    MeshDeformer,
    Part,
    RigidDeformer,
    SolvedSkeleton,
    SplineDeformer,
)


class Deformers:
    """Dispatch plus the two evaluators simple enough to live inline."""

    __slots__ = ()

    @staticmethod
    def evaluate(
        part: Part,
        asset: Asset,
        skeleton: SolvedSkeleton,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return ``(src_verts, dst_verts, tris)`` in source pixels, float64.

        Takes the whole PART rather than just its deformer: ``rect`` and
        ``bound_joint_id`` are part state that the rigid and lattice evaluators
        need, and reading them here is what lets the deformer payloads stop
        carrying their own copies.
        """

        deformer = part.deformer
        if isinstance(deformer, RigidDeformer):
            return Deformers.rigid(part, asset, skeleton)
        if isinstance(deformer, MeshDeformer):
            return Deformers.mesh(deformer, asset, skeleton)
        if isinstance(deformer, LatticeDeformer):
            return Lattice.evaluate(part, deformer, asset, skeleton)
        if isinstance(deformer, SplineDeformer):
            return Spline.evaluate(deformer, asset, skeleton)
        raise KernelInputError(f"Unsupported deformer {type(deformer).__name__}.")

    @staticmethod
    def rigid(
        part: Part,
        asset: Asset,
        skeleton: SolvedSkeleton,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """The part's rectangle riding one joint, with zero deformation.

        Emitted as two triangles rather than as a bare affine so it flows
        through the same warp and rasterization path as everything else. The
        transform is the joint transform, which is identical to skinning a
        four-vertex mesh with a single weight of 1 -- rigid is not a special
        case of the math, only of the weighting.
        """

        width = float(asset.width)
        height = float(asset.height)
        x0 = part.rect[0] * width
        y0 = part.rect[1] * height
        x1 = part.rect[2] * width
        y1 = part.rect[3] * height

        # Row-major to match Grid.triangulate: top-left, top-right, bottom-left,
        # bottom-right.
        src = np.array([[x0, y0], [x1, y0], [x0, y1], [x1, y1]], dtype=np.float64)
        dst = Skin.apply_affine(src, Skin.bind_transform(skeleton, part))
        return src, dst, Grid.triangulate(1, 1)

    @staticmethod
    def mesh(
        deformer: MeshDeformer,
        asset: Asset,
        skeleton: SolvedSkeleton,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Triangle mesh driven by linear blend skinning.

        Weight matrix columns are indexed by DERIVED bone order, so a mismatch
        between the column count and the bone count means the rig was authored
        against a different joint list. That is refused rather than truncated:
        a truncated weight matrix still renders, just with limbs bound to the
        wrong bones.
        """

        bone_count = len(skeleton.bones)
        if deformer.weights.shape[1] != bone_count:
            raise KernelInputError(
                f"Mesh weights have {deformer.weights.shape[1]} bone columns "
                f"but the skeleton derives {bone_count} bones."
            )

        width = float(asset.width)
        height = float(asset.height)
        src = np.empty((deformer.verts.shape[0], 2), dtype=np.float64)
        src[:, 0] = np.asarray(deformer.verts[:, 0], dtype=np.float64) * width
        src[:, 1] = np.asarray(deformer.verts[:, 1], dtype=np.float64) * height

        transforms = Skin.bone_transforms(skeleton)
        dst = Skin.linear_blend(src, np.asarray(deformer.weights, dtype=np.float64), transforms)
        return src, dst, np.asarray(deformer.tris, dtype=np.uint32)
