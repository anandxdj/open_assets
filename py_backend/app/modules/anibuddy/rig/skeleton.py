"""Skeleton inference bound to parts, and the validator that refuses bad graphs.

Two halves, kept apart on purpose:

* **Inference** builds a joint graph from the decomposed parts and the
  archetype prior. It constructs a valid graph rather than fixing an invalid
  one, so its output passes the validator by construction.
* **Validation** is the gate everything else goes through — a semantics
  proposal, a critique correction, a hand-crafted request. It is the Python
  descendant of v3's ``sanitizeJointGraph`` (``lib/skeleton.ts`` 43-44) and it
  keeps that function's central decision: **structural errors are refused, not
  repaired.** A partially repaired graph produces a rig that looks plausible
  and animates wrongly, and the user has no way to see which of the two
  happened (R7).

The skeleton stays free-form. There is no fixed body plan anywhere in here —
joints hang off the part tree, so a snake with a spine and no limbs and a
32-part vehicle with a chassis and no spine are the same code path with
different parts, which is the case v3's fixed biped skeleton could not
represent at all.
"""

from __future__ import annotations

from typing import Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np

from app.modules.anibuddy.archetype_priors import ArchetypePriors
from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.rig.contour import resample_polyline, snap_to_medial_axis, spine_polyline
from app.modules.anibuddy.rig.types import BoneSegment, PartRaster, RigError
from app.modules.anibuddy.schemas import (
    JOINT_ROLE_VALUES,
    Joint,
    Part,
    ProposedJointSemantics,
    Skeleton,
)

_ID_ALLOWED = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
)


def _is_valid_id(value: str) -> bool:
    """The schema's ``^[A-Za-z0-9_-]{1,32}$``, without paying for a regex."""
    if not value or len(value) > RigConstants.MAX_ID_LENGTH:
        return False
    return all(character in _ID_ALLOWED for character in value)


def _clamp01(value: float) -> float:
    return 0.0 if value < 0.0 else (1.0 if value > 1.0 else value)


class JointIds:
    """Allocates schema-legal, collision-free joint ids.

    Part ids are already up to 32 characters, so ``j_`` + a part id can exceed
    the joint id budget. Truncating alone would collide two long part ids onto
    one joint; truncating with a numeric tail will not, and the id stays
    readable, which matters because these ids appear in every correction the
    critique loop emits.
    """

    __slots__ = ("_taken",)

    def __init__(self, reserved: Sequence[str] = ()) -> None:
        self._taken: set[str] = set(reserved)

    def allocate(self, stem: str) -> str:
        prefix = RigConstants.JOINT_ID_PREFIX
        budget = RigConstants.MAX_ID_LENGTH - len(prefix)
        cleaned = "".join(c if c in _ID_ALLOWED else "_" for c in stem)[:budget]
        candidate = f"{prefix}{cleaned}" if cleaned else f"{prefix}j"
        if candidate not in self._taken:
            self._taken.add(candidate)
            return candidate
        for suffix in range(2, RigConstants.MAX_JOINTS + 2):
            tail = str(suffix)
            trimmed = cleaned[: max(1, budget - len(tail) - 1)]
            candidate = f"{prefix}{trimmed}_{tail}"
            if candidate not in self._taken:
                self._taken.add(candidate)
                return candidate
        raise RigError("Ran out of unique joint ids.")


class PartTree:
    """Parentage over parts: validated when declared, derived when absent."""

    __slots__ = ()

    @staticmethod
    def validate(parts: Sequence[Part]) -> None:
        """Refuse an unresolvable, cyclic or over-deep part tree.

        Depth is capped at ``MAX_PART_DEPTH`` because every level composes one
        more transform per part per frame, and because a tree deeper than eight
        is almost always a mis-parented cycle that happens to terminate.
        """
        ids = {part.id for part in parts}
        if len(ids) != len(parts):
            raise RigError("Two parts share an id.")
        by_id = {part.id: part for part in parts}

        for part in parts:
            if part.parentPartId is None:
                continue
            if part.parentPartId not in ids:
                raise RigError(
                    f'Part "{part.id}" points at a missing parent '
                    f'"{part.parentPartId}".'
                )
            if part.parentPartId == part.id:
                raise RigError(f'Part "{part.id}" is its own parent.')

        for part in parts:
            cursor: Optional[Part] = part
            depth = 0
            while cursor is not None and cursor.parentPartId is not None:
                cursor = by_id.get(cursor.parentPartId)
                depth += 1
                if depth > len(parts):
                    raise RigError(f'Part "{part.id}" is part of a loop.')
            if depth > RigConstants.MAX_PART_DEPTH:
                raise RigError(f'Part "{part.id}" is nested too deeply.')

    @staticmethod
    def derive(parts: Sequence[Part]) -> Dict[str, Optional[str]]:
        """Geometric parentage prior: root by role, everything else by overlap.

        This is the fallback F9 §8.2 specifies for when semantics is skipped or
        refunded — largest part is root, others parented by overlap. Built
        acyclic by construction: a part may only attach to one already placed in
        the tree, walking largest to smallest, so there is no cycle to detect
        and no repair to make.
        """
        if not parts:
            return {}

        ordered = sorted(
            parts,
            key=lambda part: -(part.rect.width * part.rect.height),
        )
        priority = {
            role: index
            for index, role in enumerate(RigConstants.ROOT_PART_ROLE_PRIORITY)
        }
        root = min(
            ordered,
            key=lambda part: (
                priority.get(part.role, len(priority)),
                -(part.rect.width * part.rect.height),
            ),
        )

        parents: Dict[str, Optional[str]] = {root.id: None}
        depth: Dict[str, int] = {root.id: 0}
        for part in ordered:
            if part.id == root.id:
                continue
            best: Optional[str] = None
            best_overlap = 0.0
            for placed in ordered:
                if placed.id == part.id or placed.id not in parents:
                    continue
                if depth[placed.id] + 1 > RigConstants.MAX_PART_DEPTH:
                    continue
                overlap = _rect_overlap_area(part, placed)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best = placed.id
            parent = best if best is not None else root.id
            parents[part.id] = None if part.id == root.id else parent
            depth[part.id] = depth.get(parent, 0) + 1
        return parents


def _rect_overlap_area(a: Part, b: Part) -> float:
    left = max(a.rect.x, b.rect.x)
    right = min(a.rect.x + a.rect.width, b.rect.x + b.rect.width)
    top = max(a.rect.y, b.rect.y)
    bottom = min(a.rect.y + a.rect.height, b.rect.y + b.rect.height)
    if right <= left or bottom <= top:
        return 0.0
    return (right - left) * (bottom - top)


class JointGraph:
    """The structural validator. Refuses; never repairs."""

    __slots__ = ()

    @staticmethod
    def validate(joints: Sequence[Joint], part_ids: Sequence[str]) -> None:
        """Every invariant §7.5 carries forward from v3, plus ``partId``.

        The order of the checks is chosen so the message names the *first*
        thing wrong rather than a downstream consequence: an id that fails the
        pattern would also look like a missing parent to the next check, and
        "invalid id" is the actionable message of the two.
        """
        count = len(joints)
        if count < RigConstants.MIN_JOINTS:
            raise RigError(f"A rig needs at least {RigConstants.MIN_JOINTS} joints.")
        if count > RigConstants.MAX_JOINTS:
            raise RigError(
                f"This rig has too many joints (max {RigConstants.MAX_JOINTS})."
            )
        if count == 0:
            return

        known_parts = set(part_ids)
        ids: set[str] = set()
        for joint in joints:
            if not _is_valid_id(joint.id):
                raise RigError(f'Joint id "{joint.id}" is not a legal id.')
            if joint.id in ids:
                raise RigError(f'Joint id "{joint.id}" duplicates another joint.')
            ids.add(joint.id)

        for joint in joints:
            if joint.parent is not None and joint.parent not in ids:
                raise RigError(f'Joint "{joint.id}" points at a missing parent.')
            if joint.parent == joint.id:
                raise RigError(f'Joint "{joint.id}" is its own parent.')
            if joint.partId is not None and joint.partId not in known_parts:
                raise RigError(
                    f'Joint "{joint.id}" is bound to unknown part '
                    f'"{joint.partId}".'
                )

        roots = [joint for joint in joints if joint.parent is None]
        if len(roots) != 1:
            raise RigError(
                f"The joint graph needs exactly one root; found {len(roots)}."
            )

        by_id = {joint.id: joint for joint in joints}
        for joint in joints:
            cursor: Optional[Joint] = joint
            depth = 0
            while cursor is not None and cursor.parent is not None:
                cursor = by_id.get(cursor.parent)
                depth += 1
                if depth > count:
                    raise RigError(f'Joint "{joint.id}" is part of a loop.')
            if depth > RigConstants.MAX_JOINT_DEPTH:
                raise RigError(f'Joint "{joint.id}" is nested too deeply.')

        for joint in joints:
            finite = np.isfinite([joint.x, joint.y]).all()
            if not finite or not (0.0 <= joint.x <= 1.0 and 0.0 <= joint.y <= 1.0):
                raise RigError(f'Joint "{joint.id}" is outside the artwork.')

    @staticmethod
    def bones(
        joints: Sequence[Joint],
        sheet_w: int,
        sheet_h: int,
    ) -> List[BoneSegment]:
        """Derive bones in JOINT ORDER, in sheet pixels.

        Order and id format both match ``kernel/skeleton.py`` exactly
        (``parentId->childId``, parentless and unresolved joints skipped) —
        which is the whole point of storing ``DeformerMesh.boneIds``: the wire
        column order and the kernel's derived bone order have to be the same
        list, and now they are the same list by construction rather than by
        coincidence.
        """
        by_id = {joint.id: joint for joint in joints}
        width = float(sheet_w)
        height = float(sheet_h)
        out: List[BoneSegment] = []
        for joint in joints:
            if joint.parent is None:
                continue
            parent = by_id.get(joint.parent)
            if parent is None:
                continue
            out.append(
                BoneSegment(
                    id=f"{parent.id}->{joint.id}",
                    parent_joint_id=parent.id,
                    child_joint_id=joint.id,
                    start=(parent.x * width, parent.y * height),
                    end=(joint.x * width, joint.y * height),
                    parent_part_id=parent.partId,
                    child_part_id=joint.partId,
                )
            )
        return out


def _joint_role(archetype: str, part_role: str) -> str:
    mapped = RigConstants.PART_ROLE_TO_JOINT_ROLE.get(
        part_role, RigConstants.FALLBACK_JOINT_ROLE
    )
    if not ArchetypePriors.is_joint_role_allowed(archetype, mapped):
        mapped = RigConstants.FALLBACK_JOINT_ROLE
    if mapped not in JOINT_ROLE_VALUES:  # pragma: no cover - table is closed
        mapped = RigConstants.FALLBACK_JOINT_ROLE
    return mapped


def _root_role(archetype: str) -> str:
    topology = ArchetypePriors.get(archetype).get("topology") or {}
    role = topology.get("rootJointRole") or "root"
    if not ArchetypePriors.is_joint_role_allowed(archetype, str(role)):
        role = RigConstants.FALLBACK_JOINT_ROLE
    return str(role)


def _sheet_point(part: Part, local_x: float, local_y: float, raster: PartRaster) -> Tuple[float, float]:
    """Part-local pixels to sheet-normalized, via the part's own rect."""
    width = max(1, raster.width)
    height = max(1, raster.height)
    x = part.rect.x + (local_x / width) * part.rect.width
    y = part.rect.y + (local_y / height) * part.rect.height
    return _clamp01(x), _clamp01(y)


class SkeletonPlanner:
    """Builds the joint graph from parts, priors and optional proposed joints."""

    __slots__ = ()

    @staticmethod
    def from_parts(
        parts: Sequence[Part],
        archetype: str,
        rasters: Mapping[str, PartRaster],
        distances: Mapping[str, np.ndarray],
        parents: Mapping[str, Optional[str]],
        spline_part_ids: Sequence[str],
    ) -> Tuple[List[Joint], Dict[str, str], List[str]]:
        """Derive joints. Returns ``(joints, part_id -> joint_id, warnings)``.

        One structural root, then one joint per part following the part tree,
        then a chain along the spine of every spline part.

        The always-present root is a deliberate reading of two constraints that
        look contradictory. ``MIN_JOINTS`` is 0 and a prop archetype's skeleton
        is "legitimately empty" (F9 §10.4) — but the kernel refuses a rootless
        rig, and a rigid part whose ``boundJointId`` is null has no transform to
        ride, so "no skeleton" would render as "nothing moves". One structural
        root at the artwork's centre costs one joint, satisfies both, and leaves
        prop motion exactly where §10.4 wants it: in the ``PartPose`` channels.
        """
        warnings: List[str] = []
        allocator = JointIds()
        root_id = allocator.allocate(RigConstants.ROOT_JOINT_ID.removeprefix(
            RigConstants.JOINT_ID_PREFIX
        ))
        centre_x, centre_y = _parts_centre(parts)
        joints: List[Joint] = [
            Joint(
                id=root_id,
                name=RigConstants.ROOT_JOINT_NAME,
                role=_root_role(archetype),  # type: ignore[arg-type]
                x=centre_x,
                y=centre_y,
                parent=None,
                partId=None,
                ikChainLength=None,
                confidence=RigConstants.JOINT_CONFIDENCE_DERIVED,
            )
        ]

        # Parents before children, so a joint's parent joint always exists by
        # the time it is created.
        ordered = _topological_parts(parts, parents)
        joint_by_part: Dict[str, str] = {}
        depth_by_joint: Dict[str, int] = {root_id: 0}

        for part in ordered:
            if len(joints) >= RigConstants.MAX_JOINTS:
                warnings.append(
                    f"Joint budget ({RigConstants.MAX_JOINTS}) reached; parts "
                    "after this one share the root transform."
                )
                break
            raster = rasters.get(part.id)
            if raster is None:
                continue
            dist = distances.get(part.id)
            local_x = part.pivot.x * raster.width
            local_y = part.pivot.y * raster.height
            if dist is not None:
                local_x, local_y = snap_to_medial_axis(
                    raster.mask, dist, local_x, local_y
                )
            x, y = _sheet_point(part, local_x, local_y, raster)

            parent_part = parents.get(part.id)
            parent_joint = joint_by_part.get(parent_part or "", root_id)
            role = _joint_role(archetype, part.role)
            joint_id = allocator.allocate(part.id)
            joints.append(
                Joint(
                    id=joint_id,
                    name=part.name[:80],
                    role=role,  # type: ignore[arg-type]
                    x=x,
                    y=y,
                    parent=parent_joint,
                    partId=part.id,
                    ikChainLength=ArchetypePriors.ik_chain_length(archetype, role),
                    confidence=RigConstants.JOINT_CONFIDENCE_DERIVED,
                )
            )
            joint_by_part[part.id] = joint_id
            depth_by_joint[joint_id] = depth_by_joint.get(parent_joint, 0) + 1

        chain_warnings = SkeletonPlanner._append_spline_chains(
            joints,
            allocator,
            depth_by_joint,
            joint_by_part,
            parts,
            archetype,
            rasters,
            spline_part_ids,
        )
        warnings.extend(chain_warnings)
        return joints, joint_by_part, warnings

    @staticmethod
    def _append_spline_chains(
        joints: List[Joint],
        allocator: JointIds,
        depth_by_joint: Dict[str, int],
        joint_by_part: Mapping[str, str],
        parts: Sequence[Part],
        archetype: str,
        rasters: Mapping[str, PartRaster],
        spline_part_ids: Sequence[str],
    ) -> List[str]:
        """Give every spline part a joint chain along its own spine.

        This chain IS the spline's spine — ``DeformerSpline`` stores no polyline
        of its own — so authoring it here is authoring the deformer's geometry.
        That is also why it cannot be left for a render adapter to invent, which
        would put geometry on the wrong side of R5.
        """
        warnings: List[str] = []
        by_id = {part.id: part for part in parts}
        for part_id in spline_part_ids:
            part = by_id.get(part_id)
            raster = rasters.get(part_id)
            anchor = joint_by_part.get(part_id)
            if part is None or raster is None or anchor is None:
                continue
            points, _widths, _aspect = spine_polyline(
                raster.mask, RigConstants.SPLINE_PROBES
            )
            if points.shape[0] < 2:
                continue
            chain = resample_polyline(points, RigConstants.SPLINE_CHAIN_JOINTS)
            role = _joint_role(archetype, part.role)
            parent_joint = anchor
            for index in range(1, chain.shape[0]):
                if len(joints) >= RigConstants.MAX_JOINTS:
                    warnings.append(
                        f'Spline part "{part_id}" got a shorter joint chain: '
                        f"the joint budget is full."
                    )
                    break
                if depth_by_joint.get(parent_joint, 0) + 1 > RigConstants.MAX_JOINT_DEPTH:
                    warnings.append(
                        f'Spline part "{part_id}" got a shorter joint chain: '
                        f"the depth cap ({RigConstants.MAX_JOINT_DEPTH}) was reached."
                    )
                    break
                x, y = _sheet_point(
                    part, float(chain[index, 0]), float(chain[index, 1]), raster
                )
                joint_id = allocator.allocate(f"{part_id}_{index}")
                joints.append(
                    Joint(
                        id=joint_id,
                        name=f"{part.name[:70]} {index}",
                        role=role,  # type: ignore[arg-type]
                        x=x,
                        y=y,
                        parent=parent_joint,
                        partId=part_id,
                        ikChainLength=None,
                        confidence=RigConstants.JOINT_CONFIDENCE_DERIVED,
                    )
                )
                depth_by_joint[joint_id] = depth_by_joint.get(parent_joint, 0) + 1
                parent_joint = joint_id
        return warnings

    @staticmethod
    def from_proposal(
        proposed: Sequence[ProposedJointSemantics],
        parts: Sequence[Part],
        archetype: str,
        rasters: Mapping[str, PartRaster],
        spline_part_ids: Sequence[str] = (),
    ) -> Tuple[List[Joint], Dict[str, str], List[str]]:
        """Adopt model-proposed joints, refusing the whole set on any fault.

        Two rejections beyond the structural ones, both from F9 §8.2:

        * an unknown ``partId`` — a sign the model is working from a stale
          revision, where trusting the rest of the response would bind joints
          to parts that no longer exist;
        * a joint landing on transparent pixels — the model has proposed a bone
          through empty space, and a bone through empty space drags artwork that
          is not there.

        Whole-response rejection rather than dropping the bad joints: a limb
        chain missing its elbow still animates, just wrongly, and looks
        deliberate while doing it (R7).

        Spline chains are appended afterwards for the same reason they are in
        the derived path: a spline is posed from a joint chain, a model may not
        author geometry (R3), and a spline part left with a single joint has
        nothing to bend.
        """
        by_part = {part.id: part for part in parts}
        seen: set[str] = set()
        joints: List[Joint] = []
        joint_by_part: Dict[str, str] = {}

        for item in proposed:
            if not _is_valid_id(item.jointId):
                raise RigError(f'Proposed joint id "{item.jointId}" is not legal.')
            if item.jointId in seen:
                raise RigError(f'Proposed joint id "{item.jointId}" is duplicated.')
            seen.add(item.jointId)
            if item.partId is not None:
                if item.partId not in by_part:
                    raise RigError(
                        f'Proposed joint "{item.jointId}" is bound to unknown '
                        f'part "{item.partId}".'
                    )
                raster = rasters.get(item.partId)
                if raster is not None and not _covers(raster, by_part[item.partId], item.x, item.y):
                    raise RigError(
                        f'Proposed joint "{item.jointId}" lands on transparent '
                        f'pixels of part "{item.partId}".'
                    )
            role = item.role
            if not ArchetypePriors.is_joint_role_allowed(archetype, role):
                role = RigConstants.FALLBACK_JOINT_ROLE  # type: ignore[assignment]
            joints.append(
                Joint(
                    id=item.jointId,
                    name=item.name,
                    role=role,
                    x=_clamp01(item.x),
                    y=_clamp01(item.y),
                    parent=item.parent,
                    partId=item.partId,
                    ikChainLength=ArchetypePriors.ik_chain_length(archetype, role),
                    confidence=RigConstants.JOINT_CONFIDENCE_PROPOSED,
                )
            )
            if item.partId is not None and item.partId not in joint_by_part:
                joint_by_part[item.partId] = item.jointId

        JointGraph.validate(joints, [part.id for part in parts])

        warnings = SkeletonPlanner._append_spline_chains(
            joints,
            JointIds(reserved=[joint.id for joint in joints]),
            _depths(joints),
            joint_by_part,
            parts,
            archetype,
            rasters,
            spline_part_ids,
        )
        return joints, joint_by_part, warnings


def _depths(joints: Sequence[Joint]) -> Dict[str, int]:
    """Depth of each joint below the root. Assumes a validated graph."""
    by_id = {joint.id: joint for joint in joints}
    out: Dict[str, int] = {}
    for joint in joints:
        depth = 0
        cursor: Optional[Joint] = joint
        while cursor is not None and cursor.parent is not None:
            cursor = by_id.get(cursor.parent)
            depth += 1
        out[joint.id] = depth
    return out


def _covers(raster: PartRaster, part: Part, x: float, y: float) -> bool:
    """Whether a sheet-normalized point lands on solid pixels of the part."""
    if part.rect.width <= 0.0 or part.rect.height <= 0.0:
        return False
    local_x = (x - part.rect.x) / part.rect.width * raster.width
    local_y = (y - part.rect.y) / part.rect.height * raster.height
    px = int(round(local_x))
    py = int(round(local_y))
    if px < 0 or py < 0 or px >= raster.width or py >= raster.height:
        return False
    return bool(raster.mask[py, px])


def _parts_centre(parts: Sequence[Part]) -> Tuple[float, float]:
    """Area-weighted centre of the parts, sheet-normalized.

    Area weighted so a scatter of small effect parts does not pull the root off
    the subject; the root joint is the handle the whole figure translates by.
    """
    if not parts:
        return 0.5, 0.5
    total = 0.0
    x = 0.0
    y = 0.0
    for part in parts:
        area = part.rect.width * part.rect.height
        weight = max(area, RigConstants.EPSILON)
        x += (part.rect.x + part.rect.width * 0.5) * weight
        y += (part.rect.y + part.rect.height * 0.5) * weight
        total += weight
    if total <= 0.0:
        return 0.5, 0.5
    return _clamp01(x / total), _clamp01(y / total)


def _topological_parts(
    parts: Sequence[Part],
    parents: Mapping[str, Optional[str]],
) -> List[Part]:
    """Parts ordered parents-first, ties broken by descending area.

    Deterministic ordering is not cosmetic: joint ids are allocated in this
    order, and ids that shuffle between runs break every correction the critique
    loop issued against the previous revision.
    """
    by_id = {part.id: part for part in parts}
    ordered: List[Part] = []
    placed: set[str] = set()

    def depth(part_id: str) -> int:
        seen: set[str] = set()
        cursor: Optional[str] = part_id
        count = 0
        while cursor is not None and cursor not in seen:
            seen.add(cursor)
            cursor = parents.get(cursor)
            if cursor is None:
                break
            count += 1
        return count

    for part in sorted(
        parts,
        key=lambda item: (
            depth(item.id),
            -(item.rect.width * item.rect.height),
            item.id,
        ),
    ):
        if part.id in placed or part.id not in by_id:
            continue
        placed.add(part.id)
        ordered.append(part)
    return ordered


def to_skeleton(joints: Sequence[Joint]) -> Skeleton:
    return Skeleton(joints=list(joints))
