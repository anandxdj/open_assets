"""Rig stage orchestration: parts in, skeleton plus one deformer per part out.

Contract (F9 §8.3). **In:** a decompose-produced ``RigDocument`` whose parts
carry masks, rects and roles, optionally a validated ``SemanticsProposal``, and
optionally per-part deformer overrides from the user. **Out:** a child revision
of that document with ``skeleton`` populated and every part's ``deformer``
built, plus a list of oversized numeric buffers for Node to upload.

Three properties of this stage that are easy to lose in a refactor and expensive
to lose in production:

* **It writes a child revision; it never mutates its input** (R9). Every
  correction stays reversible and any two passes stay diffable.
* **It is idempotent on ``inputHash``.** No RNG, no clock inside the geometry,
  no dict iteration order that depends on insertion timing. The same sheet and
  the same overrides produce byte-identical buffers, which is the only reason
  the render cache can be trusted.
* **``diagnostics.blockingReason`` is authored here and nowhere else** (F9
  §7.8). The browser may display it; it may not compute it.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np

from app.modules.anibuddy.archetype_priors import ArchetypePriors
from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.decompose.masks import overlapping_part_pairs
from app.modules.anibuddy.rig.buffers import Buffers
from app.modules.anibuddy.rig.contour import distance_transform
from app.modules.anibuddy.rig.deformers import (
    BuiltDeformer,
    DeformerBuilders,
    DeformerSelector,
    spline_candidates,
)
from app.modules.anibuddy.rig.raster import Raster
from app.modules.anibuddy.rig.skeleton import (
    JointGraph,
    PartTree,
    SkeletonPlanner,
    to_skeleton,
)
from app.modules.anibuddy.rig.skin import Skinner
from app.modules.anibuddy.rig.types import PartRaster, PendingBuffer, RigError, StageReport
from app.modules.anibuddy.schemas import (
    Diagnostics,
    DocumentProvenance,
    Joint,
    Part,
    RevisionLink,
    RigDocument,
    SemanticsProposal,
    Slot,
    StageRecord,
    Vec2,
)

class RigResult:
    """The stage's full output: a document plus its out-of-band buffers."""

    __slots__ = ("document", "pending_buffers", "message")

    def __init__(
        self,
        document: RigDocument,
        pending_buffers: Sequence[PendingBuffer],
        message: str,
    ) -> None:
        self.document = document
        self.pending_buffers: List[PendingBuffer] = list(pending_buffers)
        self.message = message


def _utcnow_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _canonical_input_hash(
    document: RigDocument,
    semantics: Optional[SemanticsProposal],
    overrides: Mapping[str, str],
) -> str:
    """SHA-256 over the canonicalized stage input.

    Sorted keys and no whitespace, so the hash depends on the *content* of the
    input and not on the order a JSON serializer happened to emit its fields.
    An equal hash is what lets the worker return a cached artifact instead of
    recomputing (F9 §7.9), and a hash that moves with serializer version would
    silently disable that cache.
    """
    payload = {
        "document": json.loads(document.model_dump_json()),
        "semantics": None
        if semantics is None
        else json.loads(semantics.model_dump_json()),
        "overrides": dict(sorted(overrides.items())),
        "pipeline": RigConstants.PIPELINE_VERSION,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _apply_semantics(
    parts: Sequence[Part],
    semantics: SemanticsProposal,
) -> Tuple[List[Part], str, Dict[str, str]]:
    """Fold a proposal into the parts, refusing the whole response on a fault.

    Every rejection here is one F9 §8.2 names: an unknown part id, a role
    outside the archetype's vocabulary, or a parentage claim that does not
    resolve. Rejecting the whole response rather than the offending entry is
    R7 — a proposal that got one part wrong has usually misread the sheet, and
    the half of it that looks right is not more trustworthy for being adjacent
    to the half that does not.
    """
    by_id = {part.id: part for part in parts}
    # The proposal's archetype replaces the document's: decompose defaults it to
    # humanoid without looking, and semantics is the stage that actually knows.
    proposed_archetype = semantics.archetype

    for item in semantics.parts:
        if item.partId not in by_id:
            raise RigError(
                f'The semantics proposal names unknown part "{item.partId}".'
            )
        if not ArchetypePriors.is_part_role_allowed(proposed_archetype, item.role):
            raise RigError(
                f'Role "{item.role}" is not part of the '
                f'"{proposed_archetype}" archetype vocabulary.'
            )
        if item.parentPartId is not None and item.parentPartId not in by_id:
            raise RigError(
                f'Part "{item.partId}" was proposed under unknown parent '
                f'"{item.parentPartId}".'
            )

    hints: Dict[str, str] = {}
    updates: Dict[str, Part] = {}
    for item in semantics.parts:
        original = by_id[item.partId]
        hints[item.partId] = item.deformerHint
        updates[item.partId] = original.model_copy(
            update={
                "role": item.role,
                "parentPartId": item.parentPartId,
                "attachSlot": item.attachSlot,
                "zIndex": item.zIndex,
                "pivot": Vec2(x=item.pivotHint.x, y=item.pivotHint.y),
                "confidence": item.confidence,
                "provenance": "vision",
            }
        )

    merged = [updates.get(part.id, part) for part in parts]
    PartTree.validate(merged)
    return merged, proposed_archetype, hints


def _resolve_parents(parts: Sequence[Part]) -> Dict[str, Optional[str]]:
    """Declared parentage when there is any, derived parentage otherwise."""
    if any(part.parentPartId is not None for part in parts):
        PartTree.validate(parts)
        return {part.id: part.parentPartId for part in parts}
    return PartTree.derive(parts)


def _slots_for(archetype: str, role: str) -> List[Slot]:
    """Attachment points a part of this role OFFERS, from the prior table.

    Offered, not required. A child references a slot by name, so a sword can
    move from a hand to a back without either part learning the other's
    geometry (F9 §7.4) — which only works if the host publishes the slot even
    when nothing is attached to it yet.
    """
    out: List[Slot] = []
    for entry in ArchetypePriors.attach_slots(archetype):
        if entry.get("hostPartRole") != role:
            continue
        hint = entry.get("positionHint") or {}
        out.append(
            Slot(
                name=str(entry.get("slotName")),
                position=Vec2(
                    x=float(hint.get("x", RigConstants.SLOT_DEFAULT_X)),
                    y=float(hint.get("y", RigConstants.SLOT_DEFAULT_Y)),
                ),
            )
        )
        if len(out) >= RigConstants.MAX_SLOTS_PER_PART:
            break
    return out


def _attach_slot_for(
    archetype: str,
    child_role: str,
    parent_role: Optional[str],
    declared: Optional[str],
) -> Optional[str]:
    """Which of the parent's slots this child hangs from.

    A declared value wins — it may have come from a user drag or from a
    correction. Otherwise the first prior entry whose host is the parent's role
    and whose typical children include this role. ``None`` is a valid answer and
    means "hang from the parent's pivot", so there is no need to invent one.
    """
    if declared is not None:
        return declared
    if parent_role is None:
        return None
    for entry in ArchetypePriors.attach_slots(archetype):
        if entry.get("hostPartRole") != parent_role:
            continue
        if child_role in (entry.get("typicalChildPartRoles") or ()):
            return str(entry.get("slotName"))
    return None


def _build_part_deformer(
    part: Part,
    raster: PartRaster,
    kind: str,
    bones: Sequence,
    project_id: str,
    report: StageReport,
) -> Tuple[BuiltDeformer, str]:
    """Build the requested deformer, downgrading to rigid on any refusal.

    The downgrade ladder is one step deep on purpose. Falling from ``mesh`` to
    ``lattice`` would substitute a different articulation model for the one the
    prior chose and the animator would find a cape's behaviour on a torso;
    falling to ``rigid`` is legible — the part is stiff, the warning says why,
    and the user can draw a cut or override the kind.
    """
    if kind == "mesh":
        if not Raster.is_meshable(raster):
            report.warn(
                f'Part "{part.id}" is too small or too sparse to mesh '
                f"({raster.width}x{raster.height} px, "
                f"{raster.area_fraction:.1%} solid); it is rigid instead."
            )
            return DeformerBuilders.rigid(), "rigid"
        built = DeformerBuilders.mesh(part, raster, bones, project_id)
        if built is None:
            report.warn(
                f'Part "{part.id}" could not be triangulated; it is rigid instead.'
            )
            return DeformerBuilders.rigid(), "rigid"
        if built.skin is not None and not built.skin.bone_ids:
            report.warn(
                f'Part "{part.id}" has no bones within reach to skin to; it is '
                "rigid instead."
            )
            return DeformerBuilders.rigid(), "rigid"
        return built, "mesh"

    if kind == "lattice":
        if raster.width < RigConstants.MIN_PART_EDGE_PX or (
            raster.height < RigConstants.MIN_PART_EDGE_PX
        ):
            report.warn(
                f'Part "{part.id}" is too small for a lattice; it is rigid instead.'
            )
            return DeformerBuilders.rigid(), "rigid"
        return DeformerBuilders.lattice(raster, project_id), "lattice"

    if kind == "spline":
        built = DeformerBuilders.spline(raster, project_id)
        if built is None:
            report.warn(
                f'Part "{part.id}" is not elongated enough for a spline spine; '
                "it is rigid instead."
            )
            return DeformerBuilders.rigid(), "rigid"
        return built, "spline"

    return DeformerBuilders.rigid(), "rigid"


def rig_document(
    document: RigDocument,
    *,
    sheet: Optional[np.ndarray],
    revision_id: str,
    semantics: Optional[SemanticsProposal] = None,
    deformer_overrides: Optional[Mapping[str, str]] = None,
    pass_index: int = 0,
    usage_event_id: Optional[str] = None,
) -> RigResult:
    """Run the rig stage and return a child revision plus its buffers."""
    started = _utcnow_iso()
    overrides = dict(deformer_overrides or {})
    report = StageReport()

    parts = list(document.parts)
    if not parts:
        raise RigError("This document has no parts to rig.")
    if len(parts) > RigConstants.MAX_PARTS:
        raise RigError(
            f"This document has {len(parts)} parts (max {RigConstants.MAX_PARTS})."
        )

    unknown_overrides = sorted(set(overrides) - {part.id for part in parts})
    if unknown_overrides:
        raise RigError(
            f"Deformer override names unknown part(s): {', '.join(unknown_overrides)}."
        )

    archetype = document.archetype
    hints: Dict[str, str] = {}
    if semantics is not None:
        parts, archetype, hints = _apply_semantics(parts, semantics)

    sheet_w = document.asset.width
    sheet_h = document.asset.height
    if sheet_w < 1 or sheet_h < 1:
        raise RigError("The asset has no usable dimensions.")

    if sheet is None:
        needing = [part.id for part in parts if Raster.needs_sheet(part)]
        if needing:
            raise RigError(
                "These parts have alpha-threshold masks and need the source "
                f"sheet: {', '.join(needing)}."
            )

    rasters: Dict[str, PartRaster] = {}
    distances: Dict[str, np.ndarray] = {}
    for part in parts:
        raster = Raster.for_part(part, sheet, sheet_w, sheet_h)
        rasters[part.id] = raster
        distances[part.id] = distance_transform(raster.mask)
        if raster.solid_pixels == 0:
            report.warn(f'Part "{part.id}" claims no opaque pixels.')

    parents = _resolve_parents(parts)
    spline_ids = spline_candidates(parts, archetype, hints, overrides)

    if semantics is not None and semantics.joints:
        joints, joint_by_part, skeleton_warnings = SkeletonPlanner.from_proposal(
            semantics.joints, parts, archetype, rasters, spline_ids
        )
    else:
        joints, joint_by_part, skeleton_warnings = SkeletonPlanner.from_parts(
            parts, archetype, rasters, distances, parents, spline_ids
        )
    for warning in skeleton_warnings:
        report.warn(warning)

    JointGraph.validate(joints, [part.id for part in parts])
    bones = JointGraph.bones(joints, sheet_w, sheet_h)
    root_joint_id = next(
        (joint.id for joint in joints if joint.parent is None), None
    )

    role_by_id = {part.id: part.role for part in parts}
    built_parts: List[Part] = []
    for part in parts:
        raster = rasters[part.id]
        kind = DeformerSelector.choose(
            part,
            archetype,
            hint=hints.get(part.id),
            override=overrides.get(part.id),
        )
        built, actual = _build_part_deformer(
            part, raster, kind, bones, document.projectId, report
        )
        for warning in built.warnings:
            report.warn(warning)
        report.extend_buffers(built.buffers)
        report.isolated_vertices += built.isolated_vertices
        report.deformer_kinds.append((part.id, actual))

        if built.skin is not None and not Skinner.rows_sum_to_one(built.skin.weights):
            # F9 §8.3: this is not repairable at this level. A row that does not
            # sum to 1 scales the vertex it drives, so the part renders smaller
            # or larger than the artwork with no other symptom.
            report.block(
                f'Part "{part.id}" has skinning weights that do not sum to 1; '
                "the rig cannot be rendered."
            )

        parent_id = parents.get(part.id)
        # A mesh part is driven by its weight matrix, so it has no single bound
        # joint (F9 §7.4). Everything else rides one.
        bound = None if actual == "mesh" else joint_by_part.get(part.id, root_joint_id)
        built_parts.append(
            part.model_copy(
                update={
                    "parentPartId": parent_id,
                    "attachSlot": _attach_slot_for(
                        archetype,
                        part.role,
                        role_by_id.get(parent_id) if parent_id else None,
                        part.attachSlot,
                    ),
                    "slots": _slots_for(archetype, part.role),
                    "deformer": built.deformer,
                    "boundJointId": bound,
                }
            )
        )

    finished = _utcnow_iso()
    input_hash = _canonical_input_hash(document, semantics, overrides)
    kinds = ", ".join(f"{part_id}:{kind}" for part_id, kind in report.deformer_kinds)
    message = (
        f"rig built {len(joints)} joint(s), {len(bones)} bone(s), "
        f"skinning={RigConstants.SKINNING_METHOD} [{kinds}]"
    )[: RigConstants.MAX_STAGE_MESSAGE_LENGTH]

    stage = StageRecord(
        stage="rig",
        status="succeeded",
        startedAt=started,
        finishedAt=finished,
        inputHash=input_hash,
        passIndex=pass_index,
        modelId=None,
        usageEventId=usage_event_id,
        creditsSpent=0,
        message=message,
    )
    stages = [*document.provenance.stages, stage][-RigConstants.MAX_STAGE_RECORDS :]

    blocking = report.blocking_reason()
    diagnostics = Diagnostics(
        # Pixel counts describe the ASSET, not this stage's work, so the
        # decompose measurement carries forward rather than being re-derived
        # from part masks — which would double-count an overlapping pair.
        foregroundPixels=document.diagnostics.foregroundPixels,
        coveredForegroundPixels=document.diagnostics.coveredForegroundPixels,
        overlappingPartPairs=overlapping_part_pairs(built_parts)[
            : RigConstants.MAX_OVERLAPPING_PART_PAIRS
        ],
        # maxStretch and flippedTriangles are per-FRAME measurements. The rig
        # stage never poses anything, so it must not invent them; render fills
        # them in.
        maxStretch=document.diagnostics.maxStretch,
        flippedTriangles=document.diagnostics.flippedTriangles,
        isolatedVertices=report.isolated_vertices,
        warnings=[
            warning[: RigConstants.MAX_DIAGNOSTIC_WARNING_LENGTH]
            for warning in report.warnings[: RigConstants.MAX_DIAGNOSTIC_WARNINGS]
        ],
        blockingReason=None
        if blocking is None
        else blocking[: RigConstants.MAX_BLOCKING_REASON_LENGTH],
    )

    child = document.model_copy(
        update={
            "id": revision_id,
            "updatedAt": finished,
            "revision": RevisionLink(
                index=document.revision.index + 1,
                parentRevisionId=document.id,
                reason=RigConstants.REVISION_REASON,
                accepted=False,
            ),
            "archetype": archetype,
            "parts": built_parts,
            "skeleton": to_skeleton(joints),
            "provenance": DocumentProvenance(
                pipelineVersion=RigConstants.PIPELINE_VERSION,
                kernelVersion=RigConstants.KERNEL_VERSION,
                stages=stages,
            ),
            "diagnostics": diagnostics,
        }
    )
    return RigResult(
        document=child,
        pending_buffers=Buffers.collect(report.pending_buffers),
        message=message,
    )


class RigService:
    """Public service surface for the rig stage."""

    RigError = RigError

    @staticmethod
    def run(
        document: RigDocument,
        *,
        sheet: Optional[np.ndarray],
        revision_id: str,
        semantics: Optional[SemanticsProposal] = None,
        deformer_overrides: Optional[Mapping[str, str]] = None,
        pass_index: int = 0,
        usage_event_id: Optional[str] = None,
    ) -> RigResult:
        return rig_document(
            document,
            sheet=sheet,
            revision_id=revision_id,
            semantics=semantics,
            deformer_overrides=deformer_overrides,
            pass_index=pass_index,
            usage_event_id=usage_event_id,
        )

    @staticmethod
    def joints_of(document: RigDocument) -> List[Joint]:
        return list(document.skeleton.joints)
