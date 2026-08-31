"""Unit tests for the AniBuddy vision-facing stage support.

Three things are under test and they fail for different reasons, so they are
grouped that way:

1. **The annotated sheet** — that outlines land on the parts they name, that the
   legend binds a number to an id, and that a mismatched sheet is refused rather
   than annotated in the wrong place.
2. **The contact sheet** — that frames the render stage really produced are
   tiled in reading order with the clip times printed on them, and that frame
   selection spreads across the clip instead of taking the first N.
3. **The corrections applier** — the §11.4 revalidation ladder. These are the
   tests that matter most, because every one of them is a way a model response
   could quietly produce a rig that looks plausible and animates wrongly.

The rigs here are built by hand rather than run through decompose and rig, so a
failure is attributable to this module.
"""

from __future__ import annotations

import hashlib
import io
import unittest
import zipfile
from typing import List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

from app.modules.anibuddy.constants import VisionConstants
from app.modules.anibuddy.schemas import (
    AssetRef,
    Clip,
    Correction,
    CritiqueReport,
    DeformerRigid,
    Diagnostics,
    DocumentProvenance,
    GenerationSeam,
    Joint,
    JointPose,
    Keyframe,
    MaskAlphaThreshold,
    MaskRect,
    Part,
    PartPose,
    Rect,
    RevisionLink,
    RigDocument,
    Skeleton,
    Slot,
    Vec2,
)
from app.modules.anibuddy.vision import (
    ContactSheet,
    CritiqueCorrections,
    VisionError,
    VisionService,
    clamp_or_reject,
    frames_from_png_zip,
    pick_frame_indices,
)

SHEET = 64
PROJECT = "proj_vision_test"


# --- Fixture construction --------------------------------------------------


def _sheet_rgba(
    blocks: Sequence[Tuple[Tuple[int, int, int, int], Tuple[int, int, int, int]]],
    size: int = SHEET,
) -> np.ndarray:
    sheet = np.zeros((size, size, 4), dtype=np.uint8)
    for (x0, y0, x1, y1), colour in blocks:
        sheet[y0:y1, x0:x1] = colour
    return sheet


def _png_bytes(rgba: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


def _asset(raw: bytes, *, consented: bool = True, size: int = SHEET) -> AssetRef:
    return AssetRef(
        id="asset_vision_test",
        name="vision-test.png",
        storageKey="anibuddy/test/vision-test.png",
        contentHash=hashlib.sha256(raw).hexdigest(),
        width=size,
        height=size,
        figureHeight=None,
        mimeType="image/png",
        rightsConfirmed=True,
        remoteVisionConsented=consented,
    )


def _part(
    part_id: str,
    rect: Tuple[float, float, float, float],
    *,
    z_index: int = 0,
    pivot: Tuple[float, float] = (0.5, 0.5),
    parent: Optional[str] = None,
    attach_slot: Optional[str] = None,
    slots: Optional[List[Slot]] = None,
    alpha_mask: bool = False,
    visible: bool = True,
    confidence: float = 0.9,
) -> Part:
    return Part(
        id=part_id,
        name=part_id.replace("_", " ").title(),
        role="torso",
        mask=(
            MaskAlphaThreshold(kind="alpha-threshold", threshold=24)
            if alpha_mask
            else MaskRect(kind="rect")
        ),
        rect=Rect(x=rect[0], y=rect[1], width=rect[2], height=rect[3]),
        pivot=Vec2(x=pivot[0], y=pivot[1]),
        zIndex=z_index,
        parentPartId=parent,
        attachSlot=attach_slot,
        slots=slots or [],
        deformer=DeformerRigid(kind="rigid"),
        boundJointId="j_root",
        visible=visible,
        opacity=1.0,
        confidence=confidence,
        provenance="manual",
    )


def _joint(
    joint_id: str, x: float, y: float, parent: Optional[str] = None
) -> Joint:
    return Joint(
        id=joint_id,
        name=joint_id,
        role="root" if parent is None else "spine",
        x=x,
        y=y,
        parent=parent,
        partId=None,
        ikChainLength=None,
        confidence=0.9,
    )


def _clip(
    clip_id: str = "clip_a",
    keyframes: Optional[List[Keyframe]] = None,
    *,
    frame_count: int = 12,
) -> Clip:
    return Clip(
        id=clip_id,
        name="Test motion",
        request="test",
        loop=True,
        fps=12,
        frameCount=frame_count,
        keyframes=keyframes
        or [
            Keyframe(t=0.0, ease="ease", joints={}, parts={}),
            Keyframe(
                t=0.5, ease="ease", joints={"j_spine": JointPose(rot=40.0)}, parts={}
            ),
            Keyframe(t=1.0, ease="ease", joints={}, parts={}),
        ],
        source="model",
    )


def _document(
    asset: AssetRef,
    parts: List[Part],
    joints: Optional[List[Joint]] = None,
    clips: Optional[List[Clip]] = None,
    *,
    blocking_reason: Optional[str] = None,
    max_stretch: float = 1.0,
    flipped: int = 0,
) -> RigDocument:
    return RigDocument(
        schemaVersion=5,
        id="rev_vision_0",
        projectId=PROJECT,
        createdAt="2026-08-14T00:00:00Z",
        updatedAt="2026-08-14T00:00:00Z",
        revision=RevisionLink(
            index=0, parentRevisionId=None, reason="test", accepted=True
        ),
        archetype="humanoid",
        asset=asset,
        parts=parts,
        skeleton=Skeleton(joints=joints or []),
        clips=clips or [],
        generation=GenerationSeam(
            mode="external-prompt-only", prompt=None, transcript=[], producedBy=None
        ),
        provenance=DocumentProvenance(
            pipelineVersion="test/1", kernelVersion="test/1", stages=[]
        ),
        diagnostics=Diagnostics(
            foregroundPixels=0,
            coveredForegroundPixels=0,
            overlappingPartPairs=[],
            maxStretch=max_stretch,
            flippedTriangles=flipped,
            isolatedVertices=0,
            warnings=[],
            blockingReason=blocking_reason,
        ),
    )


def _correction(
    kind: str,
    target: Optional[str],
    *,
    reason: str = "Because the frames show it.",
    vec2: Optional[Vec2] = None,
    scalar: Optional[float] = None,
    int_value: Optional[int] = None,
    deformer_kind: Optional[str] = None,
    string_value: Optional[str] = None,
) -> Correction:
    return Correction(
        kind=kind,  # type: ignore[arg-type]
        targetId=target,
        reason=reason,
        vec2=vec2,
        scalar=scalar,
        intValue=int_value,
        deformerKind=deformer_kind,  # type: ignore[arg-type]
        stringValue=string_value,
    )


def _report(
    corrections: List[Correction], *, verdict: str = "revise", pass_index: int = 0
) -> CritiqueReport:
    return CritiqueReport(
        verdict=verdict,  # type: ignore[arg-type]
        passIndex=pass_index,
        observations=["The hip rotates about the wrong point."],
        corrections=corrections,
    )


def _two_part_document(**kwargs) -> Tuple[RigDocument, bytes]:
    """A humanoid-ish two-part sheet with a real clip, ready to render."""
    sheet = _sheet_rgba(
        [
            ((8, 8, 40, 40), (200, 40, 40, 255)),
            ((40, 24, 56, 56), (40, 80, 200, 255)),
        ]
    )
    raw = _png_bytes(sheet)
    document = _document(
        _asset(raw, **kwargs),
        [
            _part("torso", (8 / SHEET, 8 / SHEET, 32 / SHEET, 32 / SHEET), z_index=0),
            _part(
                "arm",
                (40 / SHEET, 24 / SHEET, 16 / SHEET, 32 / SHEET),
                z_index=1,
                pivot=(0.1, 0.1),
            ),
        ],
        [_joint("j_root", 0.5, 0.5), _joint("j_spine", 0.5, 0.3, "j_root")],
        [_clip()],
    )
    return document, raw


# --- The clamp-or-reject band ----------------------------------------------


class ClampBandTests(unittest.TestCase):
    """§11.4 step 3: clamp a rounding artifact, refuse a unit misunderstanding."""

    def test_in_range_passes_untouched(self) -> None:
        value, clamped = clamp_or_reject(0.5, 0.0, 1.0, label="x")
        self.assertEqual(value, 0.5)
        self.assertFalse(clamped)

    def test_small_overrun_is_clamped_and_flagged(self) -> None:
        # 5% past a unit bound: a rounding artifact, so clamped rather than
        # refused — and reported, because a silent clamp is a lie by omission.
        value, clamped = clamp_or_reject(1.05, 0.0, 1.0, label="x")
        self.assertEqual(value, 1.0)
        self.assertTrue(clamped)

    def test_large_overrun_rejects_the_whole_response(self) -> None:
        with self.assertRaises(VisionError):
            clamp_or_reject(1.5, 0.0, 1.0, label="x")

    def test_band_scales_with_the_bound_span(self) -> None:
        # The band is a fraction of the SPAN, not an absolute epsilon, so the
        # same rule reads sensibly on a tiny bound and on a wide one.
        span = VisionConstants.MAX_PIVOT_NUDGE
        just_inside = span * (1.0 + VisionConstants.CLAMP_TOLERANCE * 0.9)
        just_outside = span * (1.0 + VisionConstants.CLAMP_TOLERANCE * 1.2)
        value, clamped = clamp_or_reject(just_inside, 0.0, span, label="nudge")
        self.assertAlmostEqual(value, span)
        self.assertTrue(clamped)
        with self.assertRaises(VisionError):
            clamp_or_reject(just_outside, 0.0, span, label="nudge")

    def test_nan_is_refused_rather_than_comparing_false(self) -> None:
        with self.assertRaises(VisionError):
            clamp_or_reject(float("nan"), 0.0, 1.0, label="x")


# --- The annotated sheet ---------------------------------------------------


class AnnotateTests(unittest.TestCase):
    def test_legend_binds_every_part_to_a_number(self) -> None:
        document, raw = _two_part_document()
        annotated = VisionService.annotate(document, raw)

        self.assertEqual(
            [outline.part_id for outline in annotated.outlines], ["torso", "arm"]
        )
        self.assertEqual(
            [outline.label for outline in annotated.outlines],
            [
                VisionConstants.ANNOTATION_FIRST_LABEL,
                VisionConstants.ANNOTATION_FIRST_LABEL + 1,
            ],
        )

    def test_outline_is_drawn_over_the_part_it_names(self) -> None:
        document, raw = _two_part_document()
        annotated = VisionService.annotate(document, raw)
        decoded = np.asarray(Image.open(io.BytesIO(annotated.png)).convert("RGB"))

        # The outline colour is deliberately outside the palette of the artwork,
        # so its presence is a positive signal rather than a coincidence.
        outline = np.array(VisionConstants.ANNOTATION_OUTLINE_RGB, dtype=np.int16)
        distance = np.abs(decoded.astype(np.int16) - outline).sum(axis=2)
        self.assertGreater(int((distance < 60).sum()), 0)

    def test_transparent_background_is_matted_not_left_undefined(self) -> None:
        document, raw = _two_part_document()
        annotated = VisionService.annotate(document, raw)
        decoded = np.asarray(Image.open(io.BytesIO(annotated.png)).convert("RGB"))
        # A corner the artwork never covers must be the declared matte, not
        # whatever a remote decoder would have filled alpha with.
        self.assertEqual(
            tuple(int(channel) for channel in decoded[-1, -1]),
            VisionConstants.ANNOTATION_MATTE_RGB,
        )

    def test_downscales_to_the_token_budget_without_upscaling(self) -> None:
        document, raw = _two_part_document()
        small = VisionService.annotate(document, raw, max_edge=32)
        self.assertEqual(max(small.width, small.height), 32)
        # A 64px sheet is never enlarged: interpolation artifacts are not detail.
        large = VisionService.annotate(document, raw, max_edge=2048)
        self.assertEqual(max(large.width, large.height), SHEET)

    def test_mismatched_sheet_is_refused_not_rescaled(self) -> None:
        document, _ = _two_part_document()
        wrong = _png_bytes(_sheet_rgba([((0, 0, 8, 8), (255, 255, 255, 255))], size=32))
        with self.assertRaises(VisionError):
            VisionService.annotate(document, wrong)

    def test_partless_document_is_refused_before_a_credit_is_spent(self) -> None:
        raw = _png_bytes(_sheet_rgba([((0, 0, 8, 8), (255, 255, 255, 255))]))
        document = _document(_asset(raw), [])
        with self.assertRaises(VisionError):
            VisionService.annotate(document, raw)

    def test_missing_consent_blocks_the_vision_stages(self) -> None:
        document, raw = _two_part_document(consented=False)
        with self.assertRaises(VisionError) as caught:
            VisionService.annotate(document, raw)
        self.assertIn("remote vision", str(caught.exception))

    def test_low_confidence_parts_are_warned_about(self) -> None:
        raw = _png_bytes(_sheet_rgba([((8, 8, 40, 40), (200, 40, 40, 255))]))
        document = _document(
            _asset(raw),
            [
                _part(
                    "torso",
                    (8 / SHEET, 8 / SHEET, 32 / SHEET, 32 / SHEET),
                    confidence=VisionConstants.CONFIDENCE_REVIEW_FLOOR - 0.1,
                )
            ],
        )
        annotated = VisionService.annotate(document, raw)
        self.assertTrue(any("low" in warning for warning in annotated.warnings))


# --- The contact sheet -----------------------------------------------------


class ContactSheetTests(unittest.TestCase):
    def test_frame_selection_spreads_across_the_clip(self) -> None:
        # The first nine frames of a 120-frame walk are one ninth of a step, and
        # a critique of that says nothing about the cycle. Endpoints included so
        # the model sees the loop seam.
        indices = pick_frame_indices(120, 9)
        self.assertEqual(indices[0], 0)
        self.assertEqual(indices[-1], 119)
        self.assertEqual(len(indices), 9)
        self.assertEqual(list(indices), sorted(indices))

    def test_short_clip_repeats_rather_than_ragged_grid(self) -> None:
        indices = pick_frame_indices(2, 9)
        self.assertEqual(len(indices), 9)
        self.assertEqual(set(indices), {0, 1})

    def test_no_frames_is_refused(self) -> None:
        with self.assertRaises(VisionError):
            pick_frame_indices(0, 9)

    def test_grid_geometry_matches_the_declared_layout(self) -> None:
        frames = [
            np.full((20, 20, 3), fill, dtype=np.uint8) for fill in range(0, 90, 10)
        ]
        times = [index / 8.0 for index in range(9)]
        png, width, height, columns, rows = ContactSheet.compose(
            frames, times, tile_max_edge=20
        )
        self.assertEqual(columns, VisionConstants.CONTACT_SHEET_COLUMNS)
        self.assertEqual(rows, 3)
        gutter = VisionConstants.CONTACT_SHEET_GUTTER_PX
        margin = VisionConstants.CONTACT_SHEET_MARGIN_PX
        self.assertEqual(width, margin * 2 + 3 * 20 + 2 * gutter)
        self.assertEqual(height, margin * 2 + 3 * 20 + 2 * gutter)
        self.assertEqual(
            np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).shape,
            (height, width, 3),
        )

    def test_gutters_separate_adjacent_tiles(self) -> None:
        # Without a gutter a limb leaving frame N reads as continuing into frame
        # N+1, and the model critiques a motion nobody rendered.
        frames = [np.full((20, 20, 3), 255, dtype=np.uint8) for _ in range(9)]
        png, _, _, _, _ = ContactSheet.compose(
            frames, [0.0] * 9, tile_max_edge=20
        )
        decoded = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
        margin = VisionConstants.CONTACT_SHEET_MARGIN_PX
        gutter_column = margin + 20 + VisionConstants.CONTACT_SHEET_GUTTER_PX // 2
        self.assertEqual(
            tuple(int(channel) for channel in decoded[margin + 10, gutter_column]),
            VisionConstants.CONTACT_SHEET_SHEET_RGB,
        )

    def test_time_labels_must_match_the_frame_count(self) -> None:
        frames = [np.zeros((8, 8, 3), dtype=np.uint8) for _ in range(4)]
        with self.assertRaises(VisionError):
            ContactSheet.compose(frames, [0.0, 1.0], tile_max_edge=8)

    def test_frames_decode_from_the_render_artifact_in_order(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for index in range(3):
                png = io.BytesIO()
                Image.fromarray(
                    np.full((4, 4, 4), (index * 40, 0, 0, 255), dtype=np.uint8),
                    mode="RGBA",
                ).save(png, format="PNG")
                archive.writestr(f"frame-{index:04d}.png", png.getvalue())
            archive.writestr("README.txt", b"non-generative")
        frames = frames_from_png_zip(buffer.getvalue())
        self.assertEqual(len(frames), 3)
        self.assertEqual([int(frame[0, 0, 0]) for frame in frames], [0, 40, 80])

    def test_unreadable_artifact_is_refused(self) -> None:
        with self.assertRaises(VisionError):
            frames_from_png_zip(b"not a zip")

    def test_end_to_end_contact_sheet_carries_measured_diagnostics(self) -> None:
        document, raw = _two_part_document()
        result = VisionService.contact_sheet(
            document,
            raw,
            project_id=PROJECT,
            revision_id="rev_vision_render",
            clip_id="clip_a",
            frames=VisionConstants.CONTACT_SHEET_FRAMES,
        )
        self.assertEqual(result.frame_count, VisionConstants.CONTACT_SHEET_FRAMES)
        self.assertEqual(result.columns, VisionConstants.CONTACT_SHEET_COLUMNS)
        self.assertEqual(len(result.frame_times), result.frame_count)
        self.assertAlmostEqual(result.frame_times[0], 0.0)
        self.assertAlmostEqual(result.frame_times[-1], 1.0)
        # The returned document is the RENDER stage's child revision, and its
        # diagnostics were measured on these exact frames. That is what makes
        # "best revision" a measurement rather than a guess (§11.6).
        self.assertEqual(result.document.revision.parentRevisionId, document.id)
        self.assertGreaterEqual(result.max_stretch, 1.0)
        self.assertTrue(
            result.png.startswith(b"\x89PNG"), "the contact sheet must be a PNG"
        )

    def test_blocked_document_is_refused_before_a_frame_is_spent(self) -> None:
        sheet = _sheet_rgba([((8, 8, 40, 40), (200, 40, 40, 255))])
        raw = _png_bytes(sheet)
        document = _document(
            _asset(raw),
            [_part("torso", (8 / SHEET, 8 / SHEET, 32 / SHEET, 32 / SHEET))],
            blocking_reason="Weight rows do not sum to one.",
        )
        with self.assertRaises(VisionError) as caught:
            VisionService.contact_sheet(
                document, raw, project_id=PROJECT, revision_id="rev_blocked"
            )
        self.assertIn("Weight rows", str(caught.exception))


# --- The corrections applier ----------------------------------------------


class CorrectionApplyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.document, self.raw = _two_part_document()

    def _apply(self, corrections: List[Correction], **kwargs):
        return CritiqueCorrections.apply(
            self.document,
            _report(corrections),
            revision_id="rev_vision_1",
            **kwargs,
        )

    def test_pivot_nudge_moves_the_pivot_and_writes_a_child_revision(self) -> None:
        outcome = self._apply(
            [_correction("pivot-nudge", "torso", vec2=Vec2(x=0.0, y=0.04))]
        )
        torso = next(part for part in outcome.document.parts if part.id == "torso")
        self.assertAlmostEqual(torso.pivot.y, 0.54, places=5)
        self.assertEqual(outcome.document.revision.parentRevisionId, self.document.id)
        self.assertEqual(outcome.document.revision.reason, VisionConstants.REVISION_REASON)
        # A critique revision is a PROPOSAL: the loop signing off its own work is
        # not the user signing off (§7.2).
        self.assertFalse(outcome.document.revision.accepted)

    def test_the_source_document_is_never_mutated(self) -> None:
        before = self.document.parts[0].pivot.y
        self._apply([_correction("pivot-nudge", "torso", vec2=Vec2(x=0.0, y=0.04))])
        self.assertEqual(self.document.parts[0].pivot.y, before)

    def test_diagonal_nudge_is_scaled_to_the_cap_not_refused(self) -> None:
        # (cap, cap) is a legitimate reading of a per-component instruction, but
        # it travels 1.41x the cap in length. Scaled to the bound with the
        # direction preserved, rather than refunding a pass over a defensible
        # reading of an ambiguous field.
        cap = VisionConstants.MAX_PIVOT_NUDGE
        outcome = self._apply(
            [_correction("pivot-nudge", "torso", vec2=Vec2(x=cap, y=cap))]
        )
        torso = next(part for part in outcome.document.parts if part.id == "torso")
        travelled = (
            (torso.pivot.x - 0.5) ** 2 + (torso.pivot.y - 0.5) ** 2
        ) ** 0.5
        self.assertAlmostEqual(travelled, cap, places=5)
        # Direction preserved: an equal-axis request stays on the diagonal.
        self.assertAlmostEqual(torso.pivot.x - 0.5, torso.pivot.y - 0.5, places=6)
        self.assertTrue(outcome.applied[0].clamped)

    def test_per_axis_overrun_inside_the_band_is_clamped(self) -> None:
        cap = VisionConstants.MAX_PIVOT_NUDGE
        inside = cap * (1.0 + VisionConstants.CLAMP_TOLERANCE)
        outcome = self._apply(
            [_correction("pivot-nudge", "torso", vec2=Vec2(x=0.0, y=inside))]
        )
        torso = next(part for part in outcome.document.parts if part.id == "torso")
        self.assertAlmostEqual(torso.pivot.y - 0.5, cap, places=6)
        self.assertTrue(outcome.applied[0].clamped)

    def test_wildly_oversized_pivot_nudge_rejects_the_whole_report(self) -> None:
        with self.assertRaises(VisionError):
            self._apply(
                [
                    _correction("pivot-nudge", "torso", vec2=Vec2(x=0.0, y=0.9)),
                    _correction("z-order", "arm", int_value=5),
                ]
            )

    def test_pivot_stays_inside_its_own_part(self) -> None:
        document, raw = _two_part_document()
        document.parts[0].pivot = Vec2(x=0.5, y=0.98)
        outcome = CritiqueCorrections.apply(
            document,
            _report([_correction("pivot-nudge", "torso", vec2=Vec2(x=0.0, y=0.06))]),
            revision_id="rev_pivot_clamp",
        )
        torso = next(part for part in outcome.document.parts if part.id == "torso")
        self.assertLessEqual(torso.pivot.y, VisionConstants.PIVOT_MAX)

    def test_unknown_id_rejects_the_whole_report(self) -> None:
        # An unknown id means the model is working from a stale revision, so
        # every other correction in the same response is suspect (§11.4 step 2).
        with self.assertRaises(VisionError) as caught:
            self._apply(
                [
                    _correction("z-order", "arm", int_value=3),
                    _correction("pivot-nudge", "ghost", vec2=Vec2(x=0.0, y=0.01)),
                ]
            )
        self.assertIn("ghost", str(caught.exception))

    def test_rotation_damp_scales_only_rotation_channels(self) -> None:
        outcome = self._apply([_correction("rotation-damp", "j_spine", scalar=0.5)])
        clip = outcome.document.clips[0]
        pose = clip.keyframes[1].joints["j_spine"]
        self.assertAlmostEqual(pose.rot or 0.0, 20.0)

    def test_rotation_damp_below_the_floor_is_clamped_then_refused(self) -> None:
        floor = VisionConstants.MIN_ROTATION_DAMP
        outcome = self._apply(
            [_correction("rotation-damp", "j_spine", scalar=floor - 0.05)]
        )
        self.assertTrue(outcome.applied[0].clamped)
        clip = outcome.document.clips[0]
        self.assertAlmostEqual(clip.keyframes[1].joints["j_spine"].rot or 0.0, 40.0 * floor)
        with self.assertRaises(VisionError):
            self._apply([_correction("rotation-damp", "j_spine", scalar=0.0)])

    def test_rotation_damp_on_an_unanimated_target_is_reported_not_faked(self) -> None:
        outcome = self._apply([_correction("rotation-damp", "j_root", scalar=0.5)])
        self.assertIn("nothing to scale", outcome.applied[0].effect)

    def test_z_order_records_the_move(self) -> None:
        outcome = self._apply([_correction("z-order", "arm", int_value=-4)])
        arm = next(part for part in outcome.document.parts if part.id == "arm")
        self.assertEqual(arm.zIndex, -4)
        self.assertIn("1 to -4", outcome.applied[0].effect)

    def test_deformer_swap_is_queued_never_applied(self) -> None:
        # R3: building a mesh from a critique response would put the model one
        # field away from authoring vertices.
        outcome = self._apply([_correction("deformer-swap", "torso", deformer_kind="mesh")])
        torso = next(part for part in outcome.document.parts if part.id == "torso")
        self.assertEqual(torso.deformer.kind, "rigid")
        self.assertEqual(outcome.deformer_overrides, {"torso": "mesh"})
        self.assertTrue(outcome.requires_rerig)

    def test_parent_change_clears_a_slot_it_cannot_honour(self) -> None:
        document, raw = _two_part_document()
        document.parts[0].slots = [Slot(name="hand", position=Vec2(x=0.5, y=0.9))]
        document.parts[1].parentPartId = "torso"
        document.parts[1].attachSlot = "hand"
        document.parts.append(
            _part("shield", (0.0, 0.0, 0.2, 0.2), slots=[Slot(name="grip", position=Vec2(x=0.5, y=0.5))])
        )
        outcome = CritiqueCorrections.apply(
            document,
            _report([_correction("parent-change", "arm", string_value="shield")]),
            revision_id="rev_parent",
        )
        arm = next(part for part in outcome.document.parts if part.id == "arm")
        self.assertEqual(arm.parentPartId, "shield")
        # The old slot named a slot on the OLD parent. Cleared rather than
        # remapped: guessing which slot was meant is the repair R7 forbids.
        self.assertIsNone(arm.attachSlot)

    def test_two_reparents_that_close_a_cycle_together_are_refused(self) -> None:
        # Each edit validates alone. Only the end-of-pass structural re-run
        # catches the pair (§11.4 step 4).
        with self.assertRaises(VisionError) as caught:
            self._apply(
                [
                    _correction("parent-change", "arm", string_value="torso"),
                    _correction("parent-change", "torso", string_value="arm"),
                ]
            )
        self.assertIn("cycle", str(caught.exception))

    def test_reparenting_the_root_joint_is_refused(self) -> None:
        with self.assertRaises(VisionError) as caught:
            self._apply([_correction("parent-change", "j_root", string_value="j_spine")])
        self.assertIn("rootless", str(caught.exception))

    def test_keyframe_retime_is_monotone_and_keeps_the_endpoints(self) -> None:
        outcome = self._apply([_correction("keyframe-retime", "clip_a", scalar=0.75)])
        times = [key.t for key in outcome.document.clips[0].keyframes]
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], 1.0)
        self.assertAlmostEqual(times[1], 0.75)
        self.assertEqual(times, sorted(times))

    def test_keyframe_retime_onto_an_endpoint_is_clamped_off_it(self) -> None:
        # A warp onto t=0 collapses half the clip into one instant, which is not
        # a retime; it is a deletion.
        outcome = self._apply([_correction("keyframe-retime", "clip_a", scalar=0.0)])
        times = [key.t for key in outcome.document.clips[0].keyframes]
        self.assertEqual(times, sorted(times))
        self.assertGreaterEqual(times[1], VisionConstants.MIN_RETIME_PEAK)
        self.assertTrue(outcome.applied[0].clamped)

    def test_part_visibility_toggles_and_rejects_an_unknown_word(self) -> None:
        outcome = self._apply(
            [_correction("part-visibility", "arm", string_value="hide")]
        )
        arm = next(part for part in outcome.document.parts if part.id == "arm")
        self.assertFalse(arm.visible)
        with self.assertRaises(VisionError):
            self._apply([_correction("part-visibility", "arm", string_value="maybe")])

    def test_abort_is_recorded_without_editing_anything(self) -> None:
        outcome = self._apply([_correction("abort", None, reason="The rig is unusable.")])
        self.assertEqual(outcome.applied[0].kind, "abort")
        self.assertEqual(
            [part.zIndex for part in outcome.document.parts],
            [part.zIndex for part in self.document.parts],
        )
        self.assertTrue(
            any("aborted" in warning for warning in outcome.document.diagnostics.warnings)
        )

    def test_over_cap_correction_count_is_refused_twice(self) -> None:
        many = [
            _correction("z-order", "arm", int_value=index)
            for index in range(VisionConstants.MAX_CORRECTIONS_PER_PASS + 1)
        ]
        # The generated schema is the first gate.
        with self.assertRaises(Exception):
            _report(many)
        # And the applier holds the same line on a report that reached it
        # without passing through validation, which is what makes the cap a
        # property of the pipeline rather than of one boundary.
        unvalidated = CritiqueReport.model_construct(
            verdict="revise", passIndex=0, observations=[], corrections=many
        )
        with self.assertRaises(VisionError):
            CritiqueCorrections.apply(
                self.document, unvalidated, revision_id="rev_over_cap"
            )

    def test_stage_record_names_the_served_model_and_the_pass(self) -> None:
        outcome = self._apply(
            [_correction("z-order", "arm", int_value=2)],
            pass_index=2,
            model_id="google/gemini-2.5-flash",
            usage_event_id="a" * 24,
            credits_spent=3,
        )
        stage = outcome.document.provenance.stages[-1]
        self.assertEqual(stage.stage, "critique")
        self.assertEqual(stage.passIndex, 2)
        self.assertEqual(stage.modelId, "google/gemini-2.5-flash")
        self.assertEqual(stage.usageEventId, "a" * 24)
        self.assertEqual(stage.creditsSpent, 3)

    def test_diagnostics_are_carried_not_invented(self) -> None:
        # maxStretch is a measurement of a render. This revision has not been
        # rendered, and authoring a 1.0 here would be a clean bill of health for
        # frames nobody has drawn.
        document, _ = _two_part_document()
        document.diagnostics.maxStretch = 3.4
        document.diagnostics.flippedTriangles = 7
        outcome = CritiqueCorrections.apply(
            document,
            _report([_correction("z-order", "arm", int_value=9)]),
            revision_id="rev_diag",
        )
        self.assertEqual(outcome.document.diagnostics.maxStretch, 3.4)
        self.assertEqual(outcome.document.diagnostics.flippedTriangles, 7)

    def test_empty_correction_list_still_produces_a_revision(self) -> None:
        outcome = self._apply([])
        self.assertEqual(outcome.applied, ())
        self.assertIn("no corrections", outcome.document.provenance.stages[-1].message or "")

    def test_swap_to_an_unknown_part_is_caught_by_revalidation(self) -> None:
        document, _ = _two_part_document()
        document.clips[0].keyframes[1].parts = {"arm": PartPose(swapTo="ghost")}
        with self.assertRaises(VisionError):
            CritiqueCorrections.apply(
                document,
                _report([_correction("z-order", "arm", int_value=1)]),
                revision_id="rev_swap",
            )


# --- The HTTP surface the gateway's critique worker posts to ----------------


class VisionEndpointTests(unittest.TestCase):
    """The two multipart vision endpoints, over the parts the gateway really sends.

    The service layer above is tested directly; what these cover is the wire
    contract, and it changed twice when the critique loop moved out of a Next route
    handler and into the gateway's BullMQ worker:

    * ``request`` is a multipart FILE part rather than a form field, because
      Starlette caps a non-file part at 1 MB and a 64-part document exceeds that on
      its own.
    * ``/critique/contact-sheet`` accepts ``buffers``. Tiling nine frames IS a
      render — it evaluates every deformer — so a mesh rig whose weight matrices
      left as ``StorageAdapter`` keys needs the caller to bring the bytes. The old
      caller could not: it was a browser-adjacent route with no storage credentials.
    """

    def _client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from app.modules.anibuddy.router import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def _envelope(self, body: dict) -> tuple:
        import json as json_module

        return (
            "request.json",
            json_module.dumps(body).encode("utf-8"),
            "application/json",
        )

    def _contact_sheet_body(self, document: RigDocument) -> dict:
        import json as json_module

        return {
            "document": json_module.loads(document.model_dump_json()),
            "projectId": PROJECT,
            "revisionId": "rev_sheet_http",
            "parentRevisionId": document.id,
            "revisionIndex": 1,
            "passIndex": 1,
            "clipId": document.clips[0].id if document.clips else None,
            "frames": 4,
        }

    def _with_external_cut(self, document: RigDocument) -> Tuple[RigDocument, bytes, str]:
        """The same document, but with one part's cut line living out of band."""
        import struct

        from app.modules.anibuddy.schemas import (
            CutLine,
            DeformerMesh,
            NumericBuffer,
        )

        values = [0.2, 0.2, 0.8, 0.8]
        raw = b"".join(struct.pack("<f", value) for value in values)
        sha256 = hashlib.sha256(raw).hexdigest()
        verts = [0.0, 0.0, 1.0, 0.0, 0.5, 1.0]

        def inline(numbers: Sequence[float], dtype: str) -> NumericBuffer:
            payload = b"".join(
                struct.pack("<f" if dtype == "f32" else "<I", value) for value in numbers
            )
            return NumericBuffer(
                dtype=dtype,  # type: ignore[arg-type]
                storage="inline",
                length=len(numbers),
                sha256=hashlib.sha256(payload).hexdigest(),
                values=list(numbers),
                storageKey=None,
            )

        document.parts[0].deformer = DeformerMesh(
            kind="mesh",
            verts=inline(verts, "f32"),
            tris=inline([0, 1, 2], "u32"),
            boneIds=["j_root->j_spine"],
            weights=inline([1.0, 1.0, 1.0], "f32"),
            cuts=[
                CutLine(
                    id="cut1",
                    points=NumericBuffer(
                        dtype="f32",
                        storage="external",
                        length=len(values),
                        sha256=sha256,
                        values=None,
                        storageKey=f"anibuddy/{PROJECT}/buffers/{sha256}.bin",
                    ),
                )
            ],
        )
        return document, raw, sha256

    def test_the_contact_sheet_endpoint_tiles_really_rendered_frames(self) -> None:
        document, raw = _two_part_document()
        response = self._client().post(
            "/anibuddy/critique/contact-sheet",
            files={
                "request": self._envelope(self._contact_sheet_body(document)),
                "image": ("sheet.png", raw, "image/png"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["imageDataUrl"].startswith("data:image/"))
        self.assertGreaterEqual(payload["frameCount"], 1)
        self.assertEqual(payload["columns"] * payload["rows"] >= payload["frameCount"], True)
        # The render stage's child revision, and the caller must keep it: its
        # diagnostics were measured on exactly these frames, which is what makes the
        # loop's "best revision" a measurement rather than a guess (§11.6).
        self.assertEqual(payload["document"]["revision"]["parentRevisionId"], document.id)
        RigDocument.model_validate(payload["document"])

    def test_the_annotate_endpoint_takes_its_envelope_as_a_file_part(self) -> None:
        import json as json_module

        document, raw = _two_part_document()
        response = self._client().post(
            "/anibuddy/semantics/annotate",
            files={
                "request": self._envelope(
                    {"document": json_module.loads(document.model_dump_json()), "maxEdge": None}
                ),
                "image": ("sheet.png", raw, "image/png"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["imageDataUrl"].startswith("data:image/"))
        # The legend is the reply protocol: the model answers with a partId, and an id
        # absent from this list rejects the whole proposal.
        self.assertEqual(
            sorted(entry["partId"] for entry in payload["legend"]), ["arm", "torso"]
        )

    def test_a_contact_sheet_over_external_geometry_refuses_without_the_bytes(self) -> None:
        # The regression this endpoint's `buffers` field exists to fix. Without it the
        # sidecar has nothing to rehydrate, and the refusal names the buffer and the
        # field to send it in rather than rendering an arm that is not there.
        document, raw = _two_part_document()
        document, _bytes, sha256 = self._with_external_cut(document)
        response = self._client().post(
            "/anibuddy/critique/contact-sheet",
            files={
                "request": self._envelope(self._contact_sheet_body(document)),
                "image": ("sheet.png", raw, "image/png"),
            },
        )
        self.assertEqual(response.status_code, 422, response.text)
        detail = response.json()["detail"]
        self.assertIn(sha256[:12], detail)
        self.assertIn("buffers", detail)

    def test_the_uploaded_buffer_gets_the_same_contact_sheet_past_the_sidecar(self) -> None:
        document, raw = _two_part_document()
        document, blob, sha256 = self._with_external_cut(document)
        response = self._client().post(
            "/anibuddy/critique/contact-sheet",
            files=[
                ("request", self._envelope(self._contact_sheet_body(document))),
                ("image", ("sheet.png", raw, "image/png")),
                # Named by its own hash, which is how the sidecar matches it to the
                # reference in the document — and checks it against the bytes, so a
                # part cannot claim to be geometry it is not.
                ("buffers", (sha256, blob, "application/octet-stream")),
            ],
        )
        self.assertEqual(response.status_code, 200, response.text)

        # A rehydrated buffer belongs to the request, not to the revision the caller
        # stores, so it goes back to being a reference on the way out — otherwise the
        # gateway would persist the very payload the reference exists to keep out of
        # the stored document.
        cuts = response.json()["document"]["parts"][0]["deformer"]["cuts"]
        points = next(cut["points"] for cut in cuts if cut["points"]["sha256"] == sha256)
        self.assertEqual(points["storage"], "external")
        self.assertIsNone(points["values"])
        self.assertEqual(points["storageKey"], f"anibuddy/{PROJECT}/buffers/{sha256}.bin")

    def test_an_oversized_contact_sheet_envelope_survives_the_1mb_part_cap(self) -> None:
        # The critique loop posts this endpoint once per pass, carrying the whole
        # document each time. It is the call most likely to meet the cap in practice.
        import json as json_module

        document, raw = _two_part_document()
        body = self._contact_sheet_body(document)
        while len(json_module.dumps(body).encode("utf-8")) <= 1024 * 1024:
            body["document"]["parts"].extend(body["document"]["parts"])

        response = self._client().post(
            "/anibuddy/critique/contact-sheet",
            files={
                "request": self._envelope(body),
                "image": ("sheet.png", raw, "image/png"),
            },
        )
        self.assertNotEqual(response.status_code, 400, response.text)
        self.assertNotIn("exceeded", response.text.lower())


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
