"""Forward kinematics over the free-form joint tree.

Ported from ``frontend/src/features/anibuddy/lib/deform.ts`` ``solve``
(~line 111). The tree is free-form -- any acyclic graph with one root, not a
fixed humanoid -- so the walk is a breadth-first traversal that accumulates
rotation down each chain and places each child at its scaled rest length from
its parent.
"""

from __future__ import annotations

import math
from collections import deque

from .numeric import Numeric
from .skeleton import Skeleton
from .types import Asset, Joint, JointPose, Pose, SolvedSkeleton


class Fk:
    """The forward kinematics pass. Pure; no state between calls."""

    __slots__ = ()

    @staticmethod
    def solve(joints: tuple[Joint, ...], asset: Asset, pose: Pose) -> SolvedSkeleton:
        """Walk the tree, applying each joint's local delta, in source pixels.

        Evaluation order is part of the parity contract:

        * Bones are derived in joint order (see ``Skeleton.bones``).
        * The traversal is a FIFO queue seeded with the root, and children are
          visited in joint order. A different visit order would not change any
          individual joint's position -- each depends only on its parent -- but
          it would change the order in which ``posed_angles`` is written, and
          keeping the two kernels textually parallel is worth more than the
          freedom.
        * ``tx``/``ty`` are scaled by ``figure_height``, not by the canvas, so
          a clip authored on a tight crop reads the same on a loose one.
        * The child's position is ``parent + scaled_length * (cos, sin)`` of
          the accumulated world angle, matching the browser's ``projRight``:
          angle measured from straight right, positive tilting down.
        """

        bones = Skeleton.bones(joints)
        rest_positions = Skeleton.rest_positions(joints, asset)
        rest_angles, rest_lengths = Skeleton.rest_geometry(bones, rest_positions)
        bone_of_child = Skeleton.bone_index_by_child(bones)
        children_of = Skeleton.children_of(joints)
        root = Skeleton.root(joints)
        figure_height = float(asset.figure_height)

        posed_angles = rest_angles.copy()
        positions: dict[str, tuple[float, float]] = {}
        accumulated: dict[str, float] = {}

        root_rest = rest_positions[root.id]
        root_pose = pose.get(root.id, _REST_POSE)
        positions[root.id] = (
            root_rest[0] + root_pose.tx_or_rest * figure_height,
            root_rest[1] + root_pose.ty_or_rest * figure_height,
        )
        accumulated[root.id] = root_pose.rot_or_rest

        queue: deque[Joint] = deque([root])
        while queue:
            parent = queue.popleft()
            parent_x, parent_y = positions[parent.id]
            parent_accumulated = accumulated.get(parent.id, 0.0)

            for child in children_of.get(parent.id, ()):
                index = bone_of_child.get(child.id)
                if index is None:
                    continue

                local = pose.get(child.id, _REST_POSE)
                # Rotation accumulates down the chain: a shoulder turn carries
                # the elbow and the hand with it. The local delta is added to
                # the parent's accumulated angle, and the bone's REST angle is
                # added on top to get the world angle.
                chain = parent_accumulated + local.rot_or_rest
                world = float(rest_angles[index]) + chain
                posed_angles[index] = world

                scaled_length = float(rest_lengths[index]) * local.scale_or_rest
                radians = Numeric.radians(world)
                next_x = parent_x + scaled_length * math.cos(radians)
                next_y = parent_y + scaled_length * math.sin(radians)

                positions[child.id] = (
                    next_x + local.tx_or_rest * figure_height,
                    next_y + local.ty_or_rest * figure_height,
                )
                accumulated[child.id] = chain
                queue.append(child)

        # A joint unreachable from the root (an orphan sub-tree, or a dangling
        # parent reference) keeps its rest position rather than vanishing to
        # the origin, which would drag any part bound to it across the canvas.
        for joint in joints:
            positions.setdefault(joint.id, rest_positions[joint.id])
            accumulated.setdefault(joint.id, 0.0)

        return SolvedSkeleton(
            positions=positions,
            rest_positions=rest_positions,
            accumulated=accumulated,
            posed_angles=posed_angles,
            rest_angles=rest_angles,
            rest_lengths=rest_lengths,
            bones=bones,
            root=root.id,
        )

    @staticmethod
    def rest_positions_of(joints: tuple[Joint, ...], asset: Asset) -> dict[str, tuple[float, float]]:
        """Convenience re-export so callers need not reach past ``Fk``."""

        return Skeleton.rest_positions(joints, asset)


#: Shared immutable "no delta" pose, so the hot loop does not allocate one per
#: joint per frame.
_REST_POSE = JointPose()
