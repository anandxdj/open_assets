"""Linear blend skinning, and the rigid transforms the other deformers reuse.

Ported from ``frontend/src/features/anibuddy/lib/deform.ts`` ``skin``
(~line 152).

``v' = sum_j w_j * (P_j * B_j^-1) * v``

Because forward kinematics preserves bone lengths (a bone's ``scale`` channel
changes where the child is placed, not the bone's own basis), every bone
transform collapses to a rotation about the rest origin plus a translation --
no shear, no non-uniform scale, no 3x3 matrix needed. That is what makes the
inner loop four multiplies and four adds instead of a matrix product.
"""

from __future__ import annotations

import math

import numpy as np

from .constants import KernelConstants
from .numeric import Numeric
from .types import Part, PartTransform, SolvedSkeleton


class Skin:
    """Skinning and the affine primitives shared with rigid and lattice parts."""

    __slots__ = ()

    #: The transform that changes nothing. Named because it is compared against
    #: by identity, not merely used as a starting value.
    IDENTITY: PartTransform = (1.0, 0.0, 0.0, 0.0)

    @staticmethod
    def affine_about(
        rest_point: tuple[float, float],
        posed_point: tuple[float, float],
        degrees: float,
    ) -> PartTransform:
        """Rotation by ``degrees`` about ``rest_point``, landing on ``posed_point``.

        Delegates to ``affine_about_scaled`` at unit scale rather than writing
        the formula a second time. Multiplying by exactly 1.0 is an IEEE no-op,
        so this is bit-identical to the standalone version it replaced -- and
        one formula cannot drift from itself.
        """

        return Skin.affine_about_scaled(
            rest_point, posed_point, degrees, KernelConstants.REST_SCALE
        )

    @staticmethod
    def affine_about_scaled(
        rest_point: tuple[float, float],
        posed_point: tuple[float, float],
        degrees: float,
        scale: float,
    ) -> PartTransform:
        """Rotate by ``degrees`` and scale by ``scale`` about ``rest_point``.

        Returns ``(a, b, origin_x, origin_y)`` for the map ``v' = M*v + origin``
        with ``M = scale * R``, and the rest origin folded into the
        translation: ``v' = M*(v - rest) + posed``. Folding it means the hot
        loop never subtracts the rest origin per vertex.

        This one function is the only place the rotate-and-place formula is
        written, so skinning, rigid parts, lattice parts and the part transform
        tree cannot disagree about it. ``scale`` is applied to the rotation
        matrix rather than as a separate pass because a uniform scale commutes
        with rotation -- folding it costs two multiplies and removes an ordering
        question the two kernels would otherwise have to answer identically.
        """

        radians = Numeric.radians(degrees)
        a = math.cos(radians) * scale
        b = math.sin(radians) * scale
        origin_x = posed_point[0] - (rest_point[0] * a - rest_point[1] * b)
        origin_y = posed_point[1] - (rest_point[0] * b + rest_point[1] * a)
        return a, b, origin_x, origin_y

    @staticmethod
    def compose(outer: PartTransform, inner: PartTransform) -> PartTransform:
        """``outer`` after ``inner``: the transform that applies ``inner`` first.

        Term order is the parity contract, the same way the skinning reduction's
        is. Written as four expressions in a fixed order rather than as a matrix
        product so neither kernel can reassociate it.

        Composing with ``IDENTITY`` on either side is exact -- ``x * 1`` and
        ``x + 0`` are IEEE no-ops -- which is what lets a rig with no part poses
        produce byte-identical output to one evaluated before this existed.
        """

        a1, b1, ox1, oy1 = outer
        a2, b2, ox2, oy2 = inner
        return (
            a1 * a2 - b1 * b2,
            a1 * b2 + b1 * a2,
            a1 * ox2 - b1 * oy2 + ox1,
            b1 * ox2 + a1 * oy2 + oy1,
        )

    @staticmethod
    def is_identity(transform: PartTransform) -> bool:
        """Exact equality against ``IDENTITY``, so the caller may skip the apply.

        Exact rather than tolerant on purpose. A transform that is *nearly*
        identity must still be applied, because "nearly" is where a slow drift
        hides; and when it is exactly identity, applying it is provably a no-op,
        so skipping cannot change a single bit. That is what makes this branch
        safe to have in a parity-critical path at all.
        """

        return (
            transform[0] == Skin.IDENTITY[0]
            and transform[1] == Skin.IDENTITY[1]
            and transform[2] == Skin.IDENTITY[2]
            and transform[3] == Skin.IDENTITY[3]
        )

    @staticmethod
    def bone_transforms(skeleton: SolvedSkeleton) -> np.ndarray:
        """Per-bone ``(cos, sin, origin_x, origin_y)``, shape (bone_count, 4).

        A bone rotates by its own world angle delta about its PARENT joint.
        Note this is not the same fixed point as
        ``Skin.joint_transform``: the two coincide only when the child's
        ``scale`` is 1 and it carries no local translation. Skinning uses the
        parent-origin form because that is what the v3 renderer shipped and
        what the baked weight matrices were solved against; changing it would
        silently re-pose every existing rig.
        """

        count = len(skeleton.bones)
        out = np.zeros((count, 4), dtype=np.float64)
        for index, bone in enumerate(skeleton.bones):
            rest = skeleton.rest_positions[bone.parent_joint]
            posed = skeleton.positions.get(bone.parent_joint, rest)
            delta = float(skeleton.posed_angles[index]) - float(skeleton.rest_angles[index])
            out[index] = Skin.affine_about(rest, posed, delta)
        return out

    @staticmethod
    def joint_transform(skeleton: SolvedSkeleton, joint_id: str) -> PartTransform:
        """The transform a cutout part bound to ``joint_id`` should ride.

        Rotation is the joint's ACCUMULATED chain angle about the joint's own
        rest position, landing on its posed position. This is the cutout
        semantic an artist expects: turning the head joint turns the head
        layer about the head joint, regardless of what the neck bone did.
        """

        rest = skeleton.rest_positions.get(joint_id)
        if rest is None:
            return Skin.IDENTITY
        posed = skeleton.positions.get(joint_id, rest)
        return Skin.affine_about(rest, posed, skeleton.accumulated.get(joint_id, 0.0))

    @staticmethod
    def bind_transform(skeleton: SolvedSkeleton, part: Part) -> PartTransform:
        """The transform a rigid or lattice part rides, fallback included.

        ``bound_joint_id`` is state of the PART, so both deformers that read it
        resolve it through this one function. It used to be resolved in each
        caller's wire adapter instead, and the two adapters had drifted: the
        server bound an unbound lattice to the root and the browser left it
        untransformed, so the same cape moved on export and stood still in
        preview.

        Null, or an id the skeleton does not contain, resolves to the ROOT --
        not to the identity. A part pinned to nothing holds still while the
        figure moves around it, which reads as the part having come loose,
        whereas a root at rest is the identity anyway.
        """

        bound = part.bound_joint_id
        joint_id = (
            bound if bound is not None and bound in skeleton.rest_positions
            else skeleton.root
        )
        return Skin.joint_transform(skeleton, joint_id)

    @staticmethod
    def apply_affine(points: np.ndarray, transform: PartTransform) -> np.ndarray:
        """Apply one ``(a, b, ox, oy)`` transform to an (N, 2) float64 array."""

        a, b, origin_x, origin_y = transform
        x = points[:, 0]
        y = points[:, 1]
        out = np.empty_like(points)
        out[:, 0] = x * a - y * b + origin_x
        out[:, 1] = x * b + y * a + origin_y
        return out

    @staticmethod
    def linear_blend(
        src_verts: np.ndarray,
        weights: np.ndarray,
        transforms: np.ndarray,
    ) -> np.ndarray:
        """Blend bone transforms per vertex. ``src_verts`` is (N, 2) in pixels.

        Evaluation order is the parity contract, and it is why this is not a
        single ``einsum``:

        * The reduction runs over BONES in ascending index order, one bone per
          iteration, accumulating into the output. NumPy's ``sum`` and
          ``matmul`` use pairwise or blocked summation, which reassociates the
          adds and produces a different last bit than the browser's
          straight-line ``x += ...`` loop. Vectorization here is across
          vertices only -- an axis neither kernel reduces over -- so it is
          free.
        * Non-positive weights contribute exactly nothing, matching the
          browser's ``if (weight <= 0) continue``. Adding an exact zero is an
          IEEE no-op, so masking is order-equivalent to skipping. Negative
          weights are dropped rather than applied: a negative weight is a
          solver artifact, and honouring it drags vertices to places no bone
          is.
        """

        vert_count = src_verts.shape[0]
        bone_count = transforms.shape[0]
        if weights.shape != (vert_count, bone_count):
            raise ValueError(
                f"weights {weights.shape} do not match {vert_count} verts x {bone_count} bones"
            )

        source_x = src_verts[:, 0]
        source_y = src_verts[:, 1]
        out_x = np.zeros(vert_count, dtype=np.float64)
        out_y = np.zeros(vert_count, dtype=np.float64)

        for bone in range(bone_count):
            weight = np.asarray(weights[:, bone], dtype=np.float64)
            active = weight > 0.0
            if not bool(np.any(active)):
                continue
            cos, sin, origin_x, origin_y = (float(value) for value in transforms[bone])
            contribution_x = weight * (source_x * cos - source_y * sin + origin_x)
            contribution_y = weight * (source_x * sin + source_y * cos + origin_y)
            out_x += np.where(active, contribution_x, 0.0)
            out_y += np.where(active, contribution_y, 0.0)

        posed = np.empty((vert_count, 2), dtype=np.float64)
        posed[:, 0] = out_x
        posed[:, 1] = out_y
        return posed
