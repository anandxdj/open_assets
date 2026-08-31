"""The kernel entry point: pose a rig, get posed geometry back.

VERTEX MATH ONLY. No image decoding, no rasterization, no file or network
access, no logging. The render worker calls this and then draws the result
with NumPy and Pillow; the browser calls its TypeScript twin and draws the
same result with WebGL. Anything that is not pure math belongs on the caller's
side of that line, because everything inside it has to be reproduced twice.
"""

from __future__ import annotations

from .deformers import Deformers
from .fk import Fk
from .numeric import Numeric
from .parts import PartTree
from .skin import Skin
from .types import (
    KernelFrame,
    KernelRig,
    PartGeometry,
    PartPoseMap,
    Pose,
    SolvedSkeleton,
)
from .warp import Warp


class AniBuddyKernel:
    """Pose evaluation for a whole rig."""

    __slots__ = ()

    @staticmethod
    def solve(rig: KernelRig, pose: Pose) -> SolvedSkeleton:
        """Forward kinematics only, for callers that just need joint positions.

        The editor's joint handles need this without paying for part geometry.
        """

        return Fk.solve(rig.joints, rig.asset, pose)

    @staticmethod
    def evaluate(
        rig: KernelRig,
        pose: Pose,
        scale_x: float = 1.0,
        scale_y: float = 1.0,
        part_pose: PartPoseMap | None = None,
    ) -> KernelFrame:
        """Solve the skeleton and the part tree, then evaluate every part.

        Two solves, in this order, because they are independent: forward
        kinematics answers "what shape is each layer in?" and the part tree
        answers "where is each layer?". ``parts.py`` documents the composition
        in full; the short version is that the tree's world transform is
        applied to the deformer's OUTPUT, never to its input.

        Parts are evaluated in the order they appear in the rig, not in
        z-order. Draw order is the rasterizer's problem; changing evaluation
        order here would reshuffle the output arrays and break every golden
        fixture for no gain.

        ``scale_x``/``scale_y`` map source pixels onto the destination surface
        and default to 1. The kernel works in source pixels throughout and
        only applies this at the final warp, so a preview at half resolution
        and an export at full resolution differ by exactly one multiply rather
        than by an entirely different evaluation.
        """

        skeleton = Fk.solve(rig.joints, rig.asset, pose)
        transforms = PartTree.solve(rig.parts, rig.asset, part_pose or {})
        parts: list[PartGeometry] = []

        for part in rig.parts:
            src, dst, tris = Deformers.evaluate(part, rig.asset, skeleton)
            transform = transforms[part.id]
            # Skipped only when the transform is EXACTLY the identity, where
            # applying it is provably a no-op. See ``Skin.is_identity``.
            if not Skin.is_identity(transform):
                dst = Skin.apply_affine(dst, transform)
            warp = Warp.triangles(src, dst, tris, scale_x=scale_x, scale_y=scale_y)
            parts.append(
                PartGeometry(
                    part_id=part.id,
                    z_index=part.z_index,
                    kind=part.deformer.kind,
                    # float64 works internally, float32 crosses every boundary.
                    # This is the single point where precision is discarded,
                    # and it is what makes the two kernels comparable.
                    src_verts=Numeric.to_storage(src),
                    dst_verts=Numeric.to_storage(dst),
                    tris=tris,
                    warp=warp,
                    transform=transform,
                )
            )

        return KernelFrame(skeleton=skeleton, parts=tuple(parts))
