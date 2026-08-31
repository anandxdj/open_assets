"""Derived views of the joint tree: bones, children, root, rest geometry.

Nothing here is stored on the wire. Bones in particular are always recomputed
from the joint list, because the moment a bone list is persisted it can
disagree with the tree that produced it, and the weight matrix -- whose
columns are bone-indexed -- would then bind every vertex to the wrong bone
with no error anywhere.
"""

from __future__ import annotations

import math

import numpy as np

from .numeric import PI, Numeric
from .types import Asset, Bone, Joint, KernelInputError


class Skeleton:
    """Pure functions over a joint list. No state, no I/O."""

    __slots__ = ()

    @staticmethod
    def bones(joints: tuple[Joint, ...]) -> tuple[Bone, ...]:
        """Derive parent to child segments in JOINT ORDER.

        Order is the contract. The skinning weight matrix has one column per
        bone in exactly this sequence, so both kernels must walk the joint
        list in the same direction and skip the same entries: the root (no
        parent) and any joint whose parent id does not resolve.
        """

        by_id = {joint.id: joint for joint in joints}
        out: list[Bone] = []
        for joint in joints:
            if joint.parent is None:
                continue
            parent = by_id.get(joint.parent)
            if parent is None:
                continue
            out.append(Bone(id=f"{parent.id}->{joint.id}", parent_joint=parent.id, child_joint=joint.id))
        return tuple(out)

    @staticmethod
    def children_of(joints: tuple[Joint, ...]) -> dict[str, list[Joint]]:
        """Adjacency in joint order, so the BFS visits siblings deterministically."""

        out: dict[str, list[Joint]] = {}
        for joint in joints:
            if joint.parent is None:
                continue
            out.setdefault(joint.parent, []).append(joint)
        return out

    @staticmethod
    def root(joints: tuple[Joint, ...]) -> Joint:
        """The single parentless joint, falling back to the first joint.

        The fallback exists because forward kinematics on a rootless tree
        should still produce something inspectable rather than raising in a
        render worker; structural validation is the caller's job.
        """

        for joint in joints:
            if joint.parent is None:
                return joint
        if not joints:
            raise KernelInputError("A rig needs at least one joint.")
        return joints[0]

    @staticmethod
    def rest_positions(joints: tuple[Joint, ...], asset: Asset) -> dict[str, tuple[float, float]]:
        """Normalized joint positions lifted into SOURCE PIXELS.

        Everything downstream works in this space. Rotating in normalized
        space would shear the figure on any non-square sheet, because a
        rotation matrix is only a rotation in an orthonormal basis.
        """

        width = float(asset.width)
        height = float(asset.height)
        return {joint.id: (joint.x * width, joint.y * height) for joint in joints}

    @staticmethod
    def rest_geometry(
        bones: tuple[Bone, ...],
        rest_positions: dict[str, tuple[float, float]],
    ) -> tuple[np.ndarray, np.ndarray]:
        """Rest world angle (degrees) and rest length (pixels) per bone.

        Angles are measured from straight right (+x) with positive tilting
        down, matching the browser's canvas orientation. Computed once from
        rest data, so the single ``atan2`` per bone here is the only place
        that transcendental enters the rest pose.

        The conversion is written ``(atan2(...) * 180) / PI`` -- multiply
        first -- to match the TypeScript kernel exactly. Folding it to
        ``atan2(...) * (180 / PI)`` changes the last bit.
        """

        count = len(bones)
        rest_angles = np.zeros(count, dtype=np.float64)
        rest_lengths = np.zeros(count, dtype=np.float64)
        for index, bone in enumerate(bones):
            from_x, from_y = rest_positions[bone.parent_joint]
            to_x, to_y = rest_positions[bone.child_joint]
            dx = to_x - from_x
            dy = to_y - from_y
            rest_angles[index] = (math.atan2(dy, dx) * 180.0) / PI
            rest_lengths[index] = Numeric.length(dx, dy)
        return rest_angles, rest_lengths

    @staticmethod
    def bone_index_by_child(bones: tuple[Bone, ...]) -> dict[str, int]:
        """Map a child joint id to the index of the bone that ends at it.

        A joint identifies a bone by being its endpoint, which is how a rigid
        or lattice part names the segment it rides.
        """

        return {bone.child_joint: index for index, bone in enumerate(bones)}
