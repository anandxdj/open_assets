"""Golden regression tests for the Python compositing-channel resolver.

Half of the compositing parity harness. This half asks "did OUR reading of the
channels move?" -- the Python resolver generates the goldens, so it must
reproduce them. The other half lives at
``frontend/src/features/anibuddy/editor/__tests__/compositing-parity.test.ts``
and asks "did the browser drift from the server?", comparing the TypeScript
resolver against the same goldens.

Run both with ``scripts/test-anibuddy-compositing.sh``.

Why a second corpus exists
--------------------------
``fixtures/anibuddy-kernel/`` compares VERTICES, and compositing moves none. The
two implementations disagreed for months about what ``Part.opacity`` MEANS when a
clip also keys ``PartPose.opacity`` -- the server multiplied, the browser treated
it as a fallback -- and about whether ``swapTo`` substitutes a part's pixels or
its whole posed self. Both are wrong-render bugs a user would see immediately and
neither could ever fail the vertex harness, which reported 0 ULP across all
seventeen fixtures throughout.

Because the goldens are generated from this resolver, a golden comparison alone
would be circular: change the semantics and the generator, and the test still
passes. The analytic tests at the bottom close that hole -- they assert
properties derived by hand from the rule the JSON Schema states, not recorded
from a run. The corpus-coverage test closes a different one: a corpus that stops
exercising a branch cannot protect it.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

import numpy as np

from app.modules.anibuddy.compositing_fixtures import (
    CompositingFixtures,
    FixtureClip,
    FixtureKeyframe,
    FixturePart,
    FixturePartPose,
    FixtureRect,
)
from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.kernel import KernelConstants, PoseTrack
from app.modules.anibuddy.render.adapter import RigAdapter
from app.modules.anibuddy.render.partpose import PartPoseTrack

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "anibuddy-compositing"
CASE_DIR = FIXTURE_ROOT / "cases"
GOLDEN_DIR = FIXTURE_ROOT / "golden"

#: Column offsets into a golden ``draw`` row, so an assertion names a field
#: rather than an index. The row is flat because a flat row is diffable.
DRAW_PART_ID = 0
DRAW_TEXTURE_PART_ID = 1
DRAW_Z_INDEX = 2
DRAW_OPACITY = 3
DRAW_ORDER = 4
DRAW_REMAP = slice(5, 9)

#: Column offsets into a golden ``resolved`` row.
RESOLVED_PART_ID = 0
RESOLVED_VISIBLE = 1
RESOLVED_OPACITY = 2
RESOLVED_Z_INDEX = 3
RESOLVED_SWAP_TO = 4


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _ordered_bits(value: float) -> int:
    """Map a float32 onto a monotonically ordered integer.

    Mirrors ``_ordered_bits`` in ``test_kernel_parity`` and ``orderedBits`` in
    both TypeScript harnesses, for the same reason: the difference between two
    of these IS the ULP distance.
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


def _part(
    part_id: str,
    *,
    visible: bool = True,
    opacity: float = 1.0,
    z_index: int = 0,
    rect: tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0),
) -> FixturePart:
    return FixturePart(
        id=part_id,
        visible=visible,
        opacity=opacity,
        zIndex=z_index,
        rect=FixtureRect(*rect),
    )


def _silent(_message: str) -> None:
    """Warning sink for cases that are not about warnings."""


class GoldenCorpusTests(unittest.TestCase):
    """Every committed case must still reproduce its committed golden."""

    def test_corpus_is_present_and_paired(self) -> None:
        cases = sorted(path.name for path in CASE_DIR.glob("*.json"))
        goldens = sorted(path.name for path in GOLDEN_DIR.glob("*.json"))
        self.assertGreaterEqual(len(cases), 1, "the fixture corpus is empty")
        self.assertEqual(
            cases,
            goldens,
            "every case needs a golden; run python -m tools.gen_compositing_goldens",
        )

    def test_every_case_matches_its_golden(self) -> None:
        for case_path in sorted(CASE_DIR.glob("*.json")):
            with self.subTest(case=case_path.name):
                case = _load(case_path)
                golden = _load(GOLDEN_DIR / case_path.name)
                actual = json.loads(
                    json.dumps(CompositingFixtures.evaluate(case), allow_nan=False)
                )

                self.assertEqual(actual["id"], golden["id"])
                self.assertEqual(
                    actual["warnings"],
                    golden["warnings"],
                    "the resolver emitted a different set of warnings",
                )
                self.assertEqual(
                    len(actual["frames"]),
                    len(golden["frames"]),
                    "the case sampled a different number of instants",
                )

                for index, (frame, expected) in enumerate(
                    zip(actual["frames"], golden["frames"])
                ):
                    label = f"{case_path.name} frame {index} @ t={expected['time']}"
                    self._compare_frame(label, frame, expected)

    def _compare_frame(self, label: str, actual: dict, expected: dict) -> None:
        # Identity, visibility, draw order and swap target are compared EXACTLY.
        # None of them is a measurement: there is no rounding that could make a
        # boolean, an integer draw order or a part id differ legitimately.
        self.assertEqual(
            [row[RESOLVED_PART_ID] for row in actual["resolved"]],
            [row[RESOLVED_PART_ID] for row in expected["resolved"]],
            f"{label}: resolved a different set of parts",
        )
        for column, name in (
            (RESOLVED_VISIBLE, "visible"),
            (RESOLVED_Z_INDEX, "zIndex"),
            (RESOLVED_SWAP_TO, "swapTo"),
        ):
            self.assertEqual(
                [row[column] for row in actual["resolved"]],
                [row[column] for row in expected["resolved"]],
                f"{label}: {name} differs",
            )
        self._compare_floats(
            f"{label}: opacity",
            [row[RESOLVED_OPACITY] for row in actual["resolved"]],
            [row[RESOLVED_OPACITY] for row in expected["resolved"]],
        )

        self.assertEqual(
            [row[:DRAW_OPACITY] + row[DRAW_ORDER : DRAW_ORDER + 1] for row in actual["draw"]],
            [
                row[:DRAW_OPACITY] + row[DRAW_ORDER : DRAW_ORDER + 1]
                for row in expected["draw"]
            ],
            f"{label}: the draw list differs in which layers draw, in what order, "
            f"or out of whose pixels",
        )
        for row_index, (row, expected_row) in enumerate(
            zip(actual["draw"], expected["draw"])
        ):
            self._compare_floats(
                f"{label}: draw[{row_index}].opacity",
                [row[DRAW_OPACITY]],
                [expected_row[DRAW_OPACITY]],
            )
            self._compare_floats(
                f"{label}: draw[{row_index}].uvRemap",
                row[DRAW_REMAP],
                expected_row[DRAW_REMAP],
            )

    def _compare_floats(
        self, field: str, actual: list[float], expected: list[float]
    ) -> None:
        self.assertEqual(len(actual), len(expected), f"{field}: value count differs")
        for index, (left, right) in enumerate(zip(actual, expected)):
            distance = _ulp_distance(left, right)
            self.assertLessEqual(
                distance,
                KernelConstants.PARITY_ULP_TOLERANCE,
                f"{field}[{index}]: {left} vs golden {right} "
                f"({distance:.0f} float32 ULP, budget "
                f"{KernelConstants.PARITY_ULP_TOLERANCE})",
            )


class CorpusCoverageTests(unittest.TestCase):
    """The corpus must keep exercising every branch it was built to protect.

    A golden comparison over a corpus that has quietly stopped covering the swap
    path is a green test that protects nothing, and nothing else in the build
    would notice. Mirrors the same guard in ``test_kernel_parity``.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.goldens = [
            _load(path) for path in sorted(GOLDEN_DIR.glob("*.json"))
        ]
        cls.cases = [_load(path) for path in sorted(CASE_DIR.glob("*.json"))]

    def _draw_rows(self):
        for golden in self.goldens:
            for frame in golden["frames"]:
                for row in frame["draw"]:
                    yield row

    def _resolved_rows(self):
        for golden in self.goldens:
            for frame in golden["frames"]:
                for row in frame["resolved"]:
                    yield row

    def test_some_case_resolves_a_swap_to_another_part(self) -> None:
        self.assertTrue(
            any(
                row[DRAW_PART_ID] != row[DRAW_TEXTURE_PART_ID]
                for row in self._draw_rows()
            ),
            "no case exercises swapTo, so the pixel-substitution rule is unguarded",
        )

    def test_some_case_produces_a_non_identity_remap_on_both_axes(self) -> None:
        rows = list(self._draw_rows())
        identity = list(RenderConstants.IDENTITY_UV_REMAP)
        self.assertTrue(
            any(row[DRAW_REMAP][0] != identity[0] for row in rows),
            "no case remaps on x",
        )
        self.assertTrue(
            any(row[DRAW_REMAP][1] != identity[1] for row in rows),
            "no case remaps on y",
        )

    def test_some_case_warns_about_an_unresolvable_swap(self) -> None:
        self.assertTrue(
            any(golden["warnings"] for golden in self.goldens),
            "no case reaches the unresolvable-swap branch",
        )

    def test_some_case_drops_a_layer_by_each_cut(self) -> None:
        hidden = any(row[RESOLVED_VISIBLE] is False for row in self._resolved_rows())
        transparent = any(
            row[RESOLVED_OPACITY] <= RenderConstants.MIN_DRAWN_OPACITY
            for row in self._resolved_rows()
        )
        self.assertTrue(hidden, "no case resolves a part hidden")
        self.assertTrue(transparent, "no case resolves a part fully transparent")

    def test_some_case_reorders_the_draw_list_mid_clip(self) -> None:
        reordered = False
        for golden in self.goldens:
            orders = {
                tuple(row[DRAW_PART_ID] for row in frame["draw"])
                for frame in golden["frames"]
            }
            if len(orders) > 1:
                reordered = True
        self.assertTrue(
            reordered,
            "no case changes its draw order over time, so PartPose.zIndex is unguarded",
        )

    def test_some_case_breaks_a_z_index_tie(self) -> None:
        tied = False
        for golden in self.goldens:
            for frame in golden["frames"]:
                seen: set[int] = set()
                for row in frame["draw"]:
                    if row[DRAW_Z_INDEX] in seen:
                        tied = True
                    seen.add(row[DRAW_Z_INDEX])
        self.assertTrue(tied, "no case puts two drawn layers on the same z-index")

    def test_the_corpus_covers_every_easing_and_a_loop(self) -> None:
        eases: set[object] = set()
        looping = False
        for case in self.cases:
            clip = case.get("clip")
            if clip is None:
                continue
            looping = looping or bool(clip.get("loop"))
            for key in clip["keyframes"]:
                eases.add(key.get("ease"))
        # None is in the set on purpose: an absent `ease` must resolve to
        # smoothstep, and a corpus where every key states one would not notice a
        # default flipped to linear.
        self.assertEqual(
            eases,
            {"linear", "hold", None},
            f"the corpus stopped covering an easing: {sorted(map(str, eases))}",
        )
        self.assertTrue(looping, "no case exercises the loop wrap")


class RestValueTests(unittest.TestCase):
    """``Part.visible``/``opacity``/``zIndex`` ARE the rest values. Hand-derived.

    These are the assertions that would have caught the divergence on the day it
    landed, and they are written against the rule the JSON Schema states rather
    than against anything either implementation happens to do.
    """

    def test_no_clip_resolves_the_part_as_authored(self) -> None:
        part = _part("p", visible=True, opacity=0.375, z_index=-3)
        resolved = PartPoseTrack.resolve(part, (), False, 0.5)
        self.assertEqual(resolved.visible, True)
        self.assertEqual(resolved.opacity, 0.375)
        self.assertEqual(resolved.z_index, -3)
        self.assertIsNone(resolved.swap_to)

    def test_a_key_replaces_the_rest_opacity_and_never_scales_it(self) -> None:
        """0.5 authored, 0.5 keyed, resolves 0.5. Multiplying would give 0.25."""
        part = _part("p", opacity=0.5)
        clip = FixtureClip(
            loop=False,
            keyframes=[
                FixtureKeyframe(t=0.0, ease="linear", parts={"p": FixturePartPose(opacity=0.5)}),
                FixtureKeyframe(t=1.0, ease="linear", parts={"p": FixturePartPose(opacity=0.5)}),
            ],
        )
        for time in (0.0, 0.25, 0.5, 1.0):
            with self.subTest(time=time):
                resolved = PartPoseTrack.resolve(part, clip.keyframes, clip.loop, time)
                self.assertAlmostEqual(resolved.opacity, 0.5, places=12)

    def test_a_key_can_drive_a_translucent_part_to_fully_opaque(self) -> None:
        """The property the multiply reading cannot express at all."""
        part = _part("p", opacity=0.25)
        clip = FixtureClip(
            loop=False,
            keyframes=[FixtureKeyframe(t=0.0, ease="hold", parts={"p": FixturePartPose(opacity=1.0)})],
        )
        resolved = PartPoseTrack.resolve(part, clip.keyframes, clip.loop, 0.5)
        self.assertEqual(resolved.opacity, 1.0)

    def test_a_one_sided_key_blends_against_the_part_not_against_one(self) -> None:
        # Authored 0.4, keyed to 1.0 at t=1 only, linear. Halfway is 0.7 by hand:
        # 0.4 + (1.0 - 0.4) * 0.5. Blending against a schema-wide 1 would give a
        # flat 1.0 for the entire clip.
        part = _part("p", opacity=0.4)
        clip = FixtureClip(
            loop=False,
            keyframes=[
                FixtureKeyframe(t=0.0, ease="linear", parts={}),
                FixtureKeyframe(t=1.0, ease="linear", parts={"p": FixturePartPose(opacity=1.0)}),
            ],
        )
        for time, expected in ((0.0, 0.4), (0.5, 0.7), (1.0, 1.0)):
            with self.subTest(time=time):
                resolved = PartPoseTrack.resolve(part, clip.keyframes, clip.loop, time)
                self.assertAlmostEqual(resolved.opacity, expected, places=12)

    def test_visible_and_z_index_fall_back_to_the_part_when_a_key_is_silent(self) -> None:
        part = _part("p", visible=False, z_index=11)
        clip = FixtureClip(
            loop=False,
            keyframes=[
                FixtureKeyframe(t=0.0, ease="linear", parts={"p": FixturePartPose(visible=True, zIndex=2)}),
                FixtureKeyframe(t=0.5, ease="linear", parts={"p": FixturePartPose(opacity=1.0)}),
            ],
        )
        early = PartPoseTrack.resolve(part, clip.keyframes, clip.loop, 0.25)
        late = PartPoseTrack.resolve(part, clip.keyframes, clip.loop, 0.75)
        self.assertEqual((early.visible, early.z_index), (True, 2))
        self.assertEqual(
            (late.visible, late.z_index),
            (False, 11),
            "absent means REST, not 'hold what the previous key left'",
        )

    def test_stepped_channels_take_the_earlier_key_whole(self) -> None:
        """Mid-segment, a stepped channel is still fully on the earlier key."""
        part = _part("p", z_index=0)
        clip = FixtureClip(
            loop=False,
            keyframes=[
                FixtureKeyframe(t=0.0, ease="linear", parts={"p": FixturePartPose(zIndex=0)}),
                FixtureKeyframe(t=1.0, ease="linear", parts={"p": FixturePartPose(zIndex=10)}),
            ],
        )
        for time in (0.01, 0.5, 0.99):
            with self.subTest(time=time):
                self.assertEqual(
                    PartPoseTrack.resolve(part, clip.keyframes, clip.loop, time).z_index,
                    0,
                )


class SharedBracketTests(unittest.TestCase):
    """The compositing channels and the geometry channels use ONE search.

    This is the invariant the resolver used to satisfy by keeping a hand-copied
    duplicate of the search in step with the original. It now satisfies it by
    calling ``PoseTrack.bracket_index``, and this test is what keeps that true.
    """

    def _clip(self) -> FixtureClip:
        return FixtureClip(
            loop=False,
            keyframes=[
                FixtureKeyframe(t=0.0, ease=None, parts={"p": FixturePartPose(opacity=0.0)}),
                FixtureKeyframe(t=1.0, ease=None, parts={"p": FixturePartPose(opacity=1.0)}),
            ],
        )

    def test_opacity_and_a_joint_channel_ease_by_the_same_progress(self) -> None:
        """Smoothstep, so a linear-vs-eased difference is visible everywhere."""
        clip = self._clip()
        part = _part("p", opacity=0.0)
        for time in (0.125, 0.25, 0.4, 0.6, 0.875):
            with self.subTest(time=time):
                expected = PoseTrack.ease(time, None)
                resolved = PartPoseTrack.resolve(part, clip.keyframes, clip.loop, time)
                self.assertAlmostEqual(resolved.opacity, expected, places=12)

    def test_the_render_stage_and_the_kernel_bracket_the_same_wire_clip(self) -> None:
        """The real path: a wire clip through both samplers, compared.

        ``tx`` is resolved by the kernel and ``opacity`` by the compositing
        resolver, from the same wire ``Clip`` at the same instant. Both ramp over
        the same span, so ``tx / 0.4`` must equal ``opacity`` exactly.
        """
        from app.modules.anibuddy.schemas import Clip, ClipSource, Keyframe, PartPose

        clip = Clip(
            id="clip_shared",
            name="shared",
            request="",
            loop=False,
            fps=12,
            frameCount=8,
            source="edited",
            keyframes=[
                Keyframe(t=0.0, ease="ease", joints={}, parts={"p": PartPose(tx=0.0, opacity=0.0)}),
                Keyframe(t=1.0, ease="ease", joints={}, parts={"p": PartPose(tx=0.4, opacity=1.0)}),
            ],
        )
        kernel_clip = RigAdapter.clip_to_kernel(clip)
        part = _part("p", opacity=0.0)

        for time in (0.2, 0.35, 0.5, 0.65, 0.8):
            with self.subTest(time=time):
                geometry = PoseTrack.part_pose_at(kernel_clip, time)
                composite = PartPoseTrack.resolve(
                    part, clip.keyframes, clip.loop, time
                )
                self.assertAlmostEqual(
                    geometry["p"].tx / 0.4, composite.opacity, places=12
                )

    def test_a_looping_clip_wraps_the_compositing_channels_onto_key_zero(self) -> None:
        part = _part("p", opacity=0.5)
        clip = FixtureClip(
            loop=True,
            keyframes=[
                FixtureKeyframe(t=0.0, ease="linear", parts={"p": FixturePartPose(opacity=0.0)}),
                FixtureKeyframe(t=0.5, ease="linear", parts={"p": FixturePartPose(opacity=1.0)}),
            ],
        )
        # Past the last key the span is 0.5 -> 1.5, so t = 0.75 is halfway back
        # to key 0's 0.0. Without the wrap the value would hold at 1.0.
        self.assertAlmostEqual(
            PartPoseTrack.resolve(part, clip.keyframes, clip.loop, 0.75).opacity,
            0.5,
            places=12,
        )


class CompositeOrderTests(unittest.TestCase):
    """Draw order, the two cuts, and what a swap does and does not move."""

    def test_document_order_breaks_a_z_index_tie(self) -> None:
        parts = [_part("second", z_index=1), _part("first", z_index=1)]
        entries = PartPoseTrack.composite_order(parts, None, 0.0, _silent)
        self.assertEqual(
            [entry.part_id for entry in entries],
            ["second", "first"],
            "an id-based tie-break would sort 'first' ahead of 'second'",
        )

    def test_hidden_and_transparent_layers_leave_the_list(self) -> None:
        parts = [
            _part("drawn"),
            _part("hidden", visible=False),
            _part("clear", opacity=0.0),
        ]
        entries = PartPoseTrack.composite_order(parts, None, 0.0, _silent)
        self.assertEqual([entry.part_id for entry in entries], ["drawn"])

    def test_a_swap_keeps_the_referring_parts_geometry_and_z(self) -> None:
        source = _part("mouth", z_index=4, opacity=0.75, rect=(0.125, 0.25, 0.125, 0.2))
        target = _part("open", z_index=9, opacity=0.2, rect=(0.5, 0.5, 0.25, 0.1))
        clip = FixtureClip(
            loop=False,
            keyframes=[FixtureKeyframe(t=0.0, ease="hold", parts={"mouth": FixturePartPose(swapTo="open")})],
        )
        entries = PartPoseTrack.composite_order([source, target], clip, 0.0, _silent)

        swapped = entries[0]
        self.assertEqual(swapped.part_id, "mouth", "geometry stays the referrer's")
        self.assertEqual(swapped.texture_part_id, "open", "pixels come from the target")
        self.assertEqual(swapped.z_index, 4, "draw order stays the referrer's")
        self.assertEqual(swapped.opacity, 0.75, "opacity stays the referrer's")
        # scale 0.25/0.125 = 2 and 0.1/0.2 = 0.5; offsets 0.5 - 0.125*2 and
        # 0.5 - 0.25*0.5. All exact in binary, so this is an equality.
        self.assertEqual(swapped.uv_remap, (2.0, 0.5, 0.25, 0.375))
        self.assertEqual(
            entries[1].part_id, "open", "the target is still drawn as itself"
        )

    def test_an_unresolvable_swap_warns_and_draws_the_part_as_itself(self) -> None:
        warnings: list[str] = []
        parts = [_part("p")]
        clip = FixtureClip(
            loop=False,
            keyframes=[FixtureKeyframe(t=0.0, ease="hold", parts={"p": FixturePartPose(swapTo="ghost")})],
        )
        entries = PartPoseTrack.composite_order(parts, clip, 0.0, warnings.append)

        self.assertEqual(entries[0].texture_part_id, "p")
        self.assertEqual(entries[0].uv_remap, RenderConstants.IDENTITY_UV_REMAP)
        self.assertEqual(
            warnings,
            [
                RenderConstants.UNRESOLVED_SWAP_WARNING.format(
                    part_id="p", swap_to="ghost"
                )
            ],
        )

    def test_a_zero_sized_source_rect_falls_back_to_unit_scale(self) -> None:
        flat = _part("flat", rect=(0.25, 0.25, 0.0, 0.5))
        target = _part("solid", rect=(0.5, 0.0, 0.25, 0.25))
        remap = PartPoseTrack.uv_remap(flat, target)
        self.assertEqual(remap[0], RenderConstants.IDENTITY_UV_REMAP[0])
        self.assertEqual(remap[1], 0.5)


if __name__ == "__main__":
    unittest.main()
