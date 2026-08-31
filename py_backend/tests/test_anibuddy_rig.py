"""Unit tests for the AniBuddy rig stage (skeleton inference + deformers).

Synthetic parts only, and deliberately so: a limb-like strip, a blob, a
long tapering tail and a multi-part sheet exercise every branch the four
builders have, and they do it without a fixture binary that would drift from
the code that reads it.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import unittest
from typing import List, Optional, Sequence

import cv2
import numpy as np

from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.kernel import Asset as KernelAsset
from app.modules.anibuddy.kernel import Joint as KernelJoint
from app.modules.anibuddy.kernel import Skeleton as KernelSkeleton
from app.modules.anibuddy.rig import (
    BoneSegment,
    Buffers,
    CutPolyline,
    DeformerSelector,
    JointGraph,
    PartTree,
    Raster,
    RigError,
    RigService,
    Skinner,
    rect_pixel_bounds,
)
from app.modules.anibuddy.schemas import (
    ANIBUDDY_LIMITS,
    AssetRef,
    CutLine,
    DeformerMesh,
    DeformerRigid,
    DeformerSpline,
    Diagnostics,
    DocumentProvenance,
    GenerationSeam,
    Joint,
    MaskAlphaThreshold,
    MaskRect,
    Part,
    ProposedJointSemantics,
    ProposedPartSemantics,
    Rect,
    RevisionLink,
    RigDocument,
    SemanticsProposal,
    Skeleton,
    StageRecord,
    Vec2,
)

_BONE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}->[A-Za-z0-9_-]{1,32}$")
_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_HEX64 = re.compile(r"^[a-f0-9]{64}$")


# --- Fixtures ---------------------------------------------------------------


def _sheet(width: int, height: int) -> np.ndarray:
    return np.zeros((height, width, 4), dtype=np.uint8)


def _fill_rect(sheet: np.ndarray, x: int, y: int, w: int, h: int) -> None:
    sheet[y : y + h, x : x + w, :] = 255


def _fill_disc(sheet: np.ndarray, cx: int, cy: int, radius: int) -> None:
    cv2.circle(sheet, (cx, cy), radius, (255, 255, 255, 255), thickness=-1)


def _fill_taper(sheet: np.ndarray, x: int, y: int, length: int) -> None:
    """A long tapering diagonal strip: the shape a spline is right for."""
    for step in range(length):
        half = max(2, int(6 - 4 * step / max(1, length)))
        row = y + step
        column = x + int(step * 0.3)
        sheet[row : row + 1, column - half : column + half, :] = 255


def _asset(width: int, height: int) -> AssetRef:
    return AssetRef(
        id="sheet1",
        name="fixture.png",
        storageKey="fixtures/sheet1.png",
        contentHash=hashlib.sha256(b"fixture").hexdigest(),
        width=width,
        height=height,
        figureHeight=None,
        mimeType="image/png",
        rightsConfirmed=True,
        remoteVisionConsented=False,
    )


def _part(
    part_id: str,
    role: str,
    rect_px: tuple[int, int, int, int],
    sheet_w: int,
    sheet_h: int,
    *,
    mask_kind: str = "alpha-threshold",
    pivot: tuple[float, float] = (0.5, 0.1),
    parent: Optional[str] = None,
    cuts: Sequence[CutLine] = (),
) -> Part:
    x, y, w, h = rect_px
    mask = (
        MaskRect(kind="rect")
        if mask_kind == "rect"
        else MaskAlphaThreshold(
            kind="alpha-threshold", threshold=RigConstants.ALPHA_FLOOR
        )
    )
    deformer = (
        DeformerRigid(kind="rigid")
        if not cuts
        else DeformerMesh(
            kind="mesh",
            verts=Buffers.f32([0.0, 0.0], project_id="p")[0],
            tris=Buffers.u32([0, 0, 0], project_id="p")[0],
            boneIds=[],
            weights=Buffers.f32([], project_id="p")[0],
            cuts=list(cuts),
        )
    )
    return Part(
        id=part_id,
        name=f"Part {part_id}",
        role=role,  # type: ignore[arg-type]
        mask=mask,
        rect=Rect(x=x / sheet_w, y=y / sheet_h, width=w / sheet_w, height=h / sheet_h),
        pivot=Vec2(x=pivot[0], y=pivot[1]),
        zIndex=0,
        parentPartId=parent,
        attachSlot=None,
        slots=[],
        deformer=deformer,
        boundJointId=None,
        visible=True,
        opacity=1.0,
        confidence=0.8,
        provenance="alpha-component",
    )


def _document(
    parts: Sequence[Part],
    sheet_w: int,
    sheet_h: int,
    archetype: str = "humanoid",
) -> RigDocument:
    now = "2026-08-13T00:00:00Z"
    return RigDocument(
        schemaVersion=5,
        id="rev_parent",
        projectId="proj_test",
        createdAt=now,
        updatedAt=now,
        revision=RevisionLink(
            index=0, parentRevisionId=None, reason="decompose", accepted=False
        ),
        archetype=archetype,  # type: ignore[arg-type]
        asset=_asset(sheet_w, sheet_h),
        parts=list(parts),
        skeleton=Skeleton(joints=[]),
        clips=[],
        generation=GenerationSeam(
            mode="external-prompt-only", prompt=None, transcript=[], producedBy=None
        ),
        provenance=DocumentProvenance(
            pipelineVersion="anibuddy-decompose/1",
            kernelVersion="none",
            stages=[
                StageRecord(
                    stage="decompose",
                    status="succeeded",
                    startedAt=now,
                    finishedAt=now,
                    inputHash=hashlib.sha256(b"in").hexdigest(),
                    passIndex=0,
                    modelId=None,
                    usageEventId=None,
                    creditsSpent=0,
                    message=None,
                )
            ],
        ),
        diagnostics=Diagnostics(
            foregroundPixels=4096,
            coveredForegroundPixels=4096,
            overlappingPartPairs=[],
            maxStretch=0.0,
            flippedTriangles=0,
            isolatedVertices=0,
            warnings=[],
            blockingReason=None,
        ),
    )


def _humanoid_figure() -> tuple[np.ndarray, List[Part], int, int]:
    """Torso, one arm strip, a head blob — the vertical-slice shape."""
    width, height = 256, 384
    sheet = _sheet(width, height)
    _fill_rect(sheet, 96, 80, 64, 140)
    _fill_rect(sheet, 60, 90, 28, 120)
    _fill_disc(sheet, 128, 50, 30)
    parts = [
        _part("torso", "torso", (96, 80, 64, 140), width, height),
        _part("arm", "armUpper", (60, 90, 28, 120), width, height),
        _part("head", "head", (98, 20, 60, 60), width, height, pivot=(0.5, 0.9)),
    ]
    return sheet, parts, width, height


def _mesh_rows(deformer: DeformerMesh) -> np.ndarray:
    """Weight matrix as (vertCount, boneCount), from an inline buffer."""
    columns = len(deformer.boneIds)
    values = deformer.weights.values
    assert values is not None, "test fixtures keep weights inline"
    return np.asarray(values, dtype=np.float64).reshape(-1, max(1, columns))


# --- Mesh geometry ----------------------------------------------------------


class RigMeshTests(unittest.TestCase):
    def setUp(self) -> None:
        sheet, parts, width, height = _humanoid_figure()
        self.result = RigService.run(
            _document(parts, width, height),
            sheet=sheet,
            revision_id="rev_child",
        )
        self.document = self.result.document
        self.by_id = {part.id: part for part in self.document.parts}

    def test_soft_roles_get_a_mesh(self) -> None:
        for part_id in ("torso", "arm", "head"):
            self.assertEqual(self.by_id[part_id].deformer.kind, "mesh", part_id)

    def test_weight_rows_sum_to_one_and_carry_no_nan(self) -> None:
        for part in self.document.parts:
            if part.deformer.kind != "mesh":
                continue
            rows = _mesh_rows(part.deformer)
            self.assertFalse(np.isnan(rows).any(), part.id)
            self.assertFalse(np.isinf(rows).any(), part.id)
            self.assertTrue((rows >= 0.0).all(), part.id)
            sums = rows.sum(axis=1)
            worst = float(np.abs(sums - 1.0).max())
            self.assertLessEqual(
                worst, ANIBUDDY_LIMITS["WEIGHT_ROW_EPSILON"], f"{part.id}: {worst}"
            )

    def test_weight_matrix_shape_matches_bone_columns(self) -> None:
        for part in self.document.parts:
            if part.deformer.kind != "mesh":
                continue
            vert_count = part.deformer.verts.length // 2
            columns = len(part.deformer.boneIds)
            self.assertGreater(columns, 0, part.id)
            self.assertLessEqual(columns, ANIBUDDY_LIMITS["MAX_BONES_PER_PART"])
            self.assertEqual(part.deformer.weights.length, vert_count * columns)

    def test_bone_ids_are_wire_legal_and_resolve_to_joints(self) -> None:
        joint_ids = {joint.id for joint in self.document.skeleton.joints}
        for part in self.document.parts:
            if part.deformer.kind != "mesh":
                continue
            for bone_id in part.deformer.boneIds:
                self.assertRegex(bone_id, _BONE_ID_PATTERN)
                parent, child = bone_id.split("->")
                self.assertIn(parent, joint_ids)
                self.assertIn(child, joint_ids)

    def test_triangle_counts_are_sane_and_indices_in_range(self) -> None:
        for part in self.document.parts:
            if part.deformer.kind != "mesh":
                continue
            vert_count = part.deformer.verts.length // 2
            tris = np.asarray(part.deformer.tris.values, dtype=np.int64)
            self.assertGreater(tris.size, 0, part.id)
            self.assertEqual(tris.size % 3, 0, part.id)
            self.assertLessEqual(vert_count, ANIBUDDY_LIMITS["MAX_VERTS_PER_PART"])
            self.assertLessEqual(tris.size // 3, ANIBUDDY_LIMITS["MAX_TRIS_PER_PART"])
            # Every triangle needs three distinct, in-range vertices; a repeated
            # index is a zero-area triangle the affine warp cannot invert.
            self.assertTrue((tris >= 0).all() and (tris < vert_count).all(), part.id)
            faces = tris.reshape(-1, 3)
            distinct = (
                (faces[:, 0] != faces[:, 1])
                & (faces[:, 1] != faces[:, 2])
                & (faces[:, 0] != faces[:, 2])
            )
            self.assertTrue(bool(distinct.all()), part.id)

    def test_every_vertex_is_referenced_by_a_triangle(self) -> None:
        for part in self.document.parts:
            if part.deformer.kind != "mesh":
                continue
            vert_count = part.deformer.verts.length // 2
            tris = np.asarray(part.deformer.tris.values, dtype=np.int64)
            self.assertEqual(len(set(tris.tolist())), vert_count, part.id)

    def test_mesh_parts_have_no_bound_joint(self) -> None:
        # A mesh part is driven by its weight matrix, not by one joint (§7.4).
        for part in self.document.parts:
            if part.deformer.kind == "mesh":
                self.assertIsNone(part.boundJointId, part.id)


class RigPartLocalNormalizationTests(unittest.TestCase):
    """R6: deformer payloads are part-local, never sheet-normalized."""

    def setUp(self) -> None:
        # A small part in the bottom-right corner. Sheet-normalized vertices
        # would cluster near (0.8, 0.85); part-local ones must span 0..1.
        self.width, self.height = 320, 320
        sheet = _sheet(self.width, self.height)
        _fill_rect(sheet, 240, 260, 48, 40)
        parts = [_part("corner", "torso", (240, 260, 48, 40), self.width, self.height)]
        self.result = RigService.run(
            _document(parts, self.width, self.height),
            sheet=sheet,
            revision_id="rev_child",
        )
        self.part = self.result.document.parts[0]

    def test_vertices_span_the_part_not_the_sheet(self) -> None:
        self.assertEqual(self.part.deformer.kind, "mesh")
        verts = np.asarray(self.part.deformer.verts.values, dtype=np.float64).reshape(-1, 2)
        self.assertTrue((verts >= -1e-6).all())
        self.assertTrue((verts <= 1.0 + 1e-6).all())
        # A sheet-normalized payload could not reach these extents: the part is
        # 15% of the sheet's width and sits at its far corner.
        self.assertGreater(float(verts[:, 0].max()), 0.9)
        self.assertGreater(float(verts[:, 1].max()), 0.9)
        self.assertLess(float(verts[:, 0].min()), 0.1)
        self.assertLess(float(verts[:, 1].min()), 0.1)

    def test_rect_pixel_bounds_invert_the_rect(self) -> None:
        x, y, w, h = rect_pixel_bounds(self.part, self.width, self.height)
        self.assertEqual((x, y, w, h), (240, 260, 48, 40))

    def test_joint_positions_stay_sheet_normalized(self) -> None:
        # Joints are the one thing that is NOT part-local, and the part sits in
        # the far corner, so a part-local leak would show as a joint near 0.5.
        bound = [
            joint
            for joint in self.result.document.skeleton.joints
            if joint.partId == "corner"
        ]
        self.assertEqual(len(bound), 1)
        self.assertGreater(bound[0].x, 0.7)
        self.assertGreater(bound[0].y, 0.7)


# --- Deformer selection -----------------------------------------------------


class RigDeformerSelectionTests(unittest.TestCase):
    def test_humanoid_priors_pick_per_role(self) -> None:
        width, height = 256, 320
        sheet = _sheet(width, height)
        _fill_rect(sheet, 90, 80, 70, 130)
        _fill_rect(sheet, 60, 40, 40, 60)
        _fill_rect(sheet, 100, 220, 26, 26)
        parts = [
            _part("torso", "torso", (90, 80, 70, 130), width, height),
            _part("hair", "hair", (60, 40, 40, 60), width, height),
            _part("hand", "hand", (100, 220, 26, 26), width, height),
        ]
        document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document
        kinds = {part.id: part.deformer.kind for part in document.parts}
        self.assertEqual(kinds, {"torso": "mesh", "hair": "lattice", "hand": "rigid"})

    def test_creature_tail_becomes_a_spline_with_a_joint_chain(self) -> None:
        width, height = 200, 360
        sheet = _sheet(width, height)
        _fill_rect(sheet, 60, 40, 60, 120)
        _fill_taper(sheet, 90, 170, 150)
        parts = [
            _part("torso", "torso", (60, 40, 60, 120), width, height),
            _part("tail", "tail", (70, 170, 60, 150), width, height),
        ]
        document = RigService.run(
            _document(parts, width, height, archetype="creature"),
            sheet=sheet,
            revision_id="r",
        ).document
        tail = next(part for part in document.parts if part.id == "tail")
        self.assertEqual(tail.deformer.kind, "spline")
        # The taper track: one half-width per station along the spine. It is a
        # resolution rather than a structure, so it is independent of how many
        # joints the chain ends up with.
        self.assertEqual(tail.deformer.thickness.length, RigConstants.SPLINE_SEGMENTS + 1)
        self.assertGreaterEqual(tail.deformer.samples, 2)
        # The spine IS the joint chain -- the deformer stores no polyline of its
        # own -- so the chain existing is the whole of the spline's geometry.
        chain = [joint for joint in document.skeleton.joints if joint.partId == "tail"]
        self.assertGreaterEqual(len(chain), 2)
        self.assertIsNotNone(tail.boundJointId)

    def test_a_spline_stores_no_spine_of_its_own(self) -> None:
        """R5 in one assertion: there is exactly one description of the spine.

        A stored bezier chain was authored beside the joint chain and never
        read, so the two were free to drift and only the joints drove the
        render. Asserting the field's absence is what stops it coming back.
        """

        self.assertNotIn("controlPoints", DeformerSpline.model_fields)
        self.assertNotIn("closed", DeformerSpline.model_fields)

    def test_a_blob_refuses_a_spline_and_downgrades_to_rigid(self) -> None:
        width, height = 160, 160
        sheet = _sheet(width, height)
        _fill_disc(sheet, 80, 80, 50)
        parts = [_part("blob", "tail", (30, 30, 100, 100), width, height)]
        document = RigService.run(
            _document(parts, width, height, archetype="creature"),
            sheet=sheet,
            revision_id="r",
        ).document
        self.assertEqual(document.parts[0].deformer.kind, "rigid")
        self.assertTrue(
            any("elongated" in warning for warning in document.diagnostics.warnings),
            document.diagnostics.warnings,
        )

    def test_user_override_beats_the_prior(self) -> None:
        width, height = 200, 240
        sheet = _sheet(width, height)
        _fill_rect(sheet, 50, 50, 80, 120)
        parts = [_part("torso", "torso", (50, 50, 80, 120), width, height)]
        document = RigService.run(
            _document(parts, width, height),
            sheet=sheet,
            revision_id="r",
            deformer_overrides={"torso": "lattice"},
        ).document
        self.assertEqual(document.parts[0].deformer.kind, "lattice")

    def test_ui_glyph_ignores_a_model_hint_but_obeys_a_user_override(self) -> None:
        # F9 §10.6: everything in the ui archetype is rigid, and a glyph may be
        # promoted to mesh only on explicit user request.
        glyph = _part("glyph", "glyph", (0, 0, 10, 10), 100, 100)
        self.assertEqual(
            DeformerSelector.choose(glyph, "ui", hint="mesh"), "rigid"
        )
        self.assertEqual(
            DeformerSelector.choose(glyph, "ui", hint="mesh", override="mesh"), "mesh"
        )

    def test_unknown_override_part_is_refused(self) -> None:
        sheet, parts, width, height = _humanoid_figure()
        with self.assertRaises(RigError):
            RigService.run(
                _document(parts, width, height),
                sheet=sheet,
                revision_id="r",
                deformer_overrides={"nope": "mesh"},
            )


# --- Skeleton ---------------------------------------------------------------


def _joint(
    joint_id: str,
    parent: Optional[str],
    *,
    x: float = 0.5,
    y: float = 0.5,
    part_id: Optional[str] = None,
) -> Joint:
    return Joint(
        id=joint_id,
        name=joint_id,
        role="other",
        x=x,
        y=y,
        parent=parent,
        partId=part_id,
        ikChainLength=None,
        confidence=0.5,
    )


class JointGraphInvariantTests(unittest.TestCase):
    def test_a_valid_chain_passes(self) -> None:
        JointGraph.validate(
            [_joint("a", None), _joint("b", "a"), _joint("c", "b")], ["p"]
        )

    def test_two_roots_are_refused(self) -> None:
        with self.assertRaisesRegex(RigError, "exactly one root"):
            JointGraph.validate([_joint("a", None), _joint("b", None)], [])

    def test_a_missing_parent_is_refused(self) -> None:
        with self.assertRaisesRegex(RigError, "missing parent"):
            JointGraph.validate([_joint("a", None), _joint("b", "ghost")], [])

    def test_a_cycle_is_refused(self) -> None:
        with self.assertRaisesRegex(RigError, "loop"):
            JointGraph.validate(
                [_joint("a", None), _joint("b", "c"), _joint("c", "b")], []
            )

    def test_a_duplicate_id_is_refused(self) -> None:
        with self.assertRaisesRegex(RigError, "duplicates"):
            JointGraph.validate([_joint("a", None), _joint("a", "a")], [])

    def test_an_unknown_part_binding_is_refused(self) -> None:
        with self.assertRaisesRegex(RigError, "unknown part"):
            JointGraph.validate([_joint("a", None, part_id="ghost")], ["real"])

    def test_over_deep_nesting_is_refused(self) -> None:
        depth = int(ANIBUDDY_LIMITS["MAX_JOINT_DEPTH"]) + 2
        joints = [_joint("j0", None)]
        joints += [_joint(f"j{i}", f"j{i - 1}") for i in range(1, depth)]
        with self.assertRaisesRegex(RigError, "too deeply"):
            JointGraph.validate(joints, [])

    def test_too_many_joints_is_refused(self) -> None:
        limit = int(ANIBUDDY_LIMITS["MAX_JOINTS"])
        joints = [_joint("j0", None)]
        joints += [_joint(f"j{i}", "j0") for i in range(1, limit + 2)]
        with self.assertRaisesRegex(RigError, "too many joints"):
            JointGraph.validate(joints, [])

    def test_bone_derivation_matches_the_kernel(self) -> None:
        # The wire column order in DeformerMesh.boneIds only means anything if
        # it is the same list the kernel derives from the same joints.
        joints = [
            _joint("root", None, x=0.5, y=0.2),
            _joint("spine", "root", x=0.5, y=0.4),
            _joint("orphan", None if False else "spine", x=0.6, y=0.6),
        ]
        mine = [bone.id for bone in JointGraph.bones(joints, 100, 200)]
        theirs = [
            bone.id
            for bone in KernelSkeleton.bones(
                tuple(
                    KernelJoint(id=joint.id, parent=joint.parent, x=joint.x, y=joint.y)
                    for joint in joints
                )
            )
        ]
        self.assertEqual(mine, theirs)

    def test_bone_endpoints_are_in_sheet_pixels(self) -> None:
        joints = [_joint("a", None, x=0.25, y=0.5), _joint("b", "a", x=0.75, y=1.0)]
        bones = JointGraph.bones(joints, 200, 100)
        self.assertEqual(bones[0].start, (50.0, 50.0))
        self.assertEqual(bones[0].end, (150.0, 100.0))


class PartTreeTests(unittest.TestCase):
    def test_a_missing_parent_is_refused(self) -> None:
        parts = [_part("a", "torso", (0, 0, 10, 10), 100, 100, parent="ghost")]
        with self.assertRaisesRegex(RigError, "missing parent"):
            PartTree.validate(parts)

    def test_a_cycle_is_refused(self) -> None:
        parts = [
            _part("a", "torso", (0, 0, 10, 10), 100, 100, parent="b"),
            _part("b", "torso", (0, 0, 10, 10), 100, 100, parent="a"),
        ]
        with self.assertRaisesRegex(RigError, "loop"):
            PartTree.validate(parts)

    def test_over_deep_nesting_is_refused(self) -> None:
        depth = int(ANIBUDDY_LIMITS["MAX_PART_DEPTH"]) + 2
        parts = [_part("p0", "torso", (0, 0, 10, 10), 100, 100)]
        parts += [
            _part(f"p{i}", "torso", (0, 0, 10, 10), 100, 100, parent=f"p{i - 1}")
            for i in range(1, depth)
        ]
        with self.assertRaisesRegex(RigError, "too deeply"):
            PartTree.validate(parts)

    def test_derived_parentage_is_a_single_rooted_acyclic_tree(self) -> None:
        sheet, parts, width, height = _humanoid_figure()
        document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document
        parents = {part.id: part.parentPartId for part in document.parts}
        roots = [pid for pid, parent in parents.items() if parent is None]
        self.assertEqual(len(roots), 1)
        for part_id in parents:
            seen: set[str] = set()
            cursor: Optional[str] = part_id
            while cursor is not None:
                self.assertNotIn(cursor, seen, "derived part tree has a cycle")
                seen.add(cursor)
                cursor = parents[cursor]


class RigSkeletonOutputTests(unittest.TestCase):
    def setUp(self) -> None:
        sheet, parts, width, height = _humanoid_figure()
        self.document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document

    def test_output_graph_satisfies_every_invariant(self) -> None:
        JointGraph.validate(
            self.document.skeleton.joints, [part.id for part in self.document.parts]
        )

    def test_ids_match_the_schema_pattern_and_are_unique(self) -> None:
        ids = [joint.id for joint in self.document.skeleton.joints]
        self.assertEqual(len(ids), len(set(ids)))
        for joint_id in ids:
            self.assertRegex(joint_id, _ID_PATTERN)

    def test_a_structural_root_always_exists(self) -> None:
        # MIN_JOINTS is 0, but the kernel refuses a rootless rig, so the stage
        # always authors one root rather than an empty skeleton.
        roots = [
            joint for joint in self.document.skeleton.joints if joint.parent is None
        ]
        self.assertEqual(len(roots), 1)
        self.assertIsNone(roots[0].partId)

    def test_joints_are_reachable_by_the_kernel_forward_kinematics(self) -> None:
        joints = tuple(
            KernelJoint(id=joint.id, parent=joint.parent, x=joint.x, y=joint.y)
            for joint in self.document.skeleton.joints
        )
        asset = KernelAsset(
            width=self.document.asset.width,
            height=self.document.asset.height,
            figure_height=float(self.document.asset.height),
        )
        rest = KernelSkeleton.rest_positions(joints, asset)
        self.assertEqual(len(rest), len(joints))
        for x, y in rest.values():
            self.assertTrue(np.isfinite([x, y]).all())

    def test_ik_chain_length_follows_the_archetype_prior(self) -> None:
        # The humanoid prior sets ikChainLength 2 on limb tips so dragging a
        # hand bends the elbow instead of translating the arm.
        width, height = 200, 300
        sheet = _sheet(width, height)
        _fill_rect(sheet, 60, 40, 60, 120)
        _fill_rect(sheet, 70, 170, 30, 30)
        parts = [
            _part("torso", "torso", (60, 40, 60, 120), width, height),
            _part("hand", "hand", (70, 170, 30, 30), width, height),
        ]
        document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document
        hand = next(
            joint for joint in document.skeleton.joints if joint.partId == "hand"
        )
        self.assertEqual(hand.role, "limbTip")
        self.assertEqual(hand.ikChainLength, 2)


# --- Semantics -------------------------------------------------------------


class RigSemanticsTests(unittest.TestCase):
    def _proposal(self, **overrides) -> SemanticsProposal:
        base = dict(
            archetype="humanoid",
            parts=[
                ProposedPartSemantics(
                    partId="torso",
                    role="torso",
                    parentPartId=None,
                    attachSlot=None,
                    pivotHint=Vec2(x=0.5, y=0.1),
                    zIndex=0,
                    deformerHint="mesh",
                    confidence=0.9,
                )
            ],
            joints=[],
            warnings=[],
        )
        base.update(overrides)
        return SemanticsProposal(**base)

    def test_an_unknown_part_id_rejects_the_whole_proposal(self) -> None:
        width, height = 200, 240
        sheet = _sheet(width, height)
        _fill_rect(sheet, 50, 50, 80, 120)
        parts = [_part("torso", "torso", (50, 50, 80, 120), width, height)]
        proposal = self._proposal(
            parts=[
                ProposedPartSemantics(
                    partId="ghost",
                    role="torso",
                    parentPartId=None,
                    attachSlot=None,
                    pivotHint=Vec2(x=0.5, y=0.5),
                    zIndex=0,
                    deformerHint="mesh",
                    confidence=0.9,
                )
            ]
        )
        with self.assertRaisesRegex(RigError, "unknown part"):
            RigService.run(
                _document(parts, width, height),
                sheet=sheet,
                revision_id="r",
                semantics=proposal,
            )

    def test_a_role_outside_the_archetype_vocabulary_is_refused(self) -> None:
        width, height = 200, 240
        sheet = _sheet(width, height)
        _fill_rect(sheet, 50, 50, 80, 120)
        parts = [_part("torso", "torso", (50, 50, 80, 120), width, height)]
        proposal = self._proposal(
            parts=[
                ProposedPartSemantics(
                    partId="torso",
                    role="chassis",
                    parentPartId=None,
                    attachSlot=None,
                    pivotHint=Vec2(x=0.5, y=0.5),
                    zIndex=0,
                    deformerHint="rigid",
                    confidence=0.9,
                )
            ]
        )
        with self.assertRaisesRegex(RigError, "archetype vocabulary"):
            RigService.run(
                _document(parts, width, height),
                sheet=sheet,
                revision_id="r",
                semantics=proposal,
            )

    def test_a_joint_on_transparent_pixels_is_refused(self) -> None:
        width, height = 200, 240
        sheet = _sheet(width, height)
        _fill_rect(sheet, 50, 50, 40, 40)
        parts = [_part("torso", "torso", (50, 50, 80, 120), width, height)]
        proposal = self._proposal(
            joints=[
                ProposedJointSemantics(
                    jointId="root",
                    name="Root",
                    role="root",
                    partId=None,
                    parent=None,
                    x=0.5,
                    y=0.5,
                ),
                ProposedJointSemantics(
                    jointId="hip",
                    name="Hip",
                    role="spine",
                    partId="torso",
                    parent="root",
                    # Inside the rect, but the artwork only fills its top-left
                    # quarter, so this lands on transparent pixels.
                    x=(50 + 70) / width,
                    y=(50 + 110) / height,
                ),
            ]
        )
        with self.assertRaisesRegex(RigError, "transparent pixels"):
            RigService.run(
                _document(parts, width, height),
                sheet=sheet,
                revision_id="r",
                semantics=proposal,
            )

    def test_a_proposed_skeleton_still_gets_spline_joint_chains(self) -> None:
        # A model may not author geometry (R3), so it never proposes the chain a
        # spline is posed from; the rig stage appends it either way.
        width, height = 200, 360
        sheet = _sheet(width, height)
        _fill_rect(sheet, 60, 40, 60, 120)
        _fill_taper(sheet, 90, 170, 150)
        parts = [
            _part("torso", "torso", (60, 40, 60, 120), width, height),
            _part("tail", "tail", (70, 170, 60, 150), width, height),
        ]
        proposal = SemanticsProposal(
            archetype="creature",
            parts=[
                ProposedPartSemantics(
                    partId="torso",
                    role="torso",
                    parentPartId=None,
                    attachSlot=None,
                    pivotHint=Vec2(x=0.5, y=0.1),
                    zIndex=0,
                    deformerHint="mesh",
                    confidence=0.9,
                ),
                ProposedPartSemantics(
                    partId="tail",
                    role="tail",
                    parentPartId="torso",
                    attachSlot=None,
                    pivotHint=Vec2(x=0.5, y=0.1),
                    zIndex=1,
                    deformerHint="spline",
                    confidence=0.8,
                ),
            ],
            joints=[
                ProposedJointSemantics(
                    jointId="root",
                    name="Root",
                    role="root",
                    partId=None,
                    parent=None,
                    x=0.45,
                    y=0.3,
                ),
                ProposedJointSemantics(
                    jointId="spine",
                    name="Spine",
                    role="spine",
                    partId="torso",
                    parent="root",
                    x=(60 + 30) / width,
                    y=(40 + 60) / height,
                ),
                ProposedJointSemantics(
                    jointId="tailBase",
                    name="Tail base",
                    role="tail",
                    partId="tail",
                    parent="spine",
                    x=93 / width,
                    y=175 / height,
                ),
            ],
            warnings=[],
        )
        document = RigService.run(
            _document(parts, width, height, archetype="creature"),
            sheet=sheet,
            revision_id="r",
            semantics=proposal,
        ).document
        tail_joints = [
            joint for joint in document.skeleton.joints if joint.partId == "tail"
        ]
        self.assertGreaterEqual(len(tail_joints), 2)
        self.assertIn("tailBase", [joint.id for joint in tail_joints])
        JointGraph.validate(
            document.skeleton.joints, [part.id for part in document.parts]
        )
        tail = next(part for part in document.parts if part.id == "tail")
        self.assertEqual(tail.deformer.kind, "spline")

    def test_a_valid_proposal_is_adopted(self) -> None:
        width, height = 200, 240
        sheet = _sheet(width, height)
        _fill_rect(sheet, 50, 50, 80, 120)
        parts = [_part("torso", "other", (50, 50, 80, 120), width, height)]
        document = RigService.run(
            _document(parts, width, height),
            sheet=sheet,
            revision_id="r",
            semantics=self._proposal(),
        ).document
        self.assertEqual(document.parts[0].role, "torso")
        self.assertEqual(document.parts[0].provenance, "vision")
        self.assertEqual(document.parts[0].deformer.kind, "mesh")


# --- Cut lines and skinning ------------------------------------------------


class SkinCutOcclusionTests(unittest.TestCase):
    """The v3 cut-line semantics (lib/mesh.ts 193-224), preserved."""

    def _strip(self) -> tuple[np.ndarray, np.ndarray]:
        """A 40x120 grid mesh, part-local pixels, split by a horizontal cut."""
        xs, ys = np.meshgrid(
            np.linspace(2.0, 38.0, 7), np.linspace(2.0, 118.0, 21), indexing="xy"
        )
        verts = np.stack([xs.ravel(), ys.ravel()], axis=1)
        tris: List[List[int]] = []
        for row in range(20):
            for column in range(6):
                a = row * 7 + column
                tris.append([a, a + 1, a + 7])
                tris.append([a + 1, a + 8, a + 7])
        return verts, np.asarray(tris, dtype=np.int64)

    def _bone(self, name: str, y0: float, y1: float) -> BoneSegment:
        return BoneSegment(
            id=name,
            parent_joint_id=name.split("->")[0],
            child_joint_id=name.split("->")[1],
            start=(20.0, y0),
            end=(20.0, y1),
            parent_part_id="p",
            child_part_id="p",
        )

    def _bones(self) -> List[BoneSegment]:
        # One bone in each half of the strip. The gap straddles y = 57, which is
        # BETWEEN grid rows (they sit at 54.2 and 60.0) — a cut placed exactly on
        # a row would touch its vertices rather than properly cross their edges,
        # and v3's crossing test is strict on purpose.
        return [self._bone("j0->j1", 5.0, 50.0), self._bone("j1->j2", 64.0, 115.0)]

    def test_a_cut_isolates_influence_across_it(self) -> None:
        verts, tris = self._strip()
        cut = CutPolyline(
            id="cut1",
            points=np.array([[-10.0, 57.0], [50.0, 57.0]], dtype=np.float64),
        )
        with_cut = Skinner.solve(verts, tris, self._bones(), (0.0, 0.0), [cut])
        without = Skinner.solve(verts, tris, self._bones(), (0.0, 0.0), [])

        self.assertTrue(Skinner.rows_sum_to_one(with_cut.weights))
        self.assertFalse(np.isnan(with_cut.weights).any())

        top = verts[:, 1] < 57.0
        bottom = verts[:, 1] > 57.0
        # Above the cut the lower bone must have no influence at all; without the
        # cut it bleeds across the midline, which is what cuts exist to stop.
        self.assertAlmostEqual(float(with_cut.weights[top, 1].max()), 0.0, places=6)
        self.assertAlmostEqual(float(with_cut.weights[bottom, 0].max()), 0.0, places=6)
        self.assertGreater(float(without.weights[top, 1].max()), 1e-3)

    def test_a_pocket_severed_from_every_bone_falls_back_instead_of_nan(self) -> None:
        verts, tris = self._strip()
        # Both bones live in the top half, and one cut fences the bottom half off
        # from both of them: the straight path from any bottom vertex to either
        # bone crosses the cut, so nothing can claim them.
        bones = [self._bone("j0->j1", 5.0, 25.0), self._bone("j1->j2", 28.0, 50.0)]
        cuts = [
            CutPolyline(
                id="a",
                points=np.array([[-10.0, 57.0], [50.0, 57.0]], dtype=np.float64),
            )
        ]
        result = Skinner.solve(verts, tris, bones, (0.0, 0.0), cuts)
        self.assertFalse(np.isnan(result.weights).any())
        self.assertTrue(Skinner.rows_sum_to_one(result.weights))
        self.assertGreater(result.isolated_vertices, 0)
        # The fallback is nearest-bone at full weight, not a zero row.
        below = verts[:, 1] > 57.0
        np.testing.assert_allclose(
            result.weights[below].sum(axis=1), 1.0, atol=1e-5
        )

    def test_weights_stay_bounded_in_zero_one(self) -> None:
        verts, tris = self._strip()
        result = Skinner.solve(verts, tris, self._bones(), (0.0, 0.0), [])
        self.assertGreaterEqual(float(result.weights.min()), 0.0)
        self.assertLessEqual(float(result.weights.max()), 1.0 + 1e-6)

    def test_no_bones_yields_an_empty_matrix_not_a_crash(self) -> None:
        verts, tris = self._strip()
        result = Skinner.solve(verts, tris, [], (0.0, 0.0), [])
        self.assertEqual(result.weights.shape[1], 0)
        self.assertEqual(result.bone_ids, [])
        self.assertTrue(Skinner.rows_sum_to_one(result.weights))

    def test_part_binding_beats_proximity_when_selecting_columns(self) -> None:
        verts, tris = self._strip()
        far_own_bone = BoneSegment(
            id="a->b",
            parent_joint_id="a",
            child_joint_id="b",
            start=(500.0, 500.0),
            end=(500.0, 600.0),
            parent_part_id="p",
            child_part_id="p",
        )
        near_foreign_bone = BoneSegment(
            id="c->d",
            parent_joint_id="c",
            child_joint_id="d",
            start=(20.0, 10.0),
            end=(20.0, 110.0),
            parent_part_id="other",
            child_part_id="other",
        )
        selected = Skinner.select_bones(
            "p", [far_own_bone, near_foreign_bone], verts, (0.0, 0.0), 1
        )
        self.assertEqual([bone.id for bone in selected], ["a->b"])


class RigCutPreservationTests(unittest.TestCase):
    def test_an_existing_user_cut_survives_a_re_rig(self) -> None:
        width, height = 200, 300
        sheet = _sheet(width, height)
        _fill_rect(sheet, 60, 40, 70, 200)
        points, _ = Buffers.f32([0.0, 0.5, 1.0, 0.5], project_id="proj_test")
        parts = [
            _part(
                "torso",
                "torso",
                (60, 40, 70, 200),
                width,
                height,
                cuts=[CutLine(id="cut1", points=points)],
            )
        ]
        document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document
        torso = document.parts[0]
        self.assertEqual(torso.deformer.kind, "mesh")
        self.assertEqual([cut.id for cut in torso.deformer.cuts], ["cut1"])
        rows = _mesh_rows(torso.deformer)
        self.assertFalse(np.isnan(rows).any())
        self.assertTrue(Skinner.rows_sum_to_one(rows.astype(np.float32)))


# --- Numeric buffers -------------------------------------------------------


class NumericBufferTests(unittest.TestCase):
    def test_a_small_buffer_stays_inline_with_a_matching_hash(self) -> None:
        values = [0.5, -1.25, 2.0]
        buffer, pending = Buffers.f32(values, project_id="proj_test")
        self.assertEqual(buffer.storage, "inline")
        self.assertIsNone(buffer.storageKey)
        self.assertEqual(pending, [])
        self.assertEqual(buffer.length, 3)
        expected = hashlib.sha256(
            b"".join(struct.pack("<f", value) for value in values)
        ).hexdigest()
        self.assertEqual(buffer.sha256, expected)
        self.assertEqual(buffer.values, values)

    def test_an_oversized_buffer_goes_external_and_content_addressed(self) -> None:
        limit = int(ANIBUDDY_LIMITS["MAX_INLINE_BUFFER_ELEMENTS"])
        values = np.arange(limit + 1, dtype=np.float32)
        buffer, pending = Buffers.f32(values, project_id="proj_test")
        self.assertEqual(buffer.storage, "external")
        self.assertIsNone(buffer.values)
        self.assertEqual(buffer.length, limit + 1)
        self.assertRegex(buffer.sha256, _HEX64)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].storage_key, buffer.storageKey)
        self.assertIn("proj_test", buffer.storageKey or "")
        self.assertIn(buffer.sha256, buffer.storageKey or "")
        # Content addressed: same bytes, same key, so a re-run is a no-op upload.
        again, _ = Buffers.f32(values, project_id="proj_test")
        self.assertEqual(again.storageKey, buffer.storageKey)

    def test_exactly_at_the_limit_stays_inline(self) -> None:
        limit = int(ANIBUDDY_LIMITS["MAX_INLINE_BUFFER_ELEMENTS"])
        buffer, pending = Buffers.f32(np.zeros(limit), project_id="proj_test")
        self.assertEqual(buffer.storage, "inline")
        self.assertEqual(pending, [])

    def test_an_out_of_range_index_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            Buffers.u32([-1], project_id="proj_test")

    def test_a_many_boned_part_externalizes_its_weight_matrix(self) -> None:
        # The Poisson pitch scales with area, so a part's vertex count is roughly
        # constant however large it is on the sheet — size alone never overflows
        # the inline budget. Column count does: a torso surrounded by accessories
        # owns a bone per accessory, and vertCount x boneCount crosses
        # MAX_INLINE_BUFFER_ELEMENTS at a dozen of them.
        width, height = 512, 512
        sheet = _sheet(width, height)
        _fill_rect(sheet, 100, 60, 200, 380)
        parts = [_part("torso", "torso", (100, 60, 200, 380), width, height)]
        for index in range(14):
            x = 110 + (index % 7) * 26
            y = 80 + (index // 7) * 300
            _fill_rect(sheet, x, y, 18, 18)
            parts.append(
                _part(
                    f"acc{index}",
                    "accessory",
                    (x, y, 18, 18),
                    width,
                    height,
                    parent="torso",
                )
            )
        result = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        )
        torso = next(part for part in result.document.parts if part.id == "torso")
        self.assertEqual(torso.deformer.kind, "mesh")
        self.assertGreater(len(torso.deformer.boneIds), 10)
        externals = [
            buffer
            for part in result.document.parts
            if part.deformer.kind == "mesh"
            for buffer in (part.deformer.verts, part.deformer.tris, part.deformer.weights)
            if buffer.storage == "external"
        ]
        self.assertTrue(externals, "expected at least one externalized buffer")
        keys = {buffer.storageKey for buffer in externals}
        self.assertTrue(keys <= {b.storage_key for b in result.pending_buffers})
        for buffer in externals:
            self.assertIsNone(buffer.values)
            self.assertGreater(buffer.length, int(ANIBUDDY_LIMITS["MAX_INLINE_BUFFER_ELEMENTS"]))
        for pending in result.pending_buffers:
            expected_size = pending.length * 4
            self.assertEqual(len(pending.data), expected_size)
            self.assertEqual(hashlib.sha256(pending.data).hexdigest(), pending.sha256)


# --- Degenerate inputs -----------------------------------------------------


class RigDegenerateInputTests(unittest.TestCase):
    def test_a_tiny_part_downgrades_to_rigid_with_a_warning(self) -> None:
        width, height = 64, 64
        sheet = _sheet(width, height)
        _fill_rect(sheet, 10, 10, 2, 2)
        parts = [_part("speck", "torso", (10, 10, 2, 2), width, height)]
        document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document
        self.assertEqual(document.parts[0].deformer.kind, "rigid")
        self.assertIsNotNone(document.parts[0].boundJointId)
        self.assertTrue(document.diagnostics.warnings)

    def test_a_part_with_no_opaque_pixels_is_warned_and_rigid(self) -> None:
        width, height = 64, 64
        sheet = _sheet(width, height)
        parts = [_part("empty", "torso", (10, 10, 30, 30), width, height)]
        document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document
        self.assertEqual(document.parts[0].deformer.kind, "rigid")
        self.assertTrue(
            any("no opaque pixels" in w for w in document.diagnostics.warnings),
            document.diagnostics.warnings,
        )

    def test_no_parts_is_refused(self) -> None:
        with self.assertRaisesRegex(RigError, "no parts"):
            RigService.run(
                _document([], 64, 64), sheet=_sheet(64, 64), revision_id="r"
            )

    def test_an_alpha_mask_without_the_sheet_is_refused(self) -> None:
        parts = [_part("torso", "torso", (0, 0, 32, 32), 64, 64)]
        with self.assertRaisesRegex(RigError, "need the source sheet"):
            RigService.run(_document(parts, 64, 64), sheet=None, revision_id="r")

    def test_a_rect_mask_needs_no_sheet(self) -> None:
        parts = [
            _part("panel", "panel", (0, 0, 60, 40), 64, 64, mask_kind="rect")
        ]
        document = RigService.run(
            _document(parts, 64, 64, archetype="ui"), sheet=None, revision_id="r"
        ).document
        self.assertEqual(document.parts[0].deformer.kind, "rigid")
        self.assertFalse(Raster.needs_sheet(parts[0]))


# --- Document plumbing -----------------------------------------------------


class RigDocumentTests(unittest.TestCase):
    def setUp(self) -> None:
        sheet, parts, width, height = _humanoid_figure()
        self.parent = _document(parts, width, height)
        self.sheet = sheet
        self.result = RigService.run(
            self.parent, sheet=sheet, revision_id="rev_child"
        )

    def test_it_writes_a_child_revision_and_leaves_the_parent_alone(self) -> None:
        child = self.result.document
        self.assertEqual(child.id, "rev_child")
        self.assertEqual(child.revision.index, self.parent.revision.index + 1)
        self.assertEqual(child.revision.parentRevisionId, self.parent.id)
        self.assertFalse(child.revision.accepted)
        # R9: the input document is not mutated in place.
        self.assertEqual(self.parent.skeleton.joints, [])
        self.assertTrue(
            all(part.deformer.kind == "rigid" for part in self.parent.parts)
        )

    def test_it_appends_one_stage_record(self) -> None:
        stages = self.result.document.provenance.stages
        self.assertEqual(len(stages), len(self.parent.provenance.stages) + 1)
        record = stages[-1]
        self.assertEqual(record.stage, "rig")
        self.assertEqual(record.status, "succeeded")
        self.assertRegex(record.inputHash, _HEX64)
        self.assertIsNone(record.modelId)
        self.assertIn(RigConstants.SKINNING_METHOD, record.message or "")

    def test_a_healthy_rig_is_not_blocked(self) -> None:
        self.assertIsNone(self.result.document.diagnostics.blockingReason)

    def test_diagnostics_are_server_authored(self) -> None:
        diagnostics = self.result.document.diagnostics
        self.assertGreaterEqual(diagnostics.isolatedVertices, 0)
        # Per-frame metrics belong to render; rig must not invent them.
        self.assertEqual(diagnostics.maxStretch, self.parent.diagnostics.maxStretch)
        self.assertEqual(
            diagnostics.flippedTriangles, self.parent.diagnostics.flippedTriangles
        )

    def test_the_document_round_trips_through_the_generated_contract(self) -> None:
        RigDocument.model_validate(json.loads(self.result.document.model_dump_json()))

    def test_slots_come_from_the_archetype_prior(self) -> None:
        torso = next(part for part in self.result.document.parts if part.id == "torso")
        names = {slot.name for slot in torso.slots}
        self.assertIn("neck", names)
        self.assertLessEqual(len(torso.slots), int(ANIBUDDY_LIMITS["MAX_SLOTS_PER_PART"]))

    def test_a_child_attaches_to_a_prior_slot_of_its_parent(self) -> None:
        head = next(part for part in self.result.document.parts if part.id == "head")
        self.assertEqual(head.parentPartId, "torso")
        self.assertEqual(head.attachSlot, "neck")

    def test_it_is_idempotent_on_identical_input(self) -> None:
        again = RigService.run(self.parent, sheet=self.sheet, revision_id="rev_child")
        first = [
            (part.id, part.deformer.kind, _buffer_hashes(part))
            for part in self.result.document.parts
        ]
        second = [
            (part.id, part.deformer.kind, _buffer_hashes(part))
            for part in again.document.parts
        ]
        self.assertEqual(first, second)
        self.assertEqual(
            self.result.document.provenance.stages[-1].inputHash,
            again.document.provenance.stages[-1].inputHash,
        )


def _buffer_hashes(part: Part) -> tuple[str, ...]:
    deformer = part.deformer
    if deformer.kind == "mesh":
        return (deformer.verts.sha256, deformer.tris.sha256, deformer.weights.sha256)
    if deformer.kind == "lattice":
        return (deformer.controlPoints.sha256,)
    if deformer.kind == "spline":
        return (deformer.controlPoints.sha256, deformer.thickness.sha256)
    return ()


class RigMultiPartSheetTests(unittest.TestCase):
    def test_a_four_part_sheet_rigs_every_part(self) -> None:
        width, height = 300, 400
        sheet = _sheet(width, height)
        _fill_rect(sheet, 110, 100, 70, 150)
        _fill_rect(sheet, 70, 110, 32, 130)
        _fill_rect(sheet, 190, 110, 32, 130)
        _fill_disc(sheet, 145, 60, 34)
        parts = [
            _part("torso", "torso", (110, 100, 70, 150), width, height),
            _part("armL", "armUpper", (70, 110, 32, 130), width, height),
            _part("armR", "armUpper", (190, 110, 32, 130), width, height),
            _part("head", "head", (111, 26, 68, 68), width, height, pivot=(0.5, 0.9)),
        ]
        result = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        )
        document = result.document
        self.assertEqual(len(document.parts), 4)
        self.assertEqual(
            {part.deformer.kind for part in document.parts}, {"mesh"}
        )
        self.assertLessEqual(
            len(document.skeleton.joints), int(ANIBUDDY_LIMITS["MAX_JOINTS"])
        )
        JointGraph.validate(document.skeleton.joints, [p.id for p in document.parts])
        self.assertIsNone(document.diagnostics.blockingReason)
        for part in document.parts:
            rows = _mesh_rows(part.deformer)
            self.assertFalse(np.isnan(rows).any(), part.id)
            self.assertTrue(
                np.abs(rows.sum(axis=1) - 1.0).max()
                <= ANIBUDDY_LIMITS["WEIGHT_ROW_EPSILON"],
                part.id,
            )

    def test_environment_layers_stay_flat_and_rigid(self) -> None:
        width, height = 320, 200
        sheet = _sheet(width, height)
        _fill_rect(sheet, 0, 0, 320, 90)
        _fill_rect(sheet, 0, 100, 320, 100)
        parts = [
            _part("sky", "skyLayer", (0, 0, 320, 90), width, height, mask_kind="rect"),
            _part(
                "water",
                "waterLayer",
                (0, 100, 320, 100),
                width,
                height,
                mask_kind="rect",
            ),
        ]
        document = RigService.run(
            _document(parts, width, height, archetype="environment"),
            sheet=sheet,
            revision_id="r",
        ).document
        kinds = {part.id: part.deformer.kind for part in document.parts}
        self.assertEqual(kinds, {"sky": "rigid", "water": "lattice"})
        water = next(part for part in document.parts if part.id == "water")
        self.assertEqual(
            water.deformer.controlPoints.length // 2,
            (water.deformer.cols + 1) * (water.deformer.rows + 1),
        )
        self.assertLessEqual(water.deformer.cols, int(ANIBUDDY_LIMITS["MAX_LATTICE_COLS"]))
        self.assertLessEqual(water.deformer.rows, int(ANIBUDDY_LIMITS["MAX_LATTICE_ROWS"]))
        for part in document.parts:
            self.assertIsNotNone(part.boundJointId)


class LatticeRestGridTests(unittest.TestCase):
    def test_the_rest_grid_is_uniform_and_row_major(self) -> None:
        width, height = 200, 200
        sheet = _sheet(width, height)
        _fill_rect(sheet, 20, 20, 160, 160)
        parts = [_part("cape", "cape", (20, 20, 160, 160), width, height)]
        document = RigService.run(
            _document(parts, width, height), sheet=sheet, revision_id="r"
        ).document
        lattice = document.parts[0].deformer
        self.assertEqual(lattice.kind, "lattice")
        points = np.asarray(lattice.controlPoints.values, dtype=np.float64).reshape(-1, 2)
        grid = points.reshape(lattice.rows + 1, lattice.cols + 1, 2)
        expected_x = np.linspace(0.0, 1.0, lattice.cols + 1)
        expected_y = np.linspace(0.0, 1.0, lattice.rows + 1)
        for row in range(lattice.rows + 1):
            np.testing.assert_allclose(grid[row, :, 0], expected_x, atol=1e-6)
            np.testing.assert_allclose(
                grid[row, :, 1], np.full(lattice.cols + 1, expected_y[row]), atol=1e-6
            )


def _envelope(payload) -> tuple:
    """The JSON envelope as a multipart FILE part.

    A file part rather than a form field because Starlette caps a non-file part at
    1 MB, and a 64-part document exceeds that on its own — see ``_envelope`` in the
    router. The filename is what makes it a file part; its value is not read.
    """
    return ("request.json", json.dumps(payload).encode("utf-8"), "application/json")


class RigEndpointTests(unittest.TestCase):
    """The HTTP surface Node posts to, exercised without the app's middleware."""

    def _client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from app.modules.anibuddy.router import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_it_rigs_a_multipart_upload(self) -> None:
        import io

        from PIL import Image

        sheet, parts, width, height = _humanoid_figure()
        document = _document(parts, width, height)
        buffer = io.BytesIO()
        Image.fromarray(sheet, mode="RGBA").save(buffer, format="PNG")

        payload = {
            "document": json.loads(document.model_dump_json()),
            "revisionId": "rev_http",
            "deformerOverrides": {},
            "passIndex": 0,
        }
        response = self._client().post(
            "/anibuddy/rig",
            files={
                "request": _envelope(payload),
                "image": ("sheet.png", buffer.getvalue(), "image/png"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["document"]["id"], "rev_http")
        self.assertGreater(len(body["document"]["skeleton"]["joints"]), 1)
        self.assertIsNone(body["document"]["diagnostics"]["blockingReason"])
        self.assertIsInstance(body["buffers"], list)
        RigDocument.model_validate(body["document"])

    def test_it_rigs_without_an_upload_when_masks_are_self_describing(self) -> None:
        parts = [_part("panel", "panel", (0, 0, 60, 40), 64, 64, mask_kind="rect")]
        payload = {
            "document": json.loads(_document(parts, 64, 64, archetype="ui").model_dump_json()),
            "revisionId": "rev_http2",
        }
        response = self._client().post(
            "/anibuddy/rig", files={"request": _envelope(payload)}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["document"]["parts"][0]["deformer"]["kind"], "rigid")

    def test_a_structural_refusal_is_a_422_with_a_reason(self) -> None:
        parts = [_part("torso", "torso", (0, 0, 32, 32), 64, 64)]
        payload = {
            "document": json.loads(_document(parts, 64, 64).model_dump_json()),
            "revisionId": "rev_http3",
        }
        response = self._client().post(
            "/anibuddy/rig", files={"request": _envelope(payload)}
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("source sheet", response.json()["detail"])

    def test_a_malformed_body_is_a_422(self) -> None:
        response = self._client().post(
            "/anibuddy/rig",
            files={"request": ("request.json", b"{", "application/json")},
        )
        self.assertEqual(response.status_code, 422)

    def test_an_empty_envelope_is_named_rather_than_parsed(self) -> None:
        # A zero-byte part is a client bug, and "Invalid rig request" would send the
        # caller looking at their document instead of at their form builder.
        response = self._client().post(
            "/anibuddy/rig",
            files={"request": ("request.json", b"", "application/json")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("Empty", response.json()["detail"])

    def _oversized_envelope(self) -> bytes:
        """A rig request envelope larger than Starlette's 1 MB part cap.

        Grown by repeating real parts rather than by padding with filler text, so
        the size comes from the same place a real document's does: a 64-part sheet
        exceeds 1 MB once masks and vertex arrays are inline, and it does so even
        with oversized geometry already sent out of band — ``MAX_INLINE_BUFFER_ELEMENTS``
        is a per-buffer ceiling, not a per-document one.
        """
        parts = [
            _part(f"panel{index}", "panel", (0, 0, 60, 40), 64, 64, mask_kind="rect")
            for index in range(32)
        ]
        payload = {
            "document": json.loads(_document(parts, 64, 64, archetype="ui").model_dump_json()),
            "revisionId": "rev_big",
        }
        envelope = json.dumps(payload).encode("utf-8")
        while len(envelope) <= 1024 * 1024:
            payload["document"]["parts"].extend(payload["document"]["parts"])
            envelope = json.dumps(payload).encode("utf-8")
        self.assertGreater(len(envelope), 1024 * 1024)
        return envelope

    def test_an_oversized_envelope_sent_as_a_form_field_never_reaches_the_handler(
        self,
    ) -> None:
        """The failure this endpoint's signature change exists to remove.

        Starlette measures a non-file part against ``max_part_size`` (1 MB) and
        raises ``MultiPartException`` above it. The result is a 400 from the parser,
        before any handler runs, naming neither the field nor the endpoint — so a
        caller sees "Part exceeded maximum size of 1024KB" and has nothing in the
        message to connect it to a rig document that grew.
        """
        response = self._client().post(
            "/anibuddy/rig", data={"request": self._oversized_envelope().decode("utf-8")}
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("exceeded", response.text.lower())

    def test_the_same_oversized_envelope_is_accepted_as_a_file_part(self) -> None:
        """And the fix: the identical bytes reach the handler as a file part.

        A part with a filename is spooled to a temporary file and has no size bound,
        so this removes the class of failure rather than moving it to the next
        document that grows. What the rig stage then DECIDES about a document with
        this many parts is its own business — the property under test is that it was
        given the bytes to decide on.
        """
        response = self._client().post(
            "/anibuddy/rig",
            files={
                "request": ("request.json", self._oversized_envelope(), "application/json")
            },
        )
        self.assertNotEqual(response.status_code, 400, response.text)
        self.assertNotIn("exceeded", response.text.lower())
        self.assertIn(response.status_code, (200, 422), response.text)
        if response.status_code == 422:
            # The refusal is this endpoint's own validator talking about the document
            # (this one is past MAX_PARTS), which is the proof the handler ran.
            self.assertIn("rig request", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
