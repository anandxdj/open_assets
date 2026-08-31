"""Revalidate a ``CritiqueReport`` against the live document, then apply it.

This is the second half of R3's structural enforcement. The schema already makes
geometry unrepresentable in a ``Correction``: every field is a bounded scalar, a
bounded integer, an enum member or an id. What is left for this module is the
half a schema cannot check — that every id resolves against *this* revision,
that the graph stays a single-rooted acyclic tree, and that a number a model
rounded badly is either clamped or refused rather than trusted.

The revalidation ladder (F9 §11.4), in order
-------------------------------------------
1. **Ids resolve against the CURRENT document.** An unknown id rejects the whole
   report, because it means the model is reasoning about a stale revision and
   every other correction in the same response is suspect too.
2. **Numbers are clamped inside a narrow band and refused outside it.** The
   asymmetry is deliberate and is the one rule in this file worth defending: a
   value 3% past a bound is a rounding artifact and clamping it loses nothing,
   while a value 5x past it means the model misunderstood the units.
3. **The structural validator re-runs** on the result — single root, acyclic,
   depth caps — because a correction that individually validates can still
   produce an invalid graph in combination with another.
4. **Refuse rather than repair (R7).** There is no partial-application path.
   Either every correction lands and a child revision is returned, or nothing is
   written. A rig with three of five corrections applied looks deliberate and
   animates wrongly, which is strictly worse than a refusal the user can act on.

What this module deliberately does NOT do
-----------------------------------------
It never edits a deformer payload. A ``deformer-swap`` is recorded as a pending
override for the next ``rig`` pass, because building a mesh from a critique
response would put the model one field away from authoring vertices — and R3
forbids that structurally, not just by convention.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.modules.anibuddy.constants import VisionConstants
from app.modules.anibuddy.schemas import (
    Correction,
    CritiqueReport,
    Diagnostics,
    DocumentProvenance,
    Joint,
    Keyframe,
    Part,
    RevisionLink,
    RigDocument,
    StageRecord,
    Vec2,
)
from app.modules.anibuddy.vision.types import (
    AppliedCorrection,
    CorrectionOutcome,
    VisionError,
)


def _utcnow_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def clamp_or_reject(
    value: float,
    low: float,
    high: float,
    *,
    label: str,
    tolerance: float = VisionConstants.CLAMP_TOLERANCE,
) -> Tuple[float, bool]:
    """One number through the §11.4 band. Returns ``(value, was_clamped)``.

    The tolerance is a fraction of the bound's own span, so the same rule reads
    sensibly on a ``[-0.08, 0.08]`` nudge and on a ``[0.25, 1]`` damp without
    either needing its own hand-picked epsilon. This is the ONLY place the band
    is implemented; every caller in the pipeline goes through it so the policy
    cannot drift between two corrections.
    """
    if high < low:
        raise VisionError(f"{label} has an inverted bound; refusing to guess.")
    if value != value:  # NaN, which every comparison below would silently pass
        raise VisionError(f"{label} was not a number.")
    if low <= value <= high:
        return float(value), False

    slack = abs(high - low) * tolerance
    if value < low:
        if value < low - slack:
            raise VisionError(
                f"{label} was {value:g}, further than "
                f"{int(tolerance * 100)}% below the {low:g} limit. That is a "
                "unit misunderstanding rather than a rounding error, so the "
                "whole response was rejected."
            )
        return float(low), True
    if value > high + slack:
        raise VisionError(
            f"{label} was {value:g}, further than {int(tolerance * 100)}% above "
            f"the {high:g} limit. That is a unit misunderstanding rather than a "
            "rounding error, so the whole response was rejected."
        )
    return float(high), True


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise VisionError(message)


def _tree_depth(
    node_id: str, parent_of: Dict[str, Optional[str]], cap: int, label: str
) -> int:
    """Depth of one node, refusing on a cycle or an over-deep chain.

    Walks rather than recurses, and counts steps against the node count so a
    cycle terminates in bounded time instead of on a stack overflow — the same
    guard the rig-analysis route uses on a proposed joint graph.
    """
    depth = 0
    cursor: Optional[str] = parent_of.get(node_id)
    seen = {node_id}
    while cursor is not None:
        _require(
            cursor in parent_of,
            f'{label} "{node_id}" ends up parented to unknown "{cursor}".',
        )
        _require(
            cursor not in seen,
            f'{label} "{node_id}" would sit in a parent cycle.',
        )
        seen.add(cursor)
        depth += 1
        _require(
            depth <= cap,
            f'{label} "{node_id}" would sit {depth} links deep, past the '
            f"{cap}-link cap.",
        )
        cursor = parent_of.get(cursor)
    return depth


class CritiqueCorrections:
    """Revalidate and apply one pass of corrections, writing a child revision."""

    __slots__ = ()

    @staticmethod
    def apply(
        document: RigDocument,
        report: CritiqueReport,
        *,
        revision_id: str,
        project_id: Optional[str] = None,
        parent_revision_id: Optional[str] = None,
        revision_index: Optional[int] = None,
        pass_index: int = 0,
        model_id: Optional[str] = None,
        usage_event_id: Optional[str] = None,
        credits_spent: int = 0,
    ) -> CorrectionOutcome:
        """Apply every correction, or raise ``VisionError`` and change nothing.

        The document is copied before the first edit, so a rejection halfway
        through leaves the caller's revision exactly as it arrived — which is
        what makes "refund and keep the previous revision" a real option rather
        than a hope.
        """
        _require(
            len(report.corrections) <= VisionConstants.MAX_CORRECTIONS_PER_PASS,
            f"A critique pass may request at most "
            f"{VisionConstants.MAX_CORRECTIONS_PER_PASS} corrections; this one "
            f"requested {len(report.corrections)}.",
        )

        working = document.model_copy(deep=True)
        parts_by_id: Dict[str, Part] = {part.id: part for part in working.parts}
        joints_by_id: Dict[str, Joint] = {
            joint.id: joint for joint in working.skeleton.joints
        }
        clip_ids = {clip.id for clip in working.clips}

        applied: List[AppliedCorrection] = []
        warnings: List[str] = []
        overrides: Dict[str, str] = {}

        for correction in report.corrections:
            outcome = CritiqueCorrections._apply_one(
                correction,
                working,
                parts_by_id=parts_by_id,
                joints_by_id=joints_by_id,
                clip_ids=clip_ids,
                overrides=overrides,
                warnings=warnings,
            )
            if outcome is not None:
                applied.append(outcome)

        CritiqueCorrections._revalidate_structure(working)

        return CorrectionOutcome(
            document=CritiqueCorrections._child_revision(
                working,
                original=document,
                applied=applied,
                warnings=warnings,
                revision_id=revision_id,
                project_id=project_id,
                parent_revision_id=parent_revision_id,
                revision_index=revision_index,
                pass_index=pass_index,
                model_id=model_id,
                usage_event_id=usage_event_id,
                credits_spent=credits_spent,
            ),
            applied=tuple(applied),
            deformer_overrides=overrides,
            warnings=warnings,
        )

    # --- One correction ----------------------------------------------------

    @staticmethod
    def _apply_one(
        correction: Correction,
        working: RigDocument,
        *,
        parts_by_id: Dict[str, Part],
        joints_by_id: Dict[str, Joint],
        clip_ids: set,
        overrides: Dict[str, str],
        warnings: List[str],
    ) -> Optional[AppliedCorrection]:
        kind = correction.kind

        if kind == "abort":
            # Recorded, never applied. The loop reads the verdict; this exists so
            # the reason the model gave for stopping survives into the audit
            # trail instead of only into a log line.
            warnings.append(f"The critique pass aborted: {correction.reason}")
            return AppliedCorrection(
                kind=kind,
                target_id=correction.targetId,
                reason=correction.reason,
                effect="loop aborted at the model's request",
                clamped=False,
            )

        if kind == "pivot-nudge":
            return CritiqueCorrections._pivot_nudge(correction, parts_by_id)
        if kind == "rotation-damp":
            return CritiqueCorrections._rotation_damp(
                correction, working, parts_by_id, joints_by_id
            )
        if kind == "z-order":
            return CritiqueCorrections._z_order(correction, parts_by_id)
        if kind == "deformer-swap":
            return CritiqueCorrections._deformer_swap(correction, parts_by_id, overrides)
        if kind == "parent-change":
            return CritiqueCorrections._parent_change(
                correction, parts_by_id, joints_by_id
            )
        if kind == "keyframe-retime":
            return CritiqueCorrections._keyframe_retime(correction, working, clip_ids)
        if kind == "part-visibility":
            return CritiqueCorrections._part_visibility(correction, parts_by_id)

        # The enum is closed by the schema, so reaching here means the schema
        # gained a kind and this dispatch did not. Refusing names that gap
        # instead of silently dropping a correction the caller was billed for.
        raise VisionError(f'Correction kind "{kind}" is not implemented.')

    @staticmethod
    def _part(correction: Correction, parts_by_id: Dict[str, Part]) -> Part:
        target = correction.targetId
        _require(
            target is not None,
            f'A "{correction.kind}" correction must name the part it applies to.',
        )
        part = parts_by_id.get(str(target))
        _require(
            part is not None,
            f'A "{correction.kind}" correction targets unknown part "{target}". '
            "The whole response was rejected: an unknown id means the model is "
            "working from a stale revision.",
        )
        assert part is not None  # narrowed by _require
        return part

    @staticmethod
    def _pivot_nudge(
        correction: Correction, parts_by_id: Dict[str, Part]
    ) -> AppliedCorrection:
        part = CritiqueCorrections._part(correction, parts_by_id)
        _require(
            correction.vec2 is not None,
            'A "pivot-nudge" correction must carry a vec2 delta.',
        )
        delta = correction.vec2
        assert delta is not None

        # Bounded twice, and the two bounds do different jobs.
        #
        # Per axis, through the §11.4 band: this is what refuses a unit
        # misunderstanding. A model that answers in part-local units sends
        # 0.04; one that thought the field was pixels sends 12, and that
        # response's other numbers cannot be trusted either.
        cap = VisionConstants.MAX_PIVOT_NUDGE
        axis_x, clamped_x = clamp_or_reject(
            float(delta.x), -cap, cap, label=f'The pivot nudge x on part "{part.id}"'
        )
        axis_y, clamped_y = clamp_or_reject(
            float(delta.y), -cap, cap, label=f'The pivot nudge y on part "{part.id}"'
        )

        # Then on magnitude, by scaling rather than refusing: a nudge at the cap
        # on both axes is 1.41x the cap in length, which is a legitimate reading
        # of a per-component instruction and not a mistake worth a refund. The
        # direction the model asked for is preserved; only the distance is
        # brought back to the bound.
        magnitude = float((axis_x**2 + axis_y**2) ** 0.5)
        scale = 1.0 if magnitude <= cap else cap / magnitude
        dx = axis_x * scale
        dy = axis_y * scale
        clamped = clamped_x or clamped_y or scale < 1.0

        # Clamped into the part's own unit square without the tolerance band: a
        # pivot outside its part is a rotation centre in another part's artwork,
        # and there is no reading of that as a rounding artifact.
        part.pivot = Vec2(
            x=min(
                VisionConstants.PIVOT_MAX,
                max(VisionConstants.PIVOT_MIN, float(part.pivot.x) + dx),
            ),
            y=min(
                VisionConstants.PIVOT_MAX,
                max(VisionConstants.PIVOT_MIN, float(part.pivot.y) + dy),
            ),
        )
        return AppliedCorrection(
            kind=correction.kind,
            target_id=part.id,
            reason=correction.reason,
            effect=(
                f"pivot moved by ({dx:+.3f}, {dy:+.3f}) to "
                f"({part.pivot.x:.3f}, {part.pivot.y:.3f})"
            ),
            clamped=clamped,
        )

    @staticmethod
    def _rotation_damp(
        correction: Correction,
        working: RigDocument,
        parts_by_id: Dict[str, Part],
        joints_by_id: Dict[str, Joint],
    ) -> AppliedCorrection:
        target = correction.targetId
        _require(
            target is not None,
            'A "rotation-damp" correction must name a joint or part.',
        )
        target_id = str(target)
        is_joint = target_id in joints_by_id
        is_part = target_id in parts_by_id
        _require(
            is_joint or is_part,
            f'A "rotation-damp" correction targets unknown id "{target_id}".',
        )
        _require(
            correction.scalar is not None,
            'A "rotation-damp" correction must carry a scalar multiplier.',
        )
        factor, clamped = clamp_or_reject(
            float(correction.scalar or 0.0),
            VisionConstants.MIN_ROTATION_DAMP,
            1.0,
            label=f'The rotation damping on "{target_id}"',
        )

        touched = 0
        for clip in working.clips:
            for key in clip.keyframes:
                poses = key.joints if is_joint else key.parts
                pose = poses.get(target_id)
                if pose is None:
                    continue
                for channel in VisionConstants.DAMPED_POSE_CHANNELS:
                    current = getattr(pose, channel, None)
                    if current is None:
                        continue
                    setattr(pose, channel, float(current) * factor)
                    touched += 1

        if touched == 0:
            # Not an error. A model that asks to damp a joint no clip animates is
            # describing something it saw — most often a part that swings because
            # of its PARENT's rotation — and saying so is more useful than
            # pretending an edit happened.
            return AppliedCorrection(
                kind=correction.kind,
                target_id=target_id,
                reason=correction.reason,
                effect=(
                    f"no clip animates {target_id}'s rotation, so the "
                    f"{factor:.2f}x damping had nothing to scale"
                ),
                clamped=clamped,
            )
        return AppliedCorrection(
            kind=correction.kind,
            target_id=target_id,
            reason=correction.reason,
            effect=f"scaled {touched} rotation channel(s) by {factor:.2f}",
            clamped=clamped,
        )

    @staticmethod
    def _z_order(
        correction: Correction, parts_by_id: Dict[str, Part]
    ) -> AppliedCorrection:
        part = CritiqueCorrections._part(correction, parts_by_id)
        _require(
            correction.intValue is not None,
            'A "z-order" correction must carry an intValue.',
        )
        previous = int(part.zIndex)
        part.zIndex = int(correction.intValue or 0)
        return AppliedCorrection(
            kind=correction.kind,
            target_id=part.id,
            reason=correction.reason,
            effect=f"draw order moved from {previous} to {part.zIndex}",
            clamped=False,
        )

    @staticmethod
    def _deformer_swap(
        correction: Correction,
        parts_by_id: Dict[str, Part],
        overrides: Dict[str, str],
    ) -> AppliedCorrection:
        part = CritiqueCorrections._part(correction, parts_by_id)
        _require(
            correction.deformerKind is not None,
            'A "deformer-swap" correction must name the deformer to swap to.',
        )
        wanted = str(correction.deformerKind)
        current = str(part.deformer.kind)
        if wanted == current:
            return AppliedCorrection(
                kind=correction.kind,
                target_id=part.id,
                reason=correction.reason,
                effect=f"already a {current} deformer; nothing to swap",
                clamped=False,
            )

        # Recorded, not applied. Swapping to `mesh` needs a triangulation and a
        # weight solve, which are the rig stage's job and are geometry the model
        # must never author (R3, R5).
        overrides[part.id] = wanted
        return AppliedCorrection(
            kind=correction.kind,
            target_id=part.id,
            reason=correction.reason,
            effect=(
                f"queued a {current} to {wanted} deformer swap for the next rig "
                "pass; geometry is rebuilt server-side, never proposed"
            ),
            clamped=False,
        )

    @staticmethod
    def _parent_change(
        correction: Correction,
        parts_by_id: Dict[str, Part],
        joints_by_id: Dict[str, Joint],
    ) -> AppliedCorrection:
        target = correction.targetId
        _require(target is not None, 'A "parent-change" correction must name a target.')
        target_id = str(target)
        _require(
            correction.stringValue is not None,
            'A "parent-change" correction must carry the new parent id.',
        )
        new_parent = str(correction.stringValue)
        _require(
            new_parent != target_id,
            f'A "parent-change" correction would parent "{target_id}" to itself.',
        )

        if target_id in parts_by_id:
            _require(
                new_parent in parts_by_id,
                f'A "parent-change" correction reparents part "{target_id}" to '
                f'unknown part "{new_parent}".',
            )
            part = parts_by_id[target_id]
            previous = part.parentPartId
            part.parentPartId = new_parent
            # An attachSlot names a slot on the OLD parent, so it cannot survive
            # a reparent. Cleared rather than remapped: guessing which slot on
            # the new parent was meant is exactly the repair R7 forbids.
            part.attachSlot = None
            return AppliedCorrection(
                kind=correction.kind,
                target_id=target_id,
                reason=correction.reason,
                effect=(
                    f"part parent moved from {previous or 'root'} to {new_parent}"
                ),
                clamped=False,
            )

        if target_id in joints_by_id:
            _require(
                new_parent in joints_by_id,
                f'A "parent-change" correction reparents joint "{target_id}" to '
                f'unknown joint "{new_parent}".',
            )
            joint = joints_by_id[target_id]
            _require(
                joint.parent is not None,
                f'A "parent-change" correction would give the root joint '
                f'"{target_id}" a parent, leaving the skeleton rootless.',
            )
            previous = joint.parent
            joint.parent = new_parent
            return AppliedCorrection(
                kind=correction.kind,
                target_id=target_id,
                reason=correction.reason,
                effect=f"joint parent moved from {previous} to {new_parent}",
                clamped=False,
            )

        raise VisionError(
            f'A "parent-change" correction targets unknown id "{target_id}".'
        )

    @staticmethod
    def _keyframe_retime(
        correction: Correction, working: RigDocument, clip_ids: set
    ) -> AppliedCorrection:
        """Move where in the clip the action peaks, monotonically.

        A ``Correction`` carries one scalar and one id, and a keyframe has no id
        of its own — so "retime keyframe X to t" is not expressible. What IS
        expressible, and is what the model is actually reporting when it says the
        swing happens too early, is *where the middle of the motion sits*. This
        applies a piecewise-linear warp that maps the clip's midpoint to the
        requested time and leaves both endpoints fixed.

        Monotone by construction, which is the property that matters: keyframe
        times must stay strictly increasing or the sampler's bracketing search
        has no interval to interpolate across.
        """
        target = correction.targetId
        _require(
            target is not None and str(target) in clip_ids,
            f'A "keyframe-retime" correction targets unknown clip "{target}".',
        )
        _require(
            correction.scalar is not None,
            'A "keyframe-retime" correction must carry a time in 0..1.',
        )
        peak, clamped = clamp_or_reject(
            float(correction.scalar or 0.0),
            VisionConstants.MIN_RETIME_PEAK,
            VisionConstants.MAX_RETIME_PEAK,
            label=f'The retime peak on clip "{target}"',
        )

        clip = next(item for item in working.clips if item.id == str(target))
        source = VisionConstants.RETIME_SOURCE_PEAK
        for key in clip.keyframes:
            key.t = _warp_time(float(key.t), source, peak)

        _require(
            _strictly_increasing(clip.keyframes),
            f'Retiming clip "{target}" collapsed two keyframes onto the same '
            "time; the whole response was rejected rather than nudging them "
            "apart.",
        )
        return AppliedCorrection(
            kind=correction.kind,
            target_id=str(target),
            reason=correction.reason,
            effect=f"action peak moved from t={source:.2f} to t={peak:.2f}",
            clamped=clamped,
        )

    @staticmethod
    def _part_visibility(
        correction: Correction, parts_by_id: Dict[str, Part]
    ) -> AppliedCorrection:
        part = CritiqueCorrections._part(correction, parts_by_id)
        wanted = (correction.stringValue or "").strip().lower()
        _require(
            wanted in VisionConstants.VISIBILITY_VALUES,
            f'A "part-visibility" correction must say '
            f"{' or '.join(VisionConstants.VISIBILITY_VALUES)}; got "
            f'"{correction.stringValue}".',
        )
        part.visible = wanted == VisionConstants.VISIBILITY_SHOW
        return AppliedCorrection(
            kind=correction.kind,
            target_id=part.id,
            reason=correction.reason,
            effect=f"part {'shown' if part.visible else 'hidden'}",
            clamped=False,
        )

    # --- Structural revalidation -------------------------------------------

    @staticmethod
    def _revalidate_structure(working: RigDocument) -> None:
        """Re-run the tree invariants on the CORRECTED document (§11.4 step 4).

        Run once at the end rather than per correction, because two corrections
        that each validate alone can still close a cycle together — reparenting
        A under B and B under A is two legal-looking edits and one broken rig.
        """
        part_parent: Dict[str, Optional[str]] = {
            part.id: part.parentPartId for part in working.parts
        }
        for part in working.parts:
            if part.parentPartId is not None:
                _require(
                    part.parentPartId in part_parent,
                    f'Part "{part.id}" references missing parent '
                    f'"{part.parentPartId}".',
                )
            _tree_depth(
                part.id, part_parent, VisionConstants.MAX_PART_DEPTH, "Part"
            )
            if part.attachSlot is not None and part.parentPartId is not None:
                parent = next(
                    item for item in working.parts if item.id == part.parentPartId
                )
                _require(
                    any(slot.name == part.attachSlot for slot in parent.slots),
                    f'Part "{part.id}" hangs from slot "{part.attachSlot}", '
                    f'which part "{parent.id}" does not offer.',
                )

        joints = working.skeleton.joints
        if joints:
            joint_parent: Dict[str, Optional[str]] = {
                joint.id: joint.parent for joint in joints
            }
            roots = [joint.id for joint in joints if joint.parent is None]
            _require(
                len(roots) == 1,
                f"The skeleton must have exactly one root joint; this one has "
                f"{len(roots)}.",
            )
            for joint in joints:
                _tree_depth(
                    joint.id, joint_parent, VisionConstants.MAX_JOINT_DEPTH, "Joint"
                )

        known_parts = set(part_parent)
        for clip in working.clips:
            _require(
                _strictly_increasing(clip.keyframes),
                f'Clip "{clip.id}" has keyframe times that are not strictly '
                "increasing.",
            )
            for key in clip.keyframes:
                for part_id, pose in key.parts.items():
                    if pose.swapTo is not None:
                        _require(
                            pose.swapTo in known_parts,
                            f'Clip "{clip.id}" swaps part "{part_id}" to unknown '
                            f'part "{pose.swapTo}".',
                        )

    # --- Document assembly -------------------------------------------------

    @staticmethod
    def _child_revision(
        working: RigDocument,
        *,
        original: RigDocument,
        applied: List[AppliedCorrection],
        warnings: List[str],
        revision_id: str,
        project_id: Optional[str],
        parent_revision_id: Optional[str],
        revision_index: Optional[int],
        pass_index: int,
        model_id: Optional[str],
        usage_event_id: Optional[str],
        credits_spent: int,
    ) -> RigDocument:
        """Write the corrected document as an immutable child revision (R9).

        ``accepted`` stays false even when the verdict was ``accept``: the loop
        signing off its own work is not the user signing off (§7.2), and the
        editor renders an unaccepted revision as a proposal.
        """
        finished = _utcnow_iso()
        message = CritiqueCorrections._stage_message(applied, pass_index)

        diagnostics = Diagnostics(
            foregroundPixels=working.diagnostics.foregroundPixels,
            coveredForegroundPixels=working.diagnostics.coveredForegroundPixels,
            overlappingPartPairs=working.diagnostics.overlappingPartPairs,
            # Carried forward, NOT invented. maxStretch and flippedTriangles are
            # measurements of a render; this revision has not been rendered yet,
            # and authoring a 1.0 here would be a clean bill of health for
            # frames nobody has drawn. The next contact-sheet render replaces
            # them with real numbers.
            maxStretch=working.diagnostics.maxStretch,
            flippedTriangles=working.diagnostics.flippedTriangles,
            isolatedVertices=working.diagnostics.isolatedVertices,
            warnings=[
                warning[: VisionConstants.MAX_DIAGNOSTIC_WARNING_LENGTH]
                for warning in [*working.diagnostics.warnings, *warnings]
            ][: VisionConstants.MAX_DIAGNOSTIC_WARNINGS],
            blockingReason=working.diagnostics.blockingReason,
        )

        stage = StageRecord(
            stage=VisionConstants.STAGE_NAME,  # type: ignore[arg-type]
            status="succeeded",
            startedAt=finished,
            finishedAt=finished,
            # The parent revision id IS the canonicalized input to this stage:
            # corrections are applied to exactly one revision, so an equal
            # parent plus an equal report is an equal result.
            inputHash=_input_hash(original, applied),
            passIndex=pass_index,
            modelId=model_id,
            usageEventId=usage_event_id,
            creditsSpent=max(0, int(credits_spent)),
            message=message,
        )

        return working.model_copy(
            update={
                "id": revision_id,
                "projectId": project_id or working.projectId,
                "updatedAt": finished,
                "revision": RevisionLink(
                    index=(
                        working.revision.index + 1
                        if revision_index is None
                        else int(revision_index)
                    ),
                    parentRevisionId=parent_revision_id or original.id,
                    reason=VisionConstants.REVISION_REASON,
                    accepted=VisionConstants.REVISION_ACCEPTED,
                ),
                "provenance": DocumentProvenance(
                    pipelineVersion=VisionConstants.PIPELINE_VERSION,
                    kernelVersion=VisionConstants.KERNEL_VERSION,
                    stages=[
                        *working.provenance.stages[
                            -(VisionConstants.MAX_STAGE_RECORDS - 1) :
                        ],
                        stage,
                    ],
                ),
                "diagnostics": diagnostics,
            }
        )

    @staticmethod
    def _stage_message(applied: List[AppliedCorrection], pass_index: int) -> str:
        if not applied:
            return f"critique pass {pass_index}: no corrections requested"
        clamped = sum(1 for item in applied if item.clamped)
        parts = "; ".join(
            f"{item.kind}[{item.target_id or '-'}] {item.effect}" for item in applied
        )
        head = f"critique pass {pass_index}: {len(applied)} correction(s)"
        if clamped:
            head = f"{head}, {clamped} clamped into range"
        return f"{head} — {parts}"[: VisionConstants.MAX_STAGE_MESSAGE_LENGTH]


def _warp_time(t: float, source_peak: float, target_peak: float) -> float:
    """Piecewise-linear monotone remap of 0..1 sending ``source_peak`` to ``target_peak``."""
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    if t < source_peak:
        return t / source_peak * target_peak
    return target_peak + (t - source_peak) / (1.0 - source_peak) * (1.0 - target_peak)


def _strictly_increasing(keyframes: List[Keyframe]) -> bool:
    gap = VisionConstants.MIN_KEYFRAME_TIME_GAP
    previous: Optional[float] = None
    for key in keyframes:
        current = float(key.t)
        if previous is not None and current - previous < gap:
            return False
        previous = current
    return True


def _input_hash(original: RigDocument, applied: List[AppliedCorrection]) -> str:
    """SHA-256 over the parent revision id plus the corrections that landed.

    Same contract as every other ``StageRecord.inputHash``: an equal hash means
    a worker may return the cached artifact instead of recomputing. Hashing the
    *applied* list rather than the raw report is deliberate — two reports that
    differ only in prose produce the same document, and re-doing that work
    because the wording changed is a bill the user cannot explain.
    """
    payload = "|".join(
        [
            original.id,
            *[
                f"{item.kind}:{item.target_id or ''}:{item.effect}"
                for item in applied
            ],
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
