"""``RigDocument`` v5 to ``KernelRig``: the wire adapter, and only that.

Why this file exists at all
---------------------------
``kernel/types.py`` says it plainly: the kernel owns a minimal, stable input
struct and each caller adapts its own wire format into it. ``kernel_fixtures.py``
is the same job for the golden corpus, and the browser will have a third. That
split is what keeps a schema revision from touching parity-critical math.

What is left to adapt, after the reconciliation
-----------------------------------------------
This module used to bridge five places where the v5 schema and the kernel
struct disagreed, and record each one in ``AdaptedRig.notes`` so a reader could
see what had been assumed. Those disagreements are gone: the schema and the two
kernels now describe the same thing, so what remains here is translation
between two shapes of the same facts rather than reconciliation of two
different sets of them.

Three genuine conversions remain, and they are conversions by design:

1. **Mesh vertices and cut lines are PART-LOCAL normalized (R6); the kernel
   works SHEET-normalized.** Lifted through ``Part.rect``. Storing them
   part-local is what makes a part portable — a re-crop of the sheet moves
   ``rect`` and leaves every stored vertex untouched — so the lift is the price
   of that property, not a mismatch.
2. **``DeformerMesh.boneIds`` names the weight matrix's columns; the kernel
   indexes columns by its own derived bone order.** Permuted BY NAME, and an
   unresolvable id is refused rather than dropped. That is the schema's stated
   contract implemented, not a guess: a dropped column shifts every later one
   and rebinds every vertex that used it.
3. **``DeformerSpline.thickness`` is a taper track normalized against the
   geometric mean of the rect's pixel dimensions; the kernel wants fractions of
   the figure height.** Rescaled entry for entry. The geometric mean is the
   producer's declared convention (``rig/deformers.py``) and the two must not
   drift.

Everything else is now carried verbatim: ``Part.rect``, ``pivot``,
``parentPartId``, ``attachSlot``, ``slots`` and ``boundJointId`` all have a
kernel field of the same meaning, the lattice's control points are already in
the kernel's form, and the rigid and lattice deformers carry no payload at all.
The tree is validated here, before a frame is spent, so a cycle or an
unresolvable parent surfaces as a ``RenderError`` sentence rather than as a
``KernelInputError`` escaping the per-frame loop.

``AdaptedRig.notes`` survives, but it now carries only things that are true of
this DOCUMENT — a rig with no skeleton, a part naming a joint that is not
there — rather than things that were true of the contract.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.kernel import (
    Asset,
    Clip,
    Joint,
    JointPose,
    Keyframe,
    KernelInputError,
    KernelRig,
    KernelConstants,
    LatticeDeformer,
    MeshDeformer,
    Part as KernelPart,
    PartTree,
    RigidDeformer,
    Skeleton as KernelSkeleton,
    Slot as KernelSlot,
    SplineDeformer,
)
from app.modules.anibuddy.render.types import AdaptedRig, RenderError
from app.modules.anibuddy.rig.buffers import Buffers
from app.modules.anibuddy.schemas import (
    Clip as WireClip,
    DeformerLattice,
    DeformerMesh,
    DeformerRigid,
    DeformerSpline,
    Part as WirePart,
    RigDocument,
)


def _figure_height(document: RigDocument) -> float:
    """The scale for the ``tx``/``ty`` pose channels, in source pixels.

    Read straight off the wire. ``AssetRef.figureHeight`` is the measured height
    of the subject inside the sheet, and null means it has not been measured yet
    — a sheet uploaded but not decomposed — in which case the schema says to
    fall back to ``height``. Those two are the same arithmetic on a sheet the
    artwork fills, which is what makes adding the measurement a refinement
    rather than a migration.

    Not re-measured here. Deriving it from the part rects at render time would
    give a number only this renderer knew, and ``tx`` would then mean something
    slightly different in the browser preview — the drift R4 exists to prevent.
    """
    figure_height = document.asset.figureHeight
    if figure_height is None:
        return float(document.asset.height)
    return float(figure_height)


def _rect_corners(part: WirePart) -> Tuple[float, float, float, float]:
    """``Part.rect`` as the kernel's sheet-normalized ``(x0, y0, x1, y1)``."""
    return (
        float(part.rect.x),
        float(part.rect.y),
        float(part.rect.x + part.rect.width),
        float(part.rect.y + part.rect.height),
    )


def _local_to_sheet(
    local: np.ndarray,
    part: WirePart,
) -> np.ndarray:
    """Part-local normalized (N, 2) to sheet-normalized (R6 delta 2).

    A part-local point is a fraction of ``Part.rect``; a sheet-normalized one is
    a fraction of the whole sheet. This is the conversion that makes a part
    portable: re-cropping the sheet moves ``rect`` and leaves every stored
    vertex untouched, which is only true if the vertices were never in sheet
    space to begin with.
    """
    out = np.empty_like(local)
    out[:, 0] = float(part.rect.x) + local[:, 0] * float(part.rect.width)
    out[:, 1] = float(part.rect.y) + local[:, 1] * float(part.rect.height)
    return out


class RigAdapter:
    """Translate a validated ``RigDocument`` into kernel input."""

    __slots__ = ()

    @staticmethod
    def to_kernel(document: RigDocument) -> AdaptedRig:
        """Adapt the whole document. Raises ``RenderError`` on an unusable rig."""
        notes: List[str] = []
        joints = RigAdapter._joints(document, notes)
        asset = Asset(
            width=int(document.asset.width),
            height=int(document.asset.height),
            figure_height=_figure_height(document),
        )

        # Derived bone order is the weight matrix's column order, so it is
        # computed once here from the same function the kernel uses rather than
        # re-derived per part. Two derivations of an ordering is two chances to
        # disagree about it.
        derived_bone_ids = [bone.id for bone in KernelSkeleton.bones(joints)]
        joint_ids = {joint.id for joint in joints}

        kernel_parts: List[KernelPart] = []
        parts_by_id: Dict[str, object] = {}
        part_order: List[str] = []

        for part in document.parts:
            deformer = RigAdapter._deformer(
                part,
                document=document,
                joint_ids=joint_ids,
                derived_bone_ids=derived_bone_ids,
                notes=notes,
            )
            kernel_parts.append(
                KernelPart(
                    id=part.id,
                    z_index=int(part.zIndex),
                    deformer=deformer,
                    rect=_rect_corners(part),
                    pivot=(float(part.pivot.x), float(part.pivot.y)),
                    parent_part_id=part.parentPartId,
                    attach_slot=part.attachSlot,
                    bound_joint_id=part.boundJointId,
                    slots=tuple(
                        KernelSlot(
                            name=slot.name,
                            x=float(slot.position.x),
                            y=float(slot.position.y),
                        )
                        for slot in part.slots
                    ),
                )
            )
            parts_by_id[part.id] = part
            part_order.append(part.id)

        kernel_parts_tuple = tuple(kernel_parts)
        # The kernel refuses a cycle, an unknown parent or an attachment to a
        # slot the parent does not offer (see ``kernel/parts.py``). Validating
        # here rather than letting it surface from inside the per-frame loop is
        # what turns a ``KernelInputError`` escaping a render worker into a
        # sentence the user can act on, and it fails before a frame is spent.
        try:
            PartTree.validate(kernel_parts_tuple)
        except KernelInputError as error:
            raise RenderError(str(error)) from error

        return AdaptedRig(
            kernel_rig=KernelRig(
                asset=asset, joints=joints, parts=kernel_parts_tuple
            ),
            parts_by_id=parts_by_id,
            part_order=tuple(part_order),
            notes=tuple(notes),
        )

    # --- Skeleton ---------------------------------------------------------

    @staticmethod
    def _joints(document: RigDocument, notes: List[str]) -> Tuple[Joint, ...]:
        """Wire joints as kernel joints, synthesizing a root when there is none.

        ``MIN_JOINTS`` is 0 — a prop or environment rig legitimately has no
        skeleton and animates entirely through ``PartPose`` channels — but the
        kernel refuses a rootless rig, and a rigid part needs *some* joint to
        name. A single root at the sheet origin with no pose delta evaluates to
        the identity transform, so synthesizing one changes no pixel while
        giving every unbound part something to ride.
        """
        joints = tuple(
            Joint(
                id=joint.id,
                parent=joint.parent,
                x=float(joint.x),
                y=float(joint.y),
            )
            for joint in document.skeleton.joints
        )
        if joints:
            return joints

        notes.append(
            "This rig has no skeleton, so a single structural root was "
            "synthesized for the render; every part is drawn at rest."
        )
        return (Joint(id=RigConstants.ROOT_JOINT_ID, parent=None, x=0.0, y=0.0),)

    # --- Deformers --------------------------------------------------------

    @staticmethod
    def _deformer(
        part: WirePart,
        *,
        document: RigDocument,
        joint_ids: set[str],
        derived_bone_ids: Sequence[str],
        notes: List[str],
    ):
        RigAdapter._report_unresolvable_bind(part, joint_ids, notes)
        wire = part.deformer
        if isinstance(wire, DeformerRigid):
            return RigidDeformer(kind="rigid")
        if isinstance(wire, DeformerMesh):
            return RigAdapter._mesh(part, wire, derived_bone_ids, notes)
        if isinstance(wire, DeformerLattice):
            return RigAdapter._lattice(part, wire, notes)
        if isinstance(wire, DeformerSpline):
            return RigAdapter._spline(part, wire, document, notes)
        raise RenderError(f'Part "{part.id}" has an unsupported deformer.')

    @staticmethod
    def _report_unresolvable_bind(
        part: WirePart,
        joint_ids: set[str],
        notes: List[str],
    ) -> None:
        """Say so when a part names a joint the skeleton does not have.

        The kernel resolves the fallback itself now — null or unknown rides the
        root — so nothing here has to choose. What is still worth saying out
        loud is that the document asked for a joint that is not there, because
        the render succeeds and looks deliberate either way.
        """
        bound = part.boundJointId
        if bound is not None and bound not in joint_ids:
            notes.append(
                f'Part "{part.id}" is bound to joint "{bound}", which is not in '
                "the skeleton; it was drawn on the root instead."
            )

    @staticmethod
    def _mesh(
        part: WirePart,
        wire: DeformerMesh,
        derived_bone_ids: Sequence[str],
        notes: List[str],
    ) -> MeshDeformer:
        """Skinned mesh, with the weight columns permuted into bone order.

        ``DeformerMesh.boneIds`` IS the weight matrix's column order; the kernel
        indexes columns by the bone order it derives itself. The schema is
        explicit that a consumer permutes BY NAME and never trusts the positions
        to coincide — they coincide only for a rig whose skeleton has not moved
        since the weights were solved, which is exactly the case that needs no
        permutation.

        An unresolvable name is refused rather than dropped. Dropping a column
        shifts every later column by one and rebinds every vertex that used it
        to a neighbouring bone, which renders as a plausible figure with one
        limb driven by the wrong joint.
        """
        verts_local = Buffers.read_f32(wire.verts).reshape(-1, 2)
        if verts_local.shape[0] == 0:
            raise RenderError(f'Part "{part.id}" has a mesh deformer with no vertices.')

        tris = np.asarray(Buffers.read_f32(wire.tris), dtype=np.int64).reshape(-1, 3)
        if tris.shape[0] == 0:
            raise RenderError(f'Part "{part.id}" has a mesh deformer with no triangles.')
        if int(tris.max()) >= verts_local.shape[0]:
            raise RenderError(
                f'Part "{part.id}" has a triangle index pointing past its '
                f"{verts_local.shape[0]} vertices."
            )

        vert_count = verts_local.shape[0]
        column_count = len(wire.boneIds)
        flat_weights = Buffers.read_f32(wire.weights)
        if flat_weights.size != vert_count * column_count:
            raise RenderError(
                f'Part "{part.id}" has {flat_weights.size} weight values but '
                f"{vert_count} vertices x {column_count} bone columns = "
                f"{vert_count * column_count}."
            )
        authored = flat_weights.reshape(vert_count, column_count)

        index_of = {bone_id: index for index, bone_id in enumerate(derived_bone_ids)}
        permuted = np.zeros((vert_count, len(derived_bone_ids)), dtype=np.float64)
        for column, bone_id in enumerate(wire.boneIds):
            target = index_of.get(bone_id)
            if target is None:
                raise RenderError(
                    f'Part "{part.id}" is skinned to bone "{bone_id}", which the '
                    "skeleton does not derive. Refusing rather than dropping the "
                    "column, because dropping it would rebind every vertex that "
                    "used it to the wrong bone."
                )
            permuted[:, target] = authored[:, column]

        # A row that does not sum to 1 is not a rounding problem: linear blend
        # skinning is an affine combination, so a row summing to 0.5 places the
        # vertex halfway to the origin. F9 §8.3 makes this the rig stage's
        # blocking condition; catching it here too means a hand-crafted request
        # cannot route around that gate.
        row_sums = permuted.sum(axis=1)
        worst = float(np.max(np.abs(row_sums - 1.0))) if vert_count else 0.0
        if worst > RigConstants.WEIGHT_ROW_EPSILON:
            raise RenderError(
                f'Part "{part.id}" has a skinning weight row off by {worst:.4f} '
                f"from 1 (tolerance {RigConstants.WEIGHT_ROW_EPSILON}). "
                "Re-run the rig stage before rendering."
            )

        if wire.cuts:
            # Cut lines are consumed when the weights are SOLVED, not when they
            # are applied, so the render has nothing to do with them. Said out
            # loud because "the render ignores cuts" looks like a bug otherwise.
            notes.append(
                f'Part "{part.id}" carries {len(wire.cuts)} cut line(s); those '
                "shaped the weight solve at rig time and are not re-applied at "
                "render time."
            )

        return MeshDeformer(
            kind="mesh",
            verts=_local_to_sheet(verts_local, part).astype(np.float32),
            tris=np.asarray(tris, dtype=np.uint32),
            weights=permuted.astype(np.float32),
        )

    @staticmethod
    def _lattice(
        part: WirePart,
        wire: DeformerLattice,
        notes: List[str],
    ) -> LatticeDeformer:
        """Lattice control points, carried across as they are.

        The wire and the kernel now hold the same thing: absolute part-local
        positions in row-major order, ``j * (cols + 1) + i``. This used to
        difference them against a reconstructed uniform rest grid, which meant
        both this module and the browser's adapter rebuilt that grid and had to
        agree on it exactly. Nothing reconstructs it now except the kernel
        itself, once, for the source vertices.

        The only work left is the reshape and a count check, and the count check
        earns its place: a control grid of the wrong length would otherwise
        reshape into a plausible grid of the wrong dimensions.
        """
        cols = int(wire.cols)
        rows = int(wire.rows)
        expected = (rows + 1) * (cols + 1)
        flat = Buffers.read_f32(wire.controlPoints)
        if flat.size != expected * 2:
            raise RenderError(
                f'Part "{part.id}" has {flat.size // 2} lattice control points '
                f"but a {cols}x{rows} lattice needs {expected}."
            )

        return LatticeDeformer(
            kind="lattice",
            cols=cols,
            rows=rows,
            control_points=flat.reshape(rows + 1, cols + 1, 2).astype(np.float32),
            interpolation=wire.interpolation,
        )

    @staticmethod
    def _spline(
        part: WirePart,
        wire: DeformerSpline,
        document: RigDocument,
        notes: List[str],
    ) -> SplineDeformer:
        """Spline posed along the part's joint chain, with its taper rescaled.

        The spine IS the joint chain — that is the schema's contract now, not a
        substitution made here, and there is no longer a stored bezier polyline
        for it to be a substitution FOR. What is left to convert is the taper
        track's unit: the wire normalizes each half-width against the geometric
        mean of the rect's pixel dimensions, the kernel wants a full width as a
        fraction of the figure height.
        """
        chain = RigAdapter.joint_chain(part.id, document)
        if len(chain) < 2:
            raise RenderError(
                f'Part "{part.id}" has a spline deformer but only '
                f"{len(chain)} joint(s) bound to it. A spline is posed along a "
                "joint chain, so it needs at least two. Re-run the rig stage "
                "before rendering."
            )

        half_widths = Buffers.read_f32(wire.thickness)
        if half_widths.size == 0:
            raise RenderError(f'Part "{part.id}" has a spline with no thickness data.')

        # The GEOMETRIC MEAN of the rect's pixel dimensions is the producer's
        # declared axis (``rig/deformers.py``): a single scalar cannot be exact
        # in an anisotropic part-local space, so the axis is declared rather
        # than inferred, and the geometric mean is the only choice that does not
        # silently assume the ribbon runs horizontally or vertically. THE TWO
        # SIDES MUST NOT DRIFT.
        rect_w_px = float(part.rect.width) * float(document.asset.width)
        rect_h_px = float(part.rect.height) * float(document.asset.height)
        local_scale_px = float(np.sqrt(max(rect_w_px * rect_h_px, 0.0)))
        figure_height = _figure_height(document)
        thickness = tuple(
            (2.0 * float(half_width) * local_scale_px) / figure_height
            for half_width in half_widths
        )

        segments = max(
            KernelConstants.SPLINE_MIN_SEGMENTS,
            min(KernelConstants.SPLINE_MAX_SEGMENTS, int(wire.samples) - 1),
        )
        return SplineDeformer(
            kind="spline",
            joints=tuple(chain),
            thickness=thickness,
            segments=segments,
        )

    @staticmethod
    def joint_chain(part_id: str, document: RigDocument) -> List[str]:
        """The spline spine: joints bound to ``part_id``, head to tail.

        This is the schema's stated derivation, and it is stated there rather
        than left to each consumer precisely because the browser's adapter had
        implemented a different one — it started from ``boundJointId`` and
        followed children, which picks a different chain whenever a spline part
        also anchors something else. Both sides run this algorithm now:

        * members are the joints whose ``partId`` is this part;
        * the HEAD is the member whose parent is not itself a member;
        * follow child links from the head until no member remains.

        Order is load-bearing, not cosmetic: the ribbon's shape is the sequence
        of its control points, and a reordered chain folds back on itself.
        """
        members = [
            joint for joint in document.skeleton.joints if joint.partId == part_id
        ]
        if not members:
            return []

        member_ids = {joint.id for joint in members}
        child_of: Dict[str, str] = {}
        head: Optional[str] = None
        for joint in members:
            if joint.parent in member_ids:
                child_of[str(joint.parent)] = joint.id
            elif head is None:
                head = joint.id

        # A chain whose head cannot be identified (every member's parent is also
        # a member, i.e. a cycle) falls back to document order rather than
        # looping forever. The structural validator is what rejects the cycle.
        if head is None:
            return [joint.id for joint in members]

        ordered = [head]
        cursor = head
        while cursor in child_of and len(ordered) < len(members):
            cursor = child_of[cursor]
            ordered.append(cursor)
        return ordered

    # --- Clips ------------------------------------------------------------

    @staticmethod
    def clip_to_kernel(clip: WireClip) -> Clip:
        """Wire clip to kernel clip: joint channels, and the part GEOMETRY ones.

        The split down ``PartPose`` is by responsibility, not by convenience.
        ``rot``, ``tx``, ``ty`` and ``scale`` move vertices, so they belong to
        the parity-locked kernel and are carried across here. ``visible``,
        ``opacity``, ``zIndex`` and ``swapTo`` decide which layers are drawn, in
        what order, how strongly and out of whose pixels; they stay in
        ``partpose.py`` and are dropped here.

        Dropping them is a routing decision, not a licence to read them however
        each target likes: ``partpose.py`` is parity-locked to the browser's
        ``part-track.ts`` by its own corpus (``fixtures/anibuddy-compositing/``).
        Rasterization is per-target (R4); deciding what to rasterize is not.

        Both halves bracket through ``PoseTrack.bracket_index``, so a part and a
        joint keyed on the same clip still resolve at the same instant despite
        being sampled by two different modules.
        """
        return Clip(
            id=clip.id,
            loop=bool(clip.loop),
            keyframes=tuple(
                Keyframe(
                    t=float(key.t),
                    ease=key.ease,
                    joints={
                        joint_id: JointPose(
                            rot=pose.rot, tx=pose.tx, ty=pose.ty, scale=pose.scale
                        )
                        for joint_id, pose in key.joints.items()
                    },
                    parts={
                        part_id: JointPose(
                            rot=pose.rot, tx=pose.tx, ty=pose.ty, scale=pose.scale
                        )
                        for part_id, pose in key.parts.items()
                    },
                )
                for key in clip.keyframes
            ),
        )
