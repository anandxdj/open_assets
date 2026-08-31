"""Golden regression tests for the Python deformation kernel.

Half of the parity harness. This half asks "did OUR math move?" -- the Python
kernel generates the goldens, so it must reproduce them byte for byte. The
other half lives at
``frontend/src/features/anibuddy/kernel/__tests__/parity.test.ts`` and asks
"did the browser drift from the server?", comparing the TypeScript kernel
against the same goldens within a documented float32 ULP budget.

Run both with ``scripts/test-anibuddy-kernel.sh``.

Because the goldens are generated from this kernel, a golden comparison alone
would be circular: change the math and the generator, and the test still
passes. The analytic tests at the bottom close that hole -- they assert
properties derived by hand, not recorded from a run.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

import numpy as np

from app.modules.anibuddy.kernel import (
    AniBuddyKernel,
    Clip,
    KernelConstants,
    KernelInputError,
    KernelRig,
    PartPose,
    PoseTrack,
    Skin,
    Warp,
    pose_from_mapping,
)
from app.modules.anibuddy.kernel_fixtures import KernelFixtures

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "anibuddy-kernel"
CASE_DIR = FIXTURE_ROOT / "cases"
GOLDEN_DIR = FIXTURE_ROOT / "golden"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _ordered_bits(value: float) -> int:
    """Map a float32 onto a monotonically ordered integer.

    Consecutive representable floats map to consecutive integers, so the
    difference between two of these IS the ULP distance. Sign-magnitude is
    converted to a signed ordering, which also collapses -0 and +0 onto the
    same value.

    Mirrors ``orderedBits`` in the TypeScript parity test.
    """

    bits = int(np.float32(value).view(np.int32))
    magnitude = bits & 0x7FFFFFFF
    return -magnitude if bits < 0 else magnitude


def _ulp_distance(a: float, b: float) -> float:
    if math.isnan(a) or math.isnan(b):
        return 0.0 if (math.isnan(a) and math.isnan(b)) else math.inf
    if not math.isfinite(a) or not math.isfinite(b):
        return 0.0 if a == b else math.inf
    return abs(_ordered_bits(a) - _ordered_bits(b))


class GoldenCorpusTests(unittest.TestCase):
    """Every committed case must still reproduce its committed golden.

    Compared in float32 ULP with the same budget the TypeScript kernel is held
    to, not byte for byte. The goldens are generated on one machine and CI runs
    on another: ``math.sin`` resolves to the platform libm, and glibc and the
    Windows CRT are each free to land on a different last bit. Demanding exact
    equality would turn that into a red build with no defect behind it, and the
    first fix anyone reached for would be to loosen something that matters.
    """

    #: Filled by the golden test, printed once at the end so the margin is
    #: visible in CI logs rather than only on failure.
    worst_per_case: list[tuple[str, float, str]] = []

    @classmethod
    def tearDownClass(cls) -> None:
        if not cls.worst_per_case:
            return
        rows = "\n".join(
            f"  {name:<34} {ulp:>3.0f} ULP  {field}" for name, ulp, field in cls.worst_per_case
        )
        overall = max(ulp for _name, ulp, _field in cls.worst_per_case)
        print(
            f"\nfloat32 ULP distance from the committed goldens "
            f"(budget {KernelConstants.PARITY_ULP_TOLERANCE}):\n{rows}\n"
            f"  worst overall: {overall:.0f} ULP\n"
        )

    def test_corpus_is_present_and_paired(self) -> None:
        cases = sorted(path.name for path in CASE_DIR.glob("*.json"))
        goldens = sorted(path.name for path in GOLDEN_DIR.glob("*.json"))
        self.assertGreaterEqual(len(cases), 1, "the fixture corpus is empty")
        self.assertEqual(
            cases,
            goldens,
            "every case needs a golden; run python -m tools.gen_kernel_goldens",
        )

    def _compare_floats(
        self,
        field: str,
        actual: list[float],
        expected: list[float],
        worst: tuple[float, str, int],
    ) -> tuple[float, str, int]:
        self.assertEqual(
            len(actual),
            len(expected),
            f"{field}: produced {len(actual)} values, golden has {len(expected)}. A length "
            f"mismatch is structural, not numeric -- the kernel changed how many vertices or "
            f"triangles this deformer emits.",
        )
        current = worst
        for index, (left, right) in enumerate(zip(actual, expected)):
            distance = _ulp_distance(left, right)
            if distance > current[0]:
                current = (distance, field, index)
        return current

    def test_every_case_matches_its_golden(self) -> None:
        for case_path in sorted(CASE_DIR.glob("*.json")):
            with self.subTest(case=case_path.name):
                case = _load(case_path)
                golden = _load(GOLDEN_DIR / case_path.name)
                actual = json.loads(json.dumps(KernelFixtures.evaluate(case), allow_nan=False))

                self.assertEqual(actual["id"], golden["id"])
                worst: tuple[float, str, int] = (0.0, "(exact)", -1)

                for field in ("pose", "partPose"):
                    self.assertEqual(
                        [f"{row[0]}.{row[1]}" for row in actual[field]],
                        [f"{row[0]}.{row[1]}" for row in golden[field]],
                        f"the clip resolved to a different set of {field} channels",
                    )
                    worst = self._compare_floats(
                        field,
                        [row[2] for row in actual[field]],
                        [row[2] for row in golden[field]],
                        worst,
                    )

                for label, key in (("joints", "joints"), ("bones", "bones")):
                    self.assertEqual(
                        [row[0] for row in actual[key]],
                        [row[0] for row in golden[key]],
                        f"{label}: identity or ordering differs. Bone order indexes the "
                        f"weight-matrix columns, so a reordering silently rebinds every vertex.",
                    )
                    for column in (1, 2, 3):
                        worst = self._compare_floats(
                            f"{label}[*][{column}]",
                            [row[column] for row in actual[key]],
                            [row[column] for row in golden[key]],
                            worst,
                        )

                self.assertEqual(len(actual["parts"]), len(golden["parts"]), "part count differs")
                for actual_part, golden_part in zip(actual["parts"], golden["parts"]):
                    self.assertEqual(actual_part["id"], golden_part["id"])
                    self.assertEqual(actual_part["kind"], golden_part["kind"])
                    # Topology and counts are compared exactly: no rounding
                    # could make an index or a tally differ legitimately.
                    self.assertEqual(actual_part["tris"], golden_part["tris"])
                    self.assertEqual(
                        actual_part["warp"]["triangleIndex"], golden_part["warp"]["triangleIndex"]
                    )
                    self.assertEqual(
                        actual_part["warp"]["flippedTriangles"],
                        golden_part["warp"]["flippedTriangles"],
                    )
                    self.assertEqual(
                        actual_part["warp"]["degenerateTriangles"],
                        golden_part["warp"]["degenerateTriangles"],
                    )
                    for field in ("transform", "srcVerts", "dstVerts"):
                        worst = self._compare_floats(
                            f"{golden_part['id']}.{field}",
                            actual_part[field],
                            golden_part[field],
                            worst,
                        )
                    for field in ("matrices", "bled"):
                        worst = self._compare_floats(
                            f"{golden_part['id']}.warp.{field}",
                            actual_part["warp"][field],
                            golden_part["warp"][field],
                            worst,
                        )
                    self.assertLessEqual(
                        abs(actual_part["warp"]["maxStretch"] - golden_part["warp"]["maxStretch"]),
                        max(1.0, abs(golden_part["warp"]["maxStretch"]))
                        * KernelConstants.PARITY_STRETCH_RELATIVE_TOLERANCE,
                        f"{golden_part['id']}: maxStretch drifted beyond its relative tolerance",
                    )

                GoldenCorpusTests.worst_per_case.append((case_path.name, worst[0], worst[1]))
                self.assertLessEqual(
                    worst[0],
                    KernelConstants.PARITY_ULP_TOLERANCE,
                    f"{case_path.name} drifted {worst[0]:.0f} float32 ULP from its golden at "
                    f"{worst[1]}[{worst[2]}]. If the change to the math was intended, regenerate "
                    f"with `python -m tools.gen_kernel_goldens` and read the diff; if it was not, "
                    f"this is the regression the corpus exists to catch.",
                )

    def test_corpus_covers_every_deformer_and_both_pathologies(self) -> None:
        """A corpus that never exercises a branch cannot protect it."""

        kinds: set[str] = set()
        saw_degenerate = False
        saw_flipped = False
        saw_high_stretch = False
        for golden_path in sorted(GOLDEN_DIR.glob("*.json")):
            for part in _load(golden_path)["parts"]:
                kinds.add(part["kind"])
                saw_degenerate = saw_degenerate or part["warp"]["degenerateTriangles"] > 0
                saw_flipped = saw_flipped or part["warp"]["flippedTriangles"] > 0
                saw_high_stretch = (
                    saw_high_stretch or part["warp"]["maxStretch"] > KernelConstants.STRETCH_WARNING
                )
        self.assertEqual(kinds, {"rigid", "mesh", "lattice", "spline"})
        self.assertTrue(saw_degenerate, "no case produces a degenerate triangle")
        self.assertTrue(saw_flipped, "no case produces an orientation flip")
        self.assertTrue(saw_high_stretch, "no case exceeds the stretch warning threshold")

    def test_corpus_covers_the_part_transform_tree(self) -> None:
        """Same rule, applied to the tree: an unexercised branch is unprotected.

        Four things have to appear somewhere in the corpus, because each is a
        separate way for the two kernels to disagree: a non-identity transform
        at all, a chain at least two deep, an attachment slot, and part channels
        that came out of a CLIP rather than out of a literal pose block.
        """

        saw_transform = False
        saw_part_channels = False
        saw_nesting = False
        saw_attach_slot = False

        for golden_path in sorted(GOLDEN_DIR.glob("*.json")):
            golden = _load(golden_path)
            saw_part_channels = saw_part_channels or bool(golden["partPose"])
            for part in golden["parts"]:
                saw_transform = saw_transform or part["transform"] != [1.0, 0.0, 0.0, 0.0]

        for case_path in sorted(CASE_DIR.glob("*.json")):
            case = _load(case_path)
            parts = case["rig"].get("parts", [])
            parented = {
                part["id"] for part in parts if part.get("parentPartId") is not None
            }
            saw_nesting = saw_nesting or any(
                part.get("parentPartId") in parented for part in parts
            )
            saw_attach_slot = saw_attach_slot or any(
                part.get("attachSlot") is not None for part in parts
            )
            if "clip" in case:
                saw_part_channels = saw_part_channels or any(
                    key.get("parts") for key in case["clip"].get("keyframes", [])
                )

        self.assertTrue(saw_transform, "no case produces a non-identity part transform")
        self.assertTrue(saw_nesting, "no case nests a part two levels deep")
        self.assertTrue(saw_attach_slot, "no case attaches a part to a slot")
        self.assertTrue(saw_part_channels, "no case animates a part channel")


class ForwardKinematicsTests(unittest.TestCase):
    """Hand-derived checks, so the goldens are not the only source of truth."""

    def _rig(self) -> KernelRig:
        # A 100x100 sheet with a single horizontal bone from (50, 50) to
        # (90, 50): rest angle 0 degrees, rest length 40 px. Every number below
        # is exact in binary, so these assertions can be exact.
        return KernelRig.from_mapping(
            {
                "asset": {"width": 100, "height": 100, "figureHeight": 100},
                "joints": [
                    {"id": "root", "parent": None, "x": 0.5, "y": 0.5},
                    {"id": "tip", "parent": "root", "x": 0.9, "y": 0.5},
                ],
                "parts": [],
            }
        )

    def test_rest_pose_leaves_every_joint_at_rest(self) -> None:
        skeleton = AniBuddyKernel.solve(self._rig(), {})
        self.assertEqual(skeleton.positions["root"], (50.0, 50.0))
        self.assertAlmostEqual(skeleton.positions["tip"][0], 90.0, places=12)
        self.assertAlmostEqual(skeleton.positions["tip"][1], 50.0, places=12)
        self.assertEqual(float(skeleton.rest_angles[0]), 0.0)
        self.assertEqual(float(skeleton.rest_lengths[0]), 40.0)

    def test_ninety_degree_rotation_swings_the_tip_down(self) -> None:
        """Canvas orientation: +90 degrees points at +y, which is DOWN."""

        skeleton = AniBuddyKernel.solve(self._rig(), pose_from_mapping({"tip": {"rot": 90}}))
        self.assertAlmostEqual(skeleton.positions["tip"][0], 50.0, places=10)
        self.assertAlmostEqual(skeleton.positions["tip"][1], 90.0, places=10)

    def test_scale_changes_bone_length_not_bone_angle(self) -> None:
        skeleton = AniBuddyKernel.solve(self._rig(), pose_from_mapping({"tip": {"scale": 0.5}}))
        self.assertAlmostEqual(skeleton.positions["tip"][0], 70.0, places=12)
        self.assertEqual(float(skeleton.posed_angles[0]), 0.0)

    def test_rotation_accumulates_down_the_chain(self) -> None:
        rig = KernelRig.from_mapping(
            {
                "asset": {"width": 100, "height": 100, "figureHeight": 100},
                "joints": [
                    {"id": "a", "parent": None, "x": 0.1, "y": 0.5},
                    {"id": "b", "parent": "a", "x": 0.3, "y": 0.5},
                    {"id": "c", "parent": "b", "x": 0.5, "y": 0.5},
                ],
                "parts": [],
            }
        )
        skeleton = AniBuddyKernel.solve(rig, pose_from_mapping({"b": {"rot": 20}, "c": {"rot": 15}}))
        # b turns 20, c inherits that and adds 15.
        self.assertAlmostEqual(skeleton.accumulated["b"], 20.0, places=12)
        self.assertAlmostEqual(skeleton.accumulated["c"], 35.0, places=12)

    def test_translation_scales_by_figure_height_not_canvas_height(self) -> None:
        rig = KernelRig.from_mapping(
            {
                "asset": {"width": 100, "height": 100, "figureHeight": 50},
                "joints": [{"id": "root", "parent": None, "x": 0.5, "y": 0.5}],
                "parts": [],
            }
        )
        skeleton = AniBuddyKernel.solve(rig, pose_from_mapping({"root": {"ty": 0.5}}))
        self.assertEqual(skeleton.positions["root"], (50.0, 75.0))


class SkinningTests(unittest.TestCase):
    def test_identity_pose_returns_the_source_vertices(self) -> None:
        """Weights chosen to sum to exactly 1 in binary, so this can be exact."""

        rig = KernelRig.from_mapping(
            {
                "asset": {"width": 128, "height": 128, "figureHeight": 128},
                "joints": [
                    {"id": "root", "parent": None, "x": 0.25, "y": 0.5},
                    {"id": "mid", "parent": "root", "x": 0.5, "y": 0.5},
                    {"id": "tip", "parent": "mid", "x": 0.75, "y": 0.5},
                ],
                "parts": [
                    {
                        "id": "strip",
                        "deformer": {
                            "kind": "mesh",
                            "boneCount": 2,
                            "verts": [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75],
                            "tris": [0, 1, 3, 0, 3, 2],
                            "weights": [0.75, 0.25, 0.5, 0.5, 0.25, 0.75, 0.5, 0.5],
                        },
                    }
                ],
            }
        )
        frame = AniBuddyKernel.evaluate(rig, {})
        np.testing.assert_array_equal(frame.parts[0].dst_verts, frame.parts[0].src_verts)

    def test_a_single_bone_at_weight_one_is_a_rigid_transform(self) -> None:
        """Rigid is not a different algorithm, only a different weighting.

        A four-vertex quad skinned entirely to one bone must land exactly where
        the rigid deformer's affine puts it. If these ever disagree, one of the
        two transform derivations has been edited in isolation.
        """

        rig = KernelRig.from_mapping(
            {
                "asset": {"width": 256, "height": 256, "figureHeight": 256},
                "joints": [
                    {"id": "root", "parent": None, "x": 0.5, "y": 0.75},
                    {"id": "head", "parent": "root", "x": 0.5, "y": 0.25},
                ],
                "parts": [
                    {
                        "id": "plate",
                        "rect": [0.25, 0.1, 0.75, 0.4],
                        "boundJointId": "root",
                        "deformer": {"kind": "rigid"},
                    }
                ],
            }
        )
        pose = pose_from_mapping({"root": {"rot": 30}})
        frame = AniBuddyKernel.evaluate(rig, pose)
        skeleton = AniBuddyKernel.solve(rig, pose)

        transform = Skin.joint_transform(skeleton, "root")
        expected = Skin.apply_affine(
            np.array([[64.0, 25.6], [192.0, 25.6], [64.0, 102.4], [192.0, 102.4]]),
            transform,
        )
        np.testing.assert_allclose(frame.parts[0].dst_verts, expected, rtol=0, atol=1e-3)


class WarpTests(unittest.TestCase):
    def test_identity_warp_is_the_identity_matrix(self) -> None:
        verts = np.array([[0.0, 0.0], [10.0, 0.0], [0.0, 10.0]], dtype=np.float64)
        tris = np.array([[0, 1, 2]], dtype=np.uint32)
        batch = Warp.triangles(verts, verts, tris)
        np.testing.assert_allclose(batch.matrices[0], [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], atol=1e-7)
        self.assertEqual(batch.max_stretch, 1.0)
        self.assertEqual(batch.flipped_triangles, 0)

    def test_uniaxial_stretch_is_reported_as_its_ratio(self) -> None:
        src = np.array([[0.0, 0.0], [10.0, 0.0], [0.0, 10.0]], dtype=np.float64)
        dst = np.array([[0.0, 0.0], [30.0, 0.0], [0.0, 10.0]], dtype=np.float64)
        batch = Warp.triangles(src, dst, np.array([[0, 1, 2]], dtype=np.uint32))
        self.assertAlmostEqual(batch.max_stretch, 3.0, places=5)

    def test_mirrored_triangle_is_counted_as_flipped(self) -> None:
        src = np.array([[0.0, 0.0], [10.0, 0.0], [0.0, 10.0]], dtype=np.float64)
        dst = np.array([[0.0, 0.0], [0.0, 10.0], [10.0, 0.0]], dtype=np.float64)
        batch = Warp.triangles(src, dst, np.array([[0, 1, 2]], dtype=np.uint32))
        self.assertEqual(batch.flipped_triangles, 1)

    def test_degenerate_source_triangle_is_dropped(self) -> None:
        src = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]], dtype=np.float64)
        batch = Warp.triangles(src, src, np.array([[0, 1, 2]], dtype=np.uint32))
        self.assertEqual(batch.degenerate_triangles, 1)
        self.assertEqual(batch.matrices.shape[0], 0)

    def test_seam_bleed_pushes_each_corner_exactly_half_a_pixel_out(self) -> None:
        src = np.array([[0.0, 0.0], [12.0, 0.0], [0.0, 12.0]], dtype=np.float64)
        batch = Warp.triangles(src, src, np.array([[0, 1, 2]], dtype=np.uint32))
        centroid = src.mean(axis=0)
        for corner in range(3):
            before = math.dist(src[corner], centroid)
            after = math.dist(batch.bled[0, corner], centroid)
            self.assertAlmostEqual(after - before, KernelConstants.SEAM_BLEED, places=4)


class PoseTrackTests(unittest.TestCase):
    def _clip(self, loop: bool) -> Clip:
        return Clip.from_mapping(
            {
                "id": "test",
                "loop": loop,
                "keyframes": [
                    {"t": 0.0, "joints": {"a": {"rot": 0.0}}, "ease": "linear"},
                    {"t": 0.5, "joints": {"a": {"rot": 10.0, "scale": 2.0}}, "ease": "hold"},
                    {"t": 1.0, "joints": {"a": {"rot": 20.0}}},
                ],
            }
        )

    def test_landing_on_a_key_returns_that_key(self) -> None:
        pose = PoseTrack.pose_at(self._clip(loop=False), 0.5)
        self.assertAlmostEqual(pose["a"].rot, 10.0, places=6)
        self.assertAlmostEqual(pose["a"].scale, 2.0, places=6)

    def test_linear_easing_interpolates_proportionally(self) -> None:
        pose = PoseTrack.pose_at(self._clip(loop=False), 0.25)
        self.assertAlmostEqual(pose["a"].rot, 5.0, places=6)

    def test_hold_easing_stays_on_the_starting_key(self) -> None:
        pose = PoseTrack.pose_at(self._clip(loop=False), 0.75)
        self.assertAlmostEqual(pose["a"].rot, 10.0, places=6)

    def test_absent_channel_falls_back_to_rest_not_to_the_neighbour(self) -> None:
        """The key at t=1 omits scale, so scale must decay toward 1, not hold 2."""

        clip = Clip.from_mapping(
            {
                "id": "test",
                "loop": False,
                "keyframes": [
                    {"t": 0.0, "joints": {"a": {"scale": 2.0}}, "ease": "linear"},
                    {"t": 1.0, "joints": {"a": {"rot": 4.0}}, "ease": "linear"},
                ],
            }
        )
        pose = PoseTrack.pose_at(clip, 0.5)
        self.assertAlmostEqual(pose["a"].scale, 1.5, places=6)
        self.assertAlmostEqual(pose["a"].rot, 2.0, places=6)

    def test_absent_ease_is_smoothstep(self) -> None:
        clip = Clip.from_mapping(
            {
                "id": "test",
                "loop": False,
                "keyframes": [
                    {"t": 0.0, "joints": {"a": {"rot": 0.0}}},
                    {"t": 1.0, "joints": {"a": {"rot": 100.0}}},
                ],
            }
        )
        # smoothstep(0.25) = 0.25^2 * (3 - 0.5) = 0.15625
        self.assertAlmostEqual(PoseTrack.pose_at(clip, 0.25)["a"].rot, 15.625, places=6)

    def test_loop_wraps_back_onto_the_first_key(self) -> None:
        """Past the last key a looping clip heads home; a one-shot holds."""

        looped = PoseTrack.pose_at(self._clip(loop=True), 1.0)
        one_shot = PoseTrack.pose_at(self._clip(loop=False), 1.0)
        self.assertAlmostEqual(one_shot["a"].rot, 20.0, places=6)
        self.assertAlmostEqual(looped["a"].rot, 20.0, places=6)
        # Just inside the synthetic span the looped clip has started to move
        # back toward key 0 while the one-shot has not.
        self.assertLess(PoseTrack.pose_at(self._clip(loop=True), 0.999)["a"].rot, 20.0)

    def test_empty_clip_is_an_empty_pose(self) -> None:
        clip = Clip.from_mapping({"id": "empty", "loop": True, "keyframes": []})
        self.assertEqual(PoseTrack.pose_at(clip, 0.4), {})


class PartTreeTests(unittest.TestCase):
    """Hand-derived part-tree checks, mirrored one for one in the TS suite.

    Every rig here is 100x100 with the part quad on quarter boundaries, so the
    expected numbers are exact integers arrived at on paper rather than recorded
    from a run. That is the point: the goldens come from this kernel, so only
    assertions derived independently can catch a shared misunderstanding.
    """

    def _rig(self, parts: list[dict], figure_height: float = 100.0) -> KernelRig:
        return KernelRig.from_mapping(
            {
                "asset": {"width": 100, "height": 100, "figureHeight": figure_height},
                "joints": [{"id": "root", "parent": None, "x": 0.5, "y": 0.5}],
                "parts": parts,
            }
        )

    def _quad(self, part_id: str, **overrides: object) -> dict:
        """A part whose rigid quad spans 25..75 px on both axes.

        The rigid deformer draws ``Part.rect``, so the quad and the part-local
        space its pivot is measured in are now the same rectangle. The pivot
        still lands on (50, 50) px and the quad still spans 25..75, so every
        expected number below is the one it always was.
        """

        part: dict = {
            "id": part_id,
            "rect": [0.25, 0.25, 0.75, 0.75],
            "pivot": [0.5, 0.5],
            "boundJointId": "root",
            "deformer": {"kind": "rigid"},
        }
        part.update(overrides)
        return part

    def test_a_part_at_rest_gets_exactly_the_identity(self) -> None:
        """Exactly, not approximately -- the skip in ``evaluate`` depends on it."""

        frame = AniBuddyKernel.evaluate(self._rig([self._quad("a")]), {})
        self.assertEqual(frame.parts[0].transform, (1.0, 0.0, 0.0, 0.0))
        np.testing.assert_array_equal(
            frame.parts[0].dst_verts, frame.parts[0].src_verts
        )

    def test_rotation_turns_the_part_about_its_own_pivot(self) -> None:
        """+90 degrees is clockwise on canvas, so (25,25) swings to (75,25)."""

        frame = AniBuddyKernel.evaluate(
            self._rig([self._quad("a")]),
            {},
            part_pose={"a": PartPose(rot=90.0)},
        )
        np.testing.assert_allclose(frame.parts[0].dst_verts[0], [75.0, 25.0], atol=1e-4)

    def test_a_child_composes_with_its_parent_rather_than_replacing_it(self) -> None:
        """Two 90-degree turns about the same pivot must total 180, not 90.

        The assertion that pins composition ORDER as well as presence: applying
        only the child, only the parent, or the two in the wrong order all land
        somewhere other than the opposite corner.
        """

        rig = self._rig(
            [self._quad("a"), self._quad("b", parentPartId="a")]
        )
        frame = AniBuddyKernel.evaluate(
            rig,
            {},
            part_pose={"a": PartPose(rot=90.0), "b": PartPose(rot=90.0)},
        )
        np.testing.assert_allclose(frame.parts[1].dst_verts[0], [75.0, 75.0], atol=1e-4)

    def test_a_child_with_no_pose_still_follows_its_parent(self) -> None:
        rig = self._rig([self._quad("a"), self._quad("b", parentPartId="a")])
        frame = AniBuddyKernel.evaluate(
            rig, {}, part_pose={"a": PartPose(rot=90.0)}
        )
        np.testing.assert_allclose(frame.parts[1].dst_verts[0], [75.0, 25.0], atol=1e-4)

    def test_translation_scales_by_figure_height_not_canvas_height(self) -> None:
        """Same convention as ``JointPose.tx`` -- R6, and the same constant."""

        frame = AniBuddyKernel.evaluate(
            self._rig([self._quad("a")], figure_height=50.0),
            {},
            part_pose={"a": PartPose(tx=0.5)},
        )
        np.testing.assert_allclose(frame.parts[0].dst_verts[0], [50.0, 25.0], atol=1e-9)

    def test_an_attachment_slot_moves_the_child_pivot_onto_it(self) -> None:
        """The host's slot is at 50,50 px; the child's pivot at 70,70.

        Attaching therefore translates the child by exactly (-20, -20), so its
        quad's top-left corner moves from (60,60) to (40,40). Every number is an
        integer, so this can be asserted exactly.
        """

        rig = KernelRig.from_mapping(
            {
                "asset": {"width": 100, "height": 100, "figureHeight": 100},
                "joints": [{"id": "root", "parent": None, "x": 0.5, "y": 0.5}],
                "parts": [
                    {
                        "id": "host",
                        "rect": [0.0, 0.0, 0.5, 0.5],
                        "pivot": [0.5, 0.5],
                        "slots": [{"name": "tip", "position": [1.0, 1.0]}],
                        "boundJointId": "root",
                        "deformer": {"kind": "rigid"},
                    },
                    {
                        "id": "clipOn",
                        "rect": [0.6, 0.6, 0.8, 0.8],
                        "pivot": [0.5, 0.5],
                        "parentPartId": "host",
                        "attachSlot": "tip",
                        "boundJointId": "root",
                        "deformer": {"kind": "rigid"},
                    },
                ],
            }
        )
        frame = AniBuddyKernel.evaluate(rig, {})
        self.assertEqual(frame.parts[1].transform, (1.0, 0.0, -20.0, -20.0))
        np.testing.assert_array_equal(frame.parts[1].dst_verts[0], [40.0, 40.0])

    def test_parenting_without_a_slot_leaves_the_child_where_it_was_drawn(self) -> None:
        """The other half of the slot contract, and the reason it is safe.

        A rig stage that parents every part by overlap must not move any of
        them; only naming a slot is an instruction to re-anchor.
        """

        rig = self._rig([self._quad("a"), self._quad("b", parentPartId="a")])
        frame = AniBuddyKernel.evaluate(rig, {})
        self.assertEqual(frame.parts[1].transform, (1.0, 0.0, 0.0, 0.0))

    def test_an_unknown_parent_is_refused(self) -> None:
        rig = self._rig([self._quad("a", parentPartId="ghost")])
        with self.assertRaises(KernelInputError) as caught:
            AniBuddyKernel.evaluate(rig, {})
        self.assertIn("ghost", str(caught.exception))

    def test_a_cycle_is_refused(self) -> None:
        rig = self._rig(
            [self._quad("a", parentPartId="b"), self._quad("b", parentPartId="a")]
        )
        with self.assertRaises(KernelInputError) as caught:
            AniBuddyKernel.evaluate(rig, {})
        self.assertIn("cycle", str(caught.exception))

    def test_a_chain_past_the_depth_cap_is_refused(self) -> None:
        depth = KernelConstants.MAX_PART_DEPTH + 1
        parts = [self._quad("p0")]
        parts.extend(
            self._quad(f"p{index}", parentPartId=f"p{index - 1}")
            for index in range(1, depth + 1)
        )
        with self.assertRaises(KernelInputError) as caught:
            AniBuddyKernel.evaluate(self._rig(parts), {})
        self.assertIn(str(KernelConstants.MAX_PART_DEPTH), str(caught.exception))

    def test_a_duplicate_part_id_is_refused(self) -> None:
        with self.assertRaises(KernelInputError):
            AniBuddyKernel.evaluate(self._rig([self._quad("a"), self._quad("a")]), {})

    def test_an_unoffered_slot_is_refused(self) -> None:
        rig = self._rig(
            [self._quad("a"), self._quad("b", parentPartId="a", attachSlot="nope")]
        )
        with self.assertRaises(KernelInputError) as caught:
            AniBuddyKernel.evaluate(rig, {})
        self.assertIn("nope", str(caught.exception))

    def test_an_attachment_with_no_parent_is_refused(self) -> None:
        with self.assertRaises(KernelInputError):
            AniBuddyKernel.evaluate(self._rig([self._quad("a", attachSlot="tip")]), {})


class PartPoseTrackTests(unittest.TestCase):
    """``part_pose_at`` must behave exactly as ``pose_at`` does."""

    def _clip(self) -> Clip:
        return Clip.from_mapping(
            {
                "id": "test",
                "loop": False,
                "keyframes": [
                    {
                        "t": 0.0,
                        "joints": {"a": {"rot": 0.0}},
                        "parts": {"lid": {"scale": 2.0}},
                        "ease": "linear",
                    },
                    {
                        "t": 1.0,
                        "joints": {"a": {"rot": 4.0}},
                        "parts": {"lid": {"rot": 4.0}},
                        "ease": "linear",
                    },
                ],
            }
        )

    def test_an_absent_part_channel_falls_back_to_rest(self) -> None:
        """The key at t=1 omits scale, so scale decays toward 1, not toward 2."""

        pose = PoseTrack.part_pose_at(self._clip(), 0.5)
        self.assertAlmostEqual(pose["lid"].scale, 1.5, places=6)
        self.assertAlmostEqual(pose["lid"].rot, 2.0, places=6)

    def test_part_and_joint_channels_ease_by_the_same_progress(self) -> None:
        """One bracket, one easing curve. A desync here has no visible symptom."""

        clip = self._clip()
        for time in (0.2, 0.5, 0.8):
            joints = PoseTrack.pose_at(clip, time)
            parts = PoseTrack.part_pose_at(clip, time)
            self.assertAlmostEqual(joints["a"].rot, parts["lid"].rot, places=12)

    def test_a_clip_with_no_part_keys_resolves_to_an_empty_part_pose(self) -> None:
        clip = Clip.from_mapping(
            {
                "id": "joints-only",
                "loop": False,
                "keyframes": [
                    {"t": 0.0, "joints": {"a": {"rot": 0.0}}},
                    {"t": 1.0, "joints": {"a": {"rot": 10.0}}},
                ],
            }
        )
        self.assertEqual(PoseTrack.part_pose_at(clip, 0.5), {})


class DeterminismTests(unittest.TestCase):
    def test_evaluation_is_reproducible_within_a_process(self) -> None:
        case = _load(CASE_DIR / "06-mixed-large-sheet.json")
        first = json.dumps(KernelFixtures.evaluate(case), allow_nan=False)
        second = json.dumps(KernelFixtures.evaluate(case), allow_nan=False)
        self.assertEqual(first, second)

    def test_degree_conversion_keeps_its_operation_order(self) -> None:
        """(d * PI) / 180 and d * (PI / 180) are different functions.

        Guarded by a test because the "simplification" is tempting, invisible in
        review, and would show up only as a parity failure in the browser.
        """

        from app.modules.anibuddy.kernel import Numeric

        divergent = [value for value in range(1, 4000) if Numeric.radians(value) != value * (math.pi / 180)]
        self.assertGreater(
            len(divergent),
            0,
            "if these never differ the guard is meaningless; check the constant folding",
        )
        self.assertEqual(Numeric.radians(180.0), (180.0 * math.pi) / 180.0)


class SplineTaperTests(unittest.TestCase):
    """Hand-derived taper, mirrored one for one in the TypeScript parity test.

    Every number below is arrived at on paper rather than recorded from a run,
    which is the only kind of assertion that catches a misunderstanding the two
    kernels SHARE -- and taper is new math, so both were written against the
    same sentence in the schema and could have read it the same wrong way.
    """

    def _straight_tail(self, thickness: list[float], segments: int) -> KernelRig:
        """Two joints on a horizontal line 60 px apart, at y = 50."""

        return KernelRig.from_mapping(
            {
                "asset": {"width": 100, "height": 100, "figureHeight": 100},
                "joints": [
                    {"id": "root", "parent": None, "x": 0.2, "y": 0.5},
                    {"id": "tip", "parent": "root", "x": 0.8, "y": 0.5},
                ],
                "parts": [
                    {
                        "id": "tail",
                        "deformer": {
                            "kind": "spline",
                            "joints": ["root", "tip"],
                            "thickness": thickness,
                            "segments": segments,
                        },
                    }
                ],
            }
        )

    def test_the_track_interpolates_linearly_to_a_point(self) -> None:
        """A track of [0.2, 0.0] over two segments gives half-widths 10, 5, 0.

        The spine is straight and horizontal, so the normal is exactly (0, 1)
        and each sample's two rails sit at ``y = 50 +/- halfWidth``. The middle
        sample lands at x = 50: the Catmull-Rom through a two-point chain has
        phantom endpoints, so its bezier is (20, 30, 70, 80) and t = 0.5 gives
        (20 + 3*30 + 3*70 + 80) / 8 = 50.
        """

        frame = AniBuddyKernel.evaluate(self._straight_tail([0.2, 0.0], 2), {})
        np.testing.assert_allclose(
            frame.parts[0].dst_verts,
            [[20.0, 60.0], [20.0, 40.0], [50.0, 55.0], [50.0, 45.0], [80.0, 50.0], [80.0, 50.0]],
            rtol=0,
            atol=1e-4,
        )

    def test_a_one_entry_track_is_a_uniform_ribbon(self) -> None:
        """m == 1 is not a special case to branch on, it is a flat track."""

        tapered = AniBuddyKernel.evaluate(self._straight_tail([0.2], 2), {})
        for sample in range(3):
            self.assertAlmostEqual(
                float(tapered.parts[0].dst_verts[sample * 2][1]), 60.0, places=4
            )

    def test_the_track_is_indexed_along_the_spine_not_by_joint(self) -> None:
        """A three-entry track over a two-joint chain still spans the whole tail.

        Indexed by joint it would run off the end at the second joint; indexed
        by normalized position it reaches its last entry exactly at the tip,
        which is what this asserts.
        """

        frame = AniBuddyKernel.evaluate(self._straight_tail([0.2, 0.1, 0.0], 4), {})
        rails = [float(frame.parts[0].dst_verts[k * 2][1]) - 50.0 for k in range(5)]
        np.testing.assert_allclose(rails, [10.0, 7.5, 5.0, 2.5, 0.0], rtol=0, atol=1e-4)


class BoundJointFallbackTests(unittest.TestCase):
    """A part with no usable bound joint rides the ROOT, not the identity.

    Mirrored in the TypeScript parity test. The two kernels used to resolve this
    in their own wire adapters and had drifted apart; asserting it here is what
    keeps the rule in one place.
    """

    def _rig(self, bound: object, kind: str = "rigid") -> KernelRig:
        deformer: dict = {"kind": "rigid"}
        if kind == "lattice":
            deformer = {
                "kind": "lattice",
                "cols": 1,
                "rows": 1,
                "interpolation": "bilinear",
                "controlPoints": [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            }
        part: dict = {
            "id": "flag",
            "rect": [0.0, 0.0, 0.5, 0.5],
            "deformer": deformer,
        }
        if bound is not ...:
            part["boundJointId"] = bound
        return KernelRig.from_mapping(
            {
                "asset": {"width": 100, "height": 100, "figureHeight": 100},
                "joints": [{"id": "root", "parent": None, "x": 0.5, "y": 0.5}],
                "parts": [part],
            }
        )

    def test_null_missing_and_unknown_all_ride_the_root(self) -> None:
        """The root translates by +25 px, so every corner must move with it.

        Integers throughout: figureHeight is 100 and tx is 0.25. Were the
        fallback the identity, dst would equal src and this would read 0.
        """

        pose = pose_from_mapping({"root": {"tx": 0.25}})
        expected = [[25.0, 0.0], [75.0, 0.0], [25.0, 50.0], [75.0, 50.0]]
        for bound in (None, ..., "noSuchJoint"):
            with self.subTest(bound=bound):
                frame = AniBuddyKernel.evaluate(self._rig(bound), pose)
                np.testing.assert_allclose(
                    frame.parts[0].dst_verts, expected, rtol=0, atol=1e-9
                )

    def test_a_lattice_falls_back_the_same_way_as_a_rigid_part(self) -> None:
        """The divergence that started this: same field, same rule, both kinds."""

        pose = pose_from_mapping({"root": {"tx": 0.25}})
        rigid = AniBuddyKernel.evaluate(self._rig(None), pose)
        lattice = AniBuddyKernel.evaluate(self._rig(None, kind="lattice"), pose)
        np.testing.assert_allclose(
            lattice.parts[0].dst_verts, rigid.parts[0].dst_verts, rtol=0, atol=1e-9
        )


if __name__ == "__main__":
    unittest.main()
