"""Unit tests for the AniBuddy render stage.

The synthetic rigs here are built by hand rather than run through decompose and
rig, so that a render failure is attributable to the render stage. Every fixture
is a flat colour on transparent, because the assertions that matter most are
about exact pixel values and about alpha, and a photograph would make both
untestable.

One test deserves calling out: ``test_rigid_identity_reproduces_source`` asserts
**exact** equality between the render and the masked source. That is only
possible because an unposed rigid part's affine map is the identity, and it is
the strongest available check that the half-pixel sampling convention, the
premultiply round trip and the coverage mask are all simultaneously right. If it
starts failing by one pixel, one of those three moved.
"""

from __future__ import annotations

import hashlib
import io
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.kernel import PoseTrack
from app.modules.anibuddy.render import (
    RenderCache,
    RenderError,
    RenderService,
    RigAdapter,
)
from app.modules.anibuddy.render.encode import Encoders
from app.modules.anibuddy.render.partpose import PartPoseTrack
from app.modules.anibuddy.render.types import (
    EncoderUnavailable,
    PartComposite,
    RenderOptions,
)
from app.modules.anibuddy.rig.buffers import Buffers
from app.modules.anibuddy.schemas import (
    AssetRef,
    Clip,
    Deformer,
    DeformerMesh,
    DeformerRigid,
    Diagnostics,
    DocumentProvenance,
    GenerationSeam,
    Joint,
    JointPose,
    Keyframe,
    Mask,
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

SHEET = 64
PROJECT = "proj_render_test"
_ZERO_HASH = "0" * 64


# --- Fixture construction --------------------------------------------------


def _sheet_rgba(
    blocks: Sequence[Tuple[Tuple[int, int, int, int], Tuple[int, int, int, int]]],
    size: int = SHEET,
) -> np.ndarray:
    """A transparent sheet with solid RGBA blocks painted into it.

    ``blocks`` is ``((x0, y0, x1, y1), (r, g, b, a))``.
    """
    sheet = np.zeros((size, size, 4), dtype=np.uint8)
    for (x0, y0, x1, y1), colour in blocks:
        sheet[y0:y1, x0:x1] = colour
    return sheet


def _png_bytes(sheet: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(sheet, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


def _asset(sheet_bytes: bytes, size: int = SHEET) -> AssetRef:
    return AssetRef(
        id="asset_render_test",
        name="render-test.png",
        storageKey="anibuddy/test/render-test.png",
        contentHash=hashlib.sha256(sheet_bytes).hexdigest(),
        width=size,
        height=size,
        figureHeight=None,
        mimeType="image/png",
        rightsConfirmed=True,
        remoteVisionConsented=False,
    )


def _part(
    part_id: str,
    rect: Tuple[float, float, float, float],
    *,
    deformer: Deformer,
    z_index: int = 0,
    mask: Optional[Mask] = None,
    bound_joint: Optional[str] = "j_root",
    visible: bool = True,
    opacity: float = 1.0,
) -> Part:
    return Part(
        id=part_id,
        name=part_id,
        role="torso",
        mask=mask or MaskRect(kind="rect"),
        rect=Rect(x=rect[0], y=rect[1], width=rect[2], height=rect[3]),
        pivot=Vec2(x=0.5, y=0.5),
        zIndex=z_index,
        parentPartId=None,
        attachSlot=None,
        slots=[],
        deformer=deformer,
        boundJointId=bound_joint,
        visible=visible,
        opacity=opacity,
        confidence=0.9,
        provenance="manual",
    )


def _joint(
    joint_id: str,
    x: float,
    y: float,
    parent: Optional[str] = None,
    part_id: Optional[str] = None,
) -> Joint:
    return Joint(
        id=joint_id,
        name=joint_id,
        role="root" if parent is None else "spine",
        x=x,
        y=y,
        parent=parent,
        partId=part_id,
        ikChainLength=None,
        confidence=0.9,
    )


def _document(
    asset: AssetRef,
    parts: List[Part],
    joints: List[Joint],
    clips: Optional[List[Clip]] = None,
    blocking_reason: Optional[str] = None,
) -> RigDocument:
    return RigDocument(
        schemaVersion=5,
        id="rev_render_0",
        projectId=PROJECT,
        createdAt="2026-08-14T00:00:00Z",
        updatedAt="2026-08-14T00:00:00Z",
        revision=RevisionLink(
            index=0, parentRevisionId=None, reason="test", accepted=True
        ),
        archetype="humanoid",
        asset=asset,
        parts=parts,
        skeleton=Skeleton(joints=joints),
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
            maxStretch=1.0,
            flippedTriangles=0,
            isolatedVertices=0,
            warnings=[],
            blockingReason=blocking_reason,
        ),
    )


def _mesh_deformer(
    bone_ids: List[str],
    *,
    columns: Optional[List[int]] = None,
    per_vertex: Optional[np.ndarray] = None,
) -> DeformerMesh:
    """A 1x1 quad mesh over the whole part rect, skinned to ``bone_ids``.

    Vertex order matches ``Grid.triangulate``: top-left, top-right, bottom-left,
    bottom-right.

    ``columns`` lets a test author the weight matrix in a deliberately different
    column order than the skeleton derives, which is what exercises the
    ``boneIds`` permutation. ``per_vertex`` supplies a full weight matrix, which
    is the only way to get a non-rigid deformation out of skinning: any mesh
    whose vertices all ride one bone at weight 1 is a rigid rotation and reports
    a stretch of exactly 1.
    """
    verts, _ = Buffers.f32(
        [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0], project_id=PROJECT
    )
    tris, _ = Buffers.u32([0, 1, 3, 0, 3, 2], project_id=PROJECT)

    if per_vertex is None:
        rows = np.zeros((4, len(bone_ids)), dtype=np.float64)
        rows[:, 0 if columns is None else columns[0]] = 1.0
    else:
        rows = np.asarray(per_vertex, dtype=np.float64)
    weights, _ = Buffers.f32(rows.ravel(), project_id=PROJECT)

    return DeformerMesh(
        kind="mesh",
        verts=verts,
        tris=tris,
        boneIds=bone_ids,
        weights=weights,
        cuts=[],
    )


def _clip(
    keyframes: List[Keyframe],
    *,
    clip_id: str = "clip_test",
    loop: bool = False,
    fps: int = 12,
    frame_count: int = 4,
) -> Clip:
    return Clip(
        id=clip_id,
        name="test clip",
        request="",
        loop=loop,
        fps=fps,
        frameCount=frame_count,
        keyframes=keyframes,
        source="edited",
    )


def _key(
    t: float,
    *,
    joints: Optional[dict] = None,
    parts: Optional[dict] = None,
    ease: str = "linear",
) -> Keyframe:
    return Keyframe(t=t, ease=ease, joints=joints or {}, parts=parts or {})


def _decode_first_frame(
    encoded: bytes, artifact: "object"
) -> Optional[np.ndarray]:
    """Decode a WebM's first frame back to RGBA, or None if no decoder exists.

    Uses the same binary locator the encoder does, so a host without ffmpeg
    skips rather than fails. Written as a raw-video pipe out for the same reason
    the encoder pipes in: it is the only way to be certain nothing between here
    and the pixels re-interpreted the alpha channel.
    """
    from app.modules.anibuddy.render.encode import _ffmpeg_binary
    from app.modules.anibuddy.render.types import EncoderUnavailable

    try:
        binary = _ffmpeg_binary()
    except EncoderUnavailable:  # pragma: no cover - host dependent
        return None

    width = int(getattr(artifact, "width"))
    height = int(getattr(artifact, "height"))
    with tempfile.TemporaryDirectory(prefix="anibuddy-decode-") as directory:
        source = Path(directory) / "in.webm"
        source.write_bytes(encoded)
        completed = subprocess.run(
            [
                binary,
                "-v", "error",
                "-c:v", "libvpx-vp9",
                "-i", str(source),
                "-frames:v", "1",
                "-f", "rawvideo",
                "-pix_fmt", "rgba",
                "pipe:1",
            ],
            capture_output=True,
            check=False,
        )
    if completed.returncode != 0 or len(completed.stdout) < width * height * 4:
        return None  # pragma: no cover - decoder dependent
    return np.frombuffer(
        completed.stdout[: width * height * 4], dtype=np.uint8
    ).reshape(height, width, 4)


def _zip_frames(data: bytes) -> List[np.ndarray]:
    """Every PNG in a frame zip, in name order, as RGBA arrays."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = sorted(
            name
            for name in archive.namelist()
            if name != RenderConstants.PNG_ZIP_README_NAME
        )
        return [
            np.asarray(Image.open(io.BytesIO(archive.read(name))).convert("RGBA"))
            for name in names
        ]


class RenderTestCase(unittest.TestCase):
    """Shared setup: the cache is process-global, so every test starts clean."""

    def setUp(self) -> None:
        RenderCache.clear()

    def tearDown(self) -> None:
        RenderCache.clear()


# --- Single rigid part -----------------------------------------------------


class RigidPartTests(RenderTestCase):
    def test_rigid_identity_reproduces_source(self) -> None:
        """An unposed rigid part resamples its own pixels exactly.

        The affine map is the identity, so any half-pixel error in the sampling
        convention, any premultiply round-trip loss, and any off-by-one in the
        coverage mask would all show up here as a mismatch.
        """
        sheet = _sheet_rgba([((16, 16, 48, 48), (200, 40, 60, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p_square", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        frames = _zip_frames(result.artifact.data)

        self.assertEqual(len(frames), 1, "a render with no clip is one still")
        np.testing.assert_array_equal(frames[0], sheet)

    def test_surface_and_frame_metadata(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (10, 20, 30, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_1", max_edge=32
        )

        self.assertEqual((result.artifact.width, result.artifact.height), (32, 32))
        self.assertEqual(result.artifact.frame_count, 1)
        self.assertEqual(result.artifact.mime_type, "application/zip")
        self.assertEqual(
            result.artifact.storage_key,
            f"anibuddy/{PROJECT}/render/{result.cache_key}.zip",
        )

    def test_mask_gates_neighbouring_artwork(self) -> None:
        """A rigid part must not carry a neighbour's pixels inside its rect.

        A rigid part is two triangles spanning its whole rect, so without the
        mask gate it would resample everything that overlaps that rect. The
        alpha-threshold mask is what stops it.
        """
        sheet = _sheet_rgba(
            [
                ((16, 16, 32, 48), (0, 200, 0, 255)),
                # A second blob inside the same rect, but fully transparent, so
                # only the mask can tell them apart.
                ((32, 16, 48, 48), (0, 0, 200, 10)),
            ]
        )
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p",
                    (0.25, 0.25, 0.5, 0.5),
                    deformer=DeformerRigid(kind="rigid"),
                    mask=MaskAlphaThreshold(kind="alpha-threshold", threshold=24),
                )
            ],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[24, 20]), (0, 200, 0, 255), "kept pixel")
        self.assertEqual(tuple(frame[24, 40]), (0, 0, 0, 0), "masked-out pixel")

    def test_blocking_reason_refuses_before_rendering(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (1, 2, 3, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
            blocking_reason="A weight row does not sum to 1.",
        )

        with self.assertRaises(RenderError) as caught:
            RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        self.assertIn("weight row", str(caught.exception))

    def test_unknown_clip_is_refused(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (1, 2, 3, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        with self.assertRaises(RenderError):
            RenderService.run(
                document, data, project_id=PROJECT, revision_id="rev_1", clip_id="nope"
            )

    def test_mismatched_sheet_size_is_refused(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (1, 2, 3, 255))])
        data = _png_bytes(sheet)
        asset = _asset(data).model_copy(update={"width": 128, "height": 128})
        document = _document(
            asset,
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        with self.assertRaises(RenderError) as caught:
            RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        self.assertIn("declares", str(caught.exception))


# --- Mesh limb -------------------------------------------------------------


class MeshLimbTests(RenderTestCase):
    def _rig(self, *, bone_ids: List[str], columns: Optional[List[int]] = None):
        sheet = _sheet_rgba([((16, 16, 48, 48), (220, 220, 40, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p_limb",
                    (0.25, 0.25, 0.5, 0.5),
                    deformer=_mesh_deformer(bone_ids, columns=columns),
                )
            ],
            [
                _joint("j_root", 0.5, 0.75),
                _joint("j_tip", 0.5, 0.25, parent="j_root"),
            ],
        )
        return document, data

    def test_unposed_mesh_reproduces_source(self) -> None:
        """A skinned mesh at rest is still the identity, so it too must be exact."""
        document, data = self._rig(bone_ids=["j_root->j_tip"])
        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[32, 32]), (220, 220, 40, 255))
        self.assertEqual(tuple(frame[8, 8]), (0, 0, 0, 0), "outside the part")

    def test_posed_mesh_moves_pixels_without_nan(self) -> None:
        document, data = self._rig(bone_ids=["j_root->j_tip"])
        posed = document.model_copy(
            update={
                "clips": [
                    _clip(
                        [
                            _key(0.0, joints={"j_tip": JointPose(rot=0.0)}),
                            _key(1.0, joints={"j_tip": JointPose(rot=60.0)}),
                        ],
                        frame_count=4,
                    )
                ]
            }
        )

        result = RenderService.run(
            posed, data, project_id=PROJECT, revision_id="rev_1", clip_id="clip_test"
        )
        frames = _zip_frames(result.artifact.data)

        self.assertEqual(len(frames), 4, "frame count follows the clip")
        for index, frame in enumerate(frames):
            self.assertTrue(np.all(np.isfinite(frame.astype(np.float64))))
            self.assertGreater(
                int(np.count_nonzero(frame[:, :, 3])), 0, f"frame {index} is empty"
            )
        self.assertFalse(
            np.array_equal(frames[0], frames[-1]), "the pose has to change something"
        )
        self.assertTrue(np.isfinite(result.report.stats.max_stretch))
        self.assertGreaterEqual(result.report.stats.drawn_triangles, 2)

    def test_bone_column_permutation_is_explicit(self) -> None:
        """Weight columns are permuted by NAME, not by position.

        The wire stores ``boneIds`` as an explicit ordered column list precisely
        so a skeleton change cannot silently reinterpret a matrix. This asserts
        the adapter honours that: the same weights authored under a reversed
        column order must produce the same pixels.
        """
        canonical, data = self._rig(bone_ids=["j_root->j_tip", "j_root->j_extra"])
        extra = canonical.model_copy(
            update={
                "skeleton": canonical.skeleton.model_copy(
                    update={
                        "joints": [
                            *canonical.skeleton.joints,
                            _joint("j_extra", 0.75, 0.5, parent="j_root"),
                        ]
                    }
                )
            }
        )
        reversed_columns = extra.model_copy(
            update={
                "parts": [
                    extra.parts[0].model_copy(
                        update={
                            "deformer": _mesh_deformer(
                                ["j_root->j_extra", "j_root->j_tip"], columns=[1]
                            )
                        }
                    )
                ]
            }
        )

        straight = RenderService.run(
            extra, data, project_id=PROJECT, revision_id="rev_1"
        )
        RenderCache.clear()
        permuted = RenderService.run(
            reversed_columns, data, project_id=PROJECT, revision_id="rev_2"
        )

        np.testing.assert_array_equal(
            _zip_frames(straight.artifact.data)[0],
            _zip_frames(permuted.artifact.data)[0],
        )

    def test_unknown_bone_id_is_refused_not_dropped(self) -> None:
        document, data = self._rig(bone_ids=["j_root->j_missing"])
        with self.assertRaises(RenderError) as caught:
            RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        self.assertIn("j_root->j_missing", str(caught.exception))

    def test_weight_rows_must_sum_to_one(self) -> None:
        document, data = self._rig(bone_ids=["j_root->j_tip"])
        halved, _ = Buffers.f32([0.5] * 4, project_id=PROJECT)
        broken = document.model_copy(
            update={
                "parts": [
                    document.parts[0].model_copy(
                        update={
                            "deformer": document.parts[0].deformer.model_copy(
                                update={"weights": halved}
                            )
                        }
                    )
                ]
            }
        )

        with self.assertRaises(RenderError) as caught:
            RenderService.run(broken, data, project_id=PROJECT, revision_id="rev_1")
        self.assertIn("weight row", str(caught.exception))


# --- Multi-part z-order ----------------------------------------------------


class ZOrderTests(RenderTestCase):
    """Two parts whose SOURCE regions are disjoint, brought into overlap by a pose.

    Disjoint sources matter. Two rigid parts at rest can only overlap on the
    canvas where they overlap on the sheet, and there they read the same pixels —
    so the composite order would be unobservable. Translating one part's joint
    onto the other is what makes "which layer won" a question with a visible
    answer.

    The translation is exact: a joint with no rotation and no scale places its
    child at its rest position plus ``(tx, ty) * figureHeight``, so
    ``tx = ty = 0.25`` on a 64px sheet is a clean 16px shift and every sample
    lands on an integer source coordinate.

    16px rather than the full 24px width of each part, so the two overlap
    PARTIALLY: that leaves a red-only band, a blue-only band and a shared band,
    and a z-order bug that swapped the whole composite would still be caught by
    the two single-layer bands.
    """

    SHIFT = 0.25

    def _overlapping(self, *, red_z: int = 0, blue_z: int = 1, veil: bool = False):
        blue = (255, 255, 255, 128) if veil else (0, 0, 255, 255)
        sheet = _sheet_rgba(
            [
                ((32, 32, 56, 56), (255, 0, 0, 255)),
                ((8, 8, 32, 32), blue),
            ]
        )
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p_red",
                    (0.5, 0.5, 0.375, 0.375),
                    deformer=DeformerRigid(kind="rigid"),
                    z_index=red_z,
                ),
                _part(
                    "p_blue",
                    (0.125, 0.125, 0.375, 0.375),
                    deformer=DeformerRigid(kind="rigid"),
                    z_index=blue_z,
                    bound_joint="j_move",
                ),
            ],
            [
                _joint("j_root", 0.5, 0.5),
                _joint("j_move", 0.75, 0.5, parent="j_root"),
            ],
            clips=[
                _clip(
                    [
                        _key(
                            0.0,
                            joints={
                                "j_move": JointPose(tx=self.SHIFT, ty=self.SHIFT)
                            },
                        ),
                        _key(
                            1.0,
                            joints={
                                "j_move": JointPose(tx=self.SHIFT, ty=self.SHIFT)
                            },
                        ),
                    ],
                    frame_count=2,
                )
            ],
        )
        return document, data

    def _render(self, document, data, **kwargs) -> List[np.ndarray]:
        result = RenderService.run(
            document,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            **kwargs,
        )
        return _zip_frames(result.artifact.data)

    def test_higher_z_index_wins_the_overlap(self) -> None:
        document, data = self._overlapping(red_z=0, blue_z=1)
        frame = self._render(document, data)[0]

        self.assertEqual(tuple(frame[40, 40]), (0, 0, 255, 255), "blue is in front")
        self.assertEqual(tuple(frame[52, 52]), (255, 0, 0, 255), "red-only band")
        self.assertEqual(tuple(frame[28, 28]), (0, 0, 255, 255), "blue-only band")
        self.assertEqual(tuple(frame[12, 12]), (0, 0, 0, 0), "blue vacated its rest slot")

    def test_lower_z_index_loses_the_overlap(self) -> None:
        document, data = self._overlapping(red_z=1, blue_z=0)
        frame = self._render(document, data)[0]

        self.assertEqual(tuple(frame[40, 40]), (255, 0, 0, 255), "red is now in front")

    def test_part_pose_z_index_reorders_mid_clip(self) -> None:
        """``PartPose.zIndex`` steps, so it re-sorts the composite at render time."""
        document, data = self._overlapping(red_z=0, blue_z=1)
        keys = document.clips[0].keyframes
        animated = document.model_copy(
            update={
                "clips": [
                    document.clips[0].model_copy(
                        update={
                            "keyframes": [
                                keys[0].model_copy(
                                    update={"parts": {"p_red": PartPose(zIndex=5)}}
                                ),
                                keys[1],
                            ]
                        }
                    )
                ]
            }
        )

        frames = self._render(animated, data, frame_count=2, loop=False)

        self.assertEqual(
            tuple(frames[0][40, 40]), (255, 0, 0, 255), "red raised to z=5 at t=0"
        )
        self.assertEqual(
            tuple(frames[-1][40, 40]), (0, 0, 255, 255), "back to rest z-order"
        )

    def test_semi_transparent_layer_composites_with_source_over(self) -> None:
        """A 50% white veil over opaque blue has to match the analytic result.

        ``over`` in premultiplied space is ``src + dst * (1 - src_alpha)``. With
        ``src_alpha = 128/255`` and an opaque red backdrop the exact answer is
        ``(128, 128, ...)`` after the un-premultiply, so any error in either
        direction of the premultiply round trip shows up as an off-by-one here.
        """
        document, data = self._overlapping(red_z=0, blue_z=1, veil=True)
        frame = self._render(document, data)[0]

        alpha = 128.0 / 255.0
        expected = (
            round((1.0 * alpha + 1.0 * (1.0 - alpha)) * 255),
            round((1.0 * alpha + 0.0) * 255),
            round((1.0 * alpha + 0.0) * 255),
            255,
        )
        self.assertEqual(tuple(int(channel) for channel in frame[40, 40]), expected)


# --- Alpha correctness -----------------------------------------------------


class AlphaTests(RenderTestCase):
    def test_semi_transparent_artwork_round_trips_straight_alpha(self) -> None:
        """A 50% alpha part must come back as straight, not premultiplied, RGBA.

        Compositing happens premultiplied; the artifact is straight. Getting the
        un-premultiply wrong is invisible on opaque artwork and turns every
        semi-transparent pixel dark, so it is asserted on an exact value.
        """
        sheet = _sheet_rgba([((16, 16, 48, 48), (255, 0, 0, 128))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[32, 32]), (255, 0, 0, 128))

    def test_resampled_cutout_edge_has_no_halo(self) -> None:
        """A sub-pixel shift must not tint the antialiased fringe.

        This is the single most visible way a cutout renderer can be wrong.
        Bilinear resampling of STRAIGHT alpha averages a transparent pixel's RGB
        into its opaque neighbour, so a hard edge picks up the colour of "nothing"
        — a dark halo on a light figure. Premultiplied sampling cannot: a
        transparent pixel contributes exactly zero to both colour and coverage.

        The rig is shifted by half a pixel through the root's ``tx``/``ty``, which
        is what forces every sample to land between two source pixels and
        therefore forces the blend to happen at all. A whole-pixel shift would
        resample exactly and prove nothing.
        """
        colour = (255, 200, 100)
        sheet = _sheet_rgba([((17, 17, 47, 47), (*colour, 255))])
        data = _png_bytes(sheet)
        half_pixel = 0.5 / SHEET
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
            clips=[
                _clip(
                    [
                        _key(
                            0.0,
                            joints={
                                "j_root": JointPose(tx=half_pixel, ty=half_pixel)
                            },
                        ),
                        _key(
                            1.0,
                            joints={
                                "j_root": JointPose(tx=half_pixel, ty=half_pixel)
                            },
                        ),
                    ],
                    frame_count=2,
                )
            ],
        )

        result = RenderService.run(
            document,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            frame_count=1,
        )
        frame = _zip_frames(result.artifact.data)[0]

        fringe = frame[(frame[:, :, 3] > 0) & (frame[:, :, 3] < 255)]
        self.assertGreater(
            fringe.shape[0], 0, "a half-pixel shift has to produce a fringe"
        )
        np.testing.assert_allclose(
            fringe[:, :3].astype(np.int16),
            np.tile(np.array(colour, dtype=np.int16), (fringe.shape[0], 1)),
            atol=2,
            err_msg="the fringe drifted off the source hue, which is a halo",
        )

    def test_matte_background_is_opaque_everywhere(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (255, 0, 0, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_1", background="white"
        )
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[4, 4]), (255, 255, 255, 255), "matte")
        self.assertEqual(tuple(frame[32, 32]), (255, 0, 0, 255), "artwork on matte")
        self.assertTrue(bool(np.all(frame[:, :, 3] == 255)))


# --- PartPose channels -----------------------------------------------------


class PartPoseChannelTests(RenderTestCase):
    def _two_parts(self):
        sheet = _sheet_rgba(
            [
                ((4, 4, 28, 28), (255, 0, 0, 255)),
                ((36, 36, 60, 60), (0, 255, 0, 255)),
            ]
        )
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part("p_a", (0.0625, 0.0625, 0.375, 0.375), deformer=DeformerRigid(kind="rigid")),
                _part("p_b", (0.5625, 0.5625, 0.375, 0.375), deformer=DeformerRigid(kind="rigid")),
            ],
            [_joint("j_root", 0.5, 0.5)],
        )
        return document, data

    def test_rest_visibility_hides_a_part(self) -> None:
        document, data = self._two_parts()
        hidden = document.model_copy(
            update={
                "parts": [
                    document.parts[0].model_copy(update={"visible": False}),
                    document.parts[1],
                ]
            }
        )

        result = RenderService.run(hidden, data, project_id=PROJECT, revision_id="rev_1")
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[16, 16]), (0, 0, 0, 0), "hidden part")
        self.assertEqual(tuple(frame[48, 48]), (0, 255, 0, 255), "visible part")

    def test_part_pose_visibility_steps(self) -> None:
        document, data = self._two_parts()
        animated = document.model_copy(
            update={
                "clips": [
                    _clip(
                        [
                            _key(0.0, parts={"p_a": PartPose(visible=False)}),
                            _key(0.75, parts={}),
                        ],
                        frame_count=2,
                    )
                ]
            }
        )

        result = RenderService.run(
            animated, data, project_id=PROJECT, revision_id="rev_1", clip_id="clip_test"
        )
        frames = _zip_frames(result.artifact.data)

        self.assertEqual(tuple(frames[0][16, 16]), (0, 0, 0, 0), "hidden at t=0")
        self.assertEqual(
            tuple(frames[-1][16, 16]), (255, 0, 0, 255), "back to rest visibility"
        )

    def test_part_pose_opacity_interpolates_against_rest(self) -> None:
        document, data = self._two_parts()
        animated = document.model_copy(
            update={
                "clips": [
                    _clip(
                        [
                            _key(0.0, parts={"p_a": PartPose(opacity=0.0)}),
                            _key(1.0, parts={"p_a": PartPose(opacity=1.0)}),
                        ],
                        frame_count=3,
                    )
                ]
            }
        )

        result = RenderService.run(
            animated, data, project_id=PROJECT, revision_id="rev_1", clip_id="clip_test"
        )
        frames = _zip_frames(result.artifact.data)

        alphas = [int(frame[16, 16, 3]) for frame in frames]
        self.assertEqual(alphas[0], 0, "fully faded out")
        self.assertEqual(alphas[-1], 255, "fully faded in")
        self.assertEqual(alphas, sorted(alphas), "the ramp is monotonic")
        # Straight alpha survives the fade: a half-faded red pixel is still red.
        mid = frames[1][16, 16]
        self.assertEqual(tuple(int(channel) for channel in mid[:3]), (255, 0, 0))

    def test_part_pose_opacity_replaces_the_rest_value(self) -> None:
        """A keyed opacity REPLACES ``Part.opacity``; it is never scaled by it.

        The half-translucent part is keyed to 1, so it must reach fully opaque.
        Under the multiply reading the server used to implement, this frame
        would come back at alpha 128 and look deliberate — which is exactly why
        the divergence survived: nothing throws, and the number is plausible.
        """
        document, data = self._two_parts()
        animated = document.model_copy(
            update={
                "parts": [
                    document.parts[0].model_copy(update={"opacity": 0.5}),
                    document.parts[1],
                ],
                "clips": [
                    _clip(
                        [_key(0.0, parts={"p_a": PartPose(opacity=1.0)})],
                        frame_count=2,
                    )
                ],
            }
        )

        result = RenderService.run(
            animated,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            frame_count=1,
        )
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(int(frame[16, 16, 3]), 255, "the key drove it to opaque")

    def test_part_opacity_is_the_rest_a_one_sided_key_blends_against(self) -> None:
        """A channel keyed on one side only ramps from the part's own opacity.

        Not from 1. ``Part.opacity`` is the rest value of the channel, so a
        ghost authored at 0.5 that is keyed to 1 at the end of the clip ramps
        0.5 -> 1, and its first frame is the part as authored.
        """
        document, data = self._two_parts()
        translucent = document.parts[0].model_copy(update={"opacity": 0.5})
        clip = _clip(
            [_key(0.0), _key(1.0, parts={"p_a": PartPose(opacity=1.0)})],
            frame_count=3,
        )

        for time, expected in ((0.0, 0.5), (1.0, 1.0)):
            with self.subTest(time=time):
                resolved = PartPoseTrack.resolve(
                    translucent, clip.keyframes, clip.loop, time
                )
                self.assertAlmostEqual(resolved.opacity, expected, places=12)

    def test_swap_to_substitutes_pixels_not_geometry(self) -> None:
        """``swapTo`` draws THIS part's mesh out of the target part's pixels.

        p_a and p_b are equal-sized quads in opposite corners. After the swap
        p_a still occupies its own corner — its geometry never moved — and the
        pixels there are p_b's green rather than p_a's red. p_b is still drawn
        as itself as well; a swap does not consume the target.
        """
        document, data = self._two_parts()
        animated = document.model_copy(
            update={
                "clips": [
                    _clip(
                        [_key(0.0, parts={"p_a": PartPose(swapTo="p_b")})],
                        frame_count=2,
                    )
                ]
            }
        )

        result = RenderService.run(
            animated,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            frame_count=1,
        )
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(
            tuple(frame[16, 16]), (0, 255, 0, 255), "p_a's slot, p_b's pixels"
        )
        self.assertEqual(tuple(frame[48, 48]), (0, 255, 0, 255), "p_b, still itself")

    def test_unresolvable_swap_target_warns_and_draws_itself(self) -> None:
        document, data = self._two_parts()
        animated = document.model_copy(
            update={
                "clips": [
                    _clip(
                        [_key(0.0, parts={"p_a": PartPose(swapTo="p_ghost")})],
                        frame_count=2,
                    )
                ]
            }
        )

        result = RenderService.run(
            animated,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            frame_count=1,
        )
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[16, 16]), (255, 0, 0, 255))
        self.assertTrue(
            any("p_ghost" in warning for warning in result.report.warnings),
            result.report.warnings,
        )

    def test_part_translation_moves_the_layer(self) -> None:
        """A ``PartPose.tx`` really moves pixels, in figure-height fractions.

        The units are the assertion. ``figureHeight`` resolves to the sheet
        height (64 px here), so ``tx = 0.25`` is exactly 16 px and the red
        square's 4..28 band must land on 20..44. A kernel that scaled the
        channel by the canvas width, by the part rect, or not at all would still
        move the square -- just not by 16 px.
        """
        document, data = self._two_parts()
        animated = document.model_copy(
            update={
                "clips": [
                    _clip([_key(0.0, parts={"p_a": PartPose(tx=0.25)})], frame_count=2)
                ]
            }
        )

        result = RenderService.run(
            animated,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            frame_count=1,
        )
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[16, 36]), (255, 0, 0, 255), "moved 16px right")
        self.assertEqual(tuple(frame[16, 8]), (0, 0, 0, 0), "vacated by the move")
        self.assertEqual(
            [
                warning
                for warning in result.report.warnings
                if "not applied" in warning or "transform tree" in warning
            ],
            [],
            "the geometry channels are implemented now, not refused",
        )

    def test_a_child_part_follows_its_transform_parent(self) -> None:
        """The tree carries a part that carries no pose of its own.

        ``p_b`` names no channel anywhere in the clip; it moves only because
        ``p_a`` is its ``parentPartId``. That is the whole claim of §7.4's
        "transform parent", and before the kernel modelled the tree this render
        left ``p_b`` exactly where it was drawn.
        """
        document, data = self._two_parts()
        parented = document.model_copy(
            update={
                "parts": [
                    document.parts[0],
                    document.parts[1].model_copy(update={"parentPartId": "p_a"}),
                ],
                "clips": [
                    _clip([_key(0.0, parts={"p_a": PartPose(tx=0.25)})], frame_count=2)
                ],
            }
        )

        result = RenderService.run(
            parented,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            frame_count=1,
        )
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[48, 56]), (0, 255, 0, 255), "child moved with it")
        self.assertEqual(tuple(frame[48, 40]), (0, 0, 0, 0), "vacated by the child")

    def test_a_part_at_rest_is_untouched_by_the_tree(self) -> None:
        """No poses, no parents: the render must be bit-identical to no tree.

        The guard on the whole change. ``Skin.is_identity`` short-circuits the
        apply only when the composed transform is exactly the identity, and this
        asserts the common case really does land there rather than on a
        near-identity that quietly resamples every part.
        """
        document, data = self._two_parts()

        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[16, 16]), (255, 0, 0, 255))
        self.assertEqual(tuple(frame[48, 48]), (0, 255, 0, 255))

    def test_an_unknown_transform_parent_is_refused(self) -> None:
        """Refuse rather than repair (R7), and refuse before spending a frame.

        Promoting the part to a root would render something plausible that
        animates wrongly, which is strictly worse than a sentence naming the
        missing id.
        """
        document, data = self._two_parts()
        orphaned = document.model_copy(
            update={
                "parts": [
                    document.parts[0],
                    document.parts[1].model_copy(update={"parentPartId": "p_gone"}),
                ]
            }
        )

        with self.assertRaises(RenderError) as caught:
            RenderService.run(orphaned, data, project_id=PROJECT, revision_id="rev_1")
        self.assertIn("p_gone", str(caught.exception))

    def test_a_part_tree_cycle_is_refused(self) -> None:
        document, data = self._two_parts()
        looped = document.model_copy(
            update={
                "parts": [
                    document.parts[0].model_copy(update={"parentPartId": "p_b"}),
                    document.parts[1].model_copy(update={"parentPartId": "p_a"}),
                ]
            }
        )

        with self.assertRaises(RenderError) as caught:
            RenderService.run(looped, data, project_id=PROJECT, revision_id="rev_1")
        self.assertIn("cycle", str(caught.exception))

    def test_an_attachment_slot_the_parent_does_not_offer_is_refused(self) -> None:
        document, data = self._two_parts()
        misattached = document.model_copy(
            update={
                "parts": [
                    document.parts[0],
                    document.parts[1].model_copy(
                        update={"parentPartId": "p_a", "attachSlot": "hand"}
                    ),
                ]
            }
        )

        with self.assertRaises(RenderError) as caught:
            RenderService.run(misattached, data, project_id=PROJECT, revision_id="rev_1")
        self.assertIn("hand", str(caught.exception))

    def test_an_attachment_slot_re_anchors_the_child_onto_it(self) -> None:
        """Naming a slot moves the child's pivot onto it, at rest.

        ``p_a`` offers a slot at its own top-left corner (part-local 0,0 =
        4,4 px). ``p_b``'s pivot is its centre (48,48 px), so attaching moves
        ``p_b`` by (-44, -44) and its 36..60 band lands on -8..16. The visible
        remainder is the 0..16 corner, which is what the assertions below read.
        """
        document, data = self._two_parts()
        attached = document.model_copy(
            update={
                "parts": [
                    document.parts[0].model_copy(
                        update={"slots": [Slot(name="hand", position=Vec2(x=0.0, y=0.0))]}
                    ),
                    document.parts[1].model_copy(
                        update={"parentPartId": "p_a", "attachSlot": "hand"}
                    ),
                ]
            }
        )

        result = RenderService.run(attached, data, project_id=PROJECT, revision_id="rev_1")
        frame = _zip_frames(result.artifact.data)[0]

        self.assertEqual(tuple(frame[8, 8]), (0, 255, 0, 255), "green drawn over red")
        self.assertEqual(tuple(frame[48, 48]), (0, 0, 0, 0), "and gone from its rect")

    def test_looping_clip_whose_first_key_is_not_at_zero(self) -> None:
        """The loop wrap must not build a keyframe past the schema's ``t <= 1``.

        Regression guard. The kernel synthesizes a real wrap key at
        ``first.t + 1`` because its own struct has no bound on ``t``; doing the
        same with a wire ``Keyframe`` raises a validation error the moment the
        first key sits anywhere but exactly 0.
        """
        document, data = self._two_parts()
        animated = document.model_copy(
            update={
                "clips": [
                    _clip(
                        [
                            _key(0.2, parts={"p_a": PartPose(opacity=0.25)}),
                            _key(0.8, parts={"p_a": PartPose(opacity=1.0)}),
                        ],
                        frame_count=4,
                        loop=True,
                    )
                ]
            }
        )

        result = RenderService.run(
            animated, data, project_id=PROJECT, revision_id="rev_1", clip_id="clip_test"
        )
        frames = _zip_frames(result.artifact.data)

        self.assertEqual(len(frames), 4)
        for frame in frames:
            self.assertGreater(int(np.count_nonzero(frame[:, :, 3])), 0)

    def test_part_and_joint_channels_sample_the_same_instant(self) -> None:
        """The two samplers bracket through one function, so they cannot desync.

        ``opacity`` is resolved by ``partpose.py`` and ``tx`` by the kernel, from
        the same clip. Reading them at a time where the eased progress is
        neither 0 nor 1 is what would expose a bracketing difference: the two
        would land on different fractions of their own ramps.
        """
        clip = _clip(
            [
                _key(0.0, parts={"p_a": PartPose(tx=0.0, opacity=0.0)}),
                _key(1.0, parts={"p_a": PartPose(tx=0.4, opacity=1.0)}),
            ]
        )
        kernel_clip = RigAdapter.clip_to_kernel(clip)

        for time in (0.25, 0.5, 0.75):
            with self.subTest(time=time):
                geometry = PoseTrack.part_pose_at(kernel_clip, time)
                composite = PartPoseTrack.resolve(
                    _part("p_a", (0.0, 0.0, 1.0, 1.0), deformer=DeformerRigid(kind="rigid")),
                    clip.keyframes,
                    clip.loop,
                    time,
                )
                # tx ramps 0 -> 0.4 and opacity 0 -> 1 over the same span, so
                # the same u drives both: tx / 0.4 must equal opacity.
                self.assertAlmostEqual(
                    geometry["p_a"].tx / 0.4, composite.opacity, places=12
                )


# --- Distortion reporting --------------------------------------------------


class DistortionTests(RenderTestCase):
    def test_stretch_is_measured_and_disclosed(self) -> None:
        """A blended two-bone pose smears the artwork, and that has to be reported.

        Weights are hard 0/1 split across the quad's top and bottom rows, so each
        triangle spans both bones and shears when they diverge. A single-bone mesh
        would not do: linear blend skinning with one weight of 1 is a rigid
        rotation, and rigid means a stretch of exactly 1.
        """
        sheet = _sheet_rgba([((8, 8, 56, 56), (120, 120, 250, 255))])
        data = _png_bytes(sheet)
        graded = np.array(
            [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0]], dtype=np.float64
        )
        document = _document(
            _asset(data),
            [
                _part(
                    "p_limb",
                    (0.125, 0.125, 0.75, 0.75),
                    deformer=_mesh_deformer(
                        ["j_root->j_upper", "j_upper->j_lower"],
                        per_vertex=graded,
                    ),
                )
            ],
            [
                _joint("j_root", 0.5, 0.9),
                _joint("j_upper", 0.5, 0.5, parent="j_root"),
                _joint("j_lower", 0.5, 0.1, parent="j_upper"),
            ],
            clips=[
                _clip(
                    [
                        _key(0.0, joints={"j_lower": JointPose(rot=0.0)}),
                        _key(
                            1.0,
                            joints={"j_lower": JointPose(rot=140.0, scale=0.2)},
                        ),
                    ],
                    frame_count=3,
                )
            ],
        )

        result = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_1", clip_id="clip_test"
        )

        self.assertGreater(result.report.stats.max_stretch, 1.0)
        self.assertTrue(np.isfinite(result.report.stats.max_stretch))
        self.assertEqual(
            result.document.diagnostics.maxStretch, result.report.stats.max_stretch
        )
        self.assertGreater(
            result.report.stats.max_stretch,
            RenderConstants.STRETCH_WARNING,
            "this pose is meant to trip the disclosure threshold",
        )
        self.assertTrue(
            any("Peak stretch" in warning for warning in result.report.warnings),
            result.report.warnings,
        )
        self.assertIsNone(
            result.document.diagnostics.blockingReason,
            "a stretched render ships and discloses (F9 8.5)",
        )

    def test_diagnostics_are_server_authored(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (5, 5, 5, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )
        lying = document.model_copy(
            update={
                "diagnostics": document.diagnostics.model_copy(
                    update={"maxStretch": 999.0, "flippedTriangles": 42}
                )
            }
        )

        result = RenderService.run(lying, data, project_id=PROJECT, revision_id="rev_1")

        self.assertEqual(result.document.diagnostics.maxStretch, 1.0)
        self.assertEqual(result.document.diagnostics.flippedTriangles, 0)

    def test_nothing_drawn_sets_a_blocking_reason(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (5, 5, 5, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p",
                    (0.25, 0.25, 0.5, 0.5),
                    deformer=DeformerRigid(kind="rigid"),
                    visible=False,
                )
            ],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")

        self.assertIsNotNone(result.document.diagnostics.blockingReason)
        self.assertIn("Nothing was drawn", result.document.diagnostics.blockingReason)

    def test_oversized_job_is_refused_with_the_levers_named(self) -> None:
        """A job that cannot finish inside the request budget is refused up front.

        Rasterizer cost tracks destination AREA per layer per frame, so a rig
        that is legal in every other respect can still be unrenderable in a
        request. Refused rather than allowed to hit the gateway timeout, which
        would lose the work and explain nothing.
        """
        sheet = _sheet_rgba([((2, 2, 62, 62), (5, 5, 5, 255))])
        data = _png_bytes(sheet)
        full_sheet = [
            _part(
                f"p{index}",
                (0.0, 0.0, 1.0, 1.0),
                deformer=DeformerRigid(kind="rigid"),
                z_index=index,
            )
            for index in range(RenderConstants.MAX_PARTS)
        ]
        document = _document(
            _asset(data),
            full_sheet,
            [_joint("j_root", 0.5, 0.5)],
            clips=[_clip([_key(0.0), _key(1.0)], frame_count=120)],
        )

        with self.assertRaises(RenderError) as caught:
            RenderService.run(
                document,
                data,
                project_id=PROJECT,
                revision_id="rev_1",
                clip_id="clip_test",
                # An explicit size, because the aspect-preserving path never
                # upscales past the asset and this sheet is only 64px.
                width=RenderConstants.MAX_OUTPUT_EDGE,
                height=RenderConstants.MAX_OUTPUT_EDGE,
            )

        message = str(caught.exception)
        self.assertIn("budget", message)
        self.assertIn("Lower the frame count or the output size", message)

    def test_the_budget_guard_passes_a_realistic_humanoid(self) -> None:
        """The guard must not fire on a rig a user would actually build.

        Exercised through the guard directly rather than by rendering: the point
        is the estimate's arithmetic at a realistic pixel load, and actually
        rasterizing 120 frames at 1024px would put twenty seconds into a unit
        test to assert something the guard decides in microseconds.
        """
        from app.modules.anibuddy.render.types import RenderSurface

        sheet = _sheet_rgba([((8, 8, 56, 56), (5, 5, 5, 255))])
        data = _png_bytes(sheet)
        # Limb-shaped rects, the shape a humanoid actually decomposes into.
        limbs = [
            _part(
                f"p{index}",
                (0.1 + 0.05 * index, 0.2, 0.14, 0.3),
                deformer=DeformerRigid(kind="rigid"),
                z_index=index,
            )
            for index in range(12)
        ]
        document = _document(_asset(data), limbs, [_joint("j_root", 0.5, 0.5)])

        frames = 120
        options = RenderOptions(
            fmt=RenderConstants.FALLBACK_FORMAT,
            fps=24,
            frame_count=frames,
            loop=False,
            surface=RenderSurface(width=1024, height=1024, scale_x=16.0, scale_y=16.0),
            background=RenderConstants.BACKGROUND_TRANSPARENT,
            clip_id=None,
        )
        composites = [
            PartPoseTrack.composite_order(list(document.parts), None, 0.0, lambda _m: None)
            for _ in range(frames)
        ]

        # Does not raise.
        RenderService._refuse_if_over_budget(document, options, composites)

    def test_the_budget_guard_charges_only_what_composites(self) -> None:
        """A clip that hides most of its layers is charged for what it draws."""
        from app.modules.anibuddy.render.types import RenderSurface

        sheet = _sheet_rgba([((8, 8, 56, 56), (5, 5, 5, 255))])
        data = _png_bytes(sheet)
        full_sheet = [
            _part(
                f"p{index}",
                (0.0, 0.0, 1.0, 1.0),
                deformer=DeformerRigid(kind="rigid"),
                z_index=index,
                visible=index == 0,
            )
            for index in range(RenderConstants.MAX_PARTS)
        ]
        document = _document(_asset(data), full_sheet, [_joint("j_root", 0.5, 0.5)])

        frames = 60
        options = RenderOptions(
            fmt=RenderConstants.FALLBACK_FORMAT,
            fps=24,
            frame_count=frames,
            loop=False,
            surface=RenderSurface(width=1024, height=1024, scale_x=16.0, scale_y=16.0),
            background=RenderConstants.BACKGROUND_TRANSPARENT,
            clip_id=None,
        )
        one_visible = [
            PartPoseTrack.composite_order(list(document.parts), None, 0.0, lambda _m: None)
            for _ in range(frames)
        ]
        self.assertEqual(len(one_visible[0]), 1, "only one layer is visible")

        # 1 full-sheet layer over 60 frames is affordable; 64 would not be.
        RenderService._refuse_if_over_budget(document, options, one_visible)

        all_visible = [
            [
                PartComposite(
                    part_id=part.id,
                    texture_part_id=part.id,
                    uv_remap=RenderConstants.IDENTITY_UV_REMAP,
                    z_index=part.zIndex,
                    opacity=1.0,
                    order=index,
                )
                for index, part in enumerate(document.parts)
            ]
            for _ in range(frames)
        ]
        with self.assertRaises(RenderError):
            RenderService._refuse_if_over_budget(document, options, all_visible)

    def test_render_appends_a_stage_record(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (5, 5, 5, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_7", revision_index=3
        )
        record = result.document.provenance.stages[-1]

        self.assertEqual(record.stage, "render")
        self.assertEqual(record.status, "succeeded")
        self.assertEqual(record.inputHash, result.cache_key)
        self.assertEqual(result.document.revision.index, 3)
        self.assertEqual(result.document.revision.parentRevisionId, "rev_render_0")
        self.assertFalse(result.document.revision.accepted)


# --- Caching ---------------------------------------------------------------


class CacheTests(RenderTestCase):
    def _rig(self):
        sheet = _sheet_rgba([((16, 16, 48, 48), (77, 88, 99, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )
        return document, data

    def test_identical_input_is_a_cache_hit_with_identical_bytes(self) -> None:
        document, data = self._rig()

        first = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        second = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_2")

        self.assertFalse(first.report.cache_hit)
        self.assertTrue(second.report.cache_hit)
        self.assertEqual(first.cache_key, second.cache_key)
        self.assertEqual(first.artifact.content_hash, second.artifact.content_hash)
        self.assertEqual(first.artifact.data, second.artifact.data)

    def test_a_cache_hit_still_reports_honest_diagnostics(self) -> None:
        """Stats ride on the artifact, so a hit cannot report a clean bill of health."""
        document, data = self._rig()

        first = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        second = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_2")

        self.assertEqual(
            first.document.diagnostics.maxStretch,
            second.document.diagnostics.maxStretch,
        )
        self.assertGreater(second.report.stats.drawn_parts, 0)

    def test_changed_geometry_changes_the_key(self) -> None:
        document, data = self._rig()
        moved = document.model_copy(
            update={
                "parts": [
                    document.parts[0].model_copy(
                        update={
                            "rect": Rect(x=0.3, y=0.25, width=0.5, height=0.5)
                        }
                    )
                ]
            }
        )

        first = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        second = RenderService.run(moved, data, project_id=PROJECT, revision_id="rev_2")

        self.assertNotEqual(first.cache_key, second.cache_key)
        self.assertFalse(second.report.cache_hit)

    def test_changed_options_change_the_key(self) -> None:
        document, data = self._rig()

        first = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        second = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_2", background="dark"
        )
        third = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_3", max_edge=32
        )

        self.assertEqual(len({first.cache_key, second.cache_key, third.cache_key}), 3)

    def test_sparse_and_explicit_zero_are_different_keys(self) -> None:
        """A key that sets ``rot`` to 0 is not the same animation as one that omits it."""
        document, data = self._rig()
        with_joint = document.model_copy(
            update={"skeleton": Skeleton(joints=[_joint("j_root", 0.5, 0.5)])}
        )
        sparse = with_joint.model_copy(
            update={"clips": [_clip([_key(0.0), _key(1.0)], frame_count=2)]}
        )
        explicit = with_joint.model_copy(
            update={
                "clips": [
                    _clip(
                        [
                            _key(0.0, joints={"j_root": JointPose(rot=0.0)}),
                            _key(1.0),
                        ],
                        frame_count=2,
                    )
                ]
            }
        )

        first = RenderService.run(
            sparse, data, project_id=PROJECT, revision_id="rev_1", clip_id="clip_test"
        )
        second = RenderService.run(
            explicit, data, project_id=PROJECT, revision_id="rev_2", clip_id="clip_test"
        )

        self.assertNotEqual(first.cache_key, second.cache_key)


# --- Encoders --------------------------------------------------------------


class EncoderTests(RenderTestCase):
    def _rig(self, frame_count: int = 3):
        sheet = _sheet_rgba([((16, 16, 48, 48), (10, 190, 220, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p_limb",
                    (0.25, 0.25, 0.5, 0.5),
                    deformer=_mesh_deformer(["j_root->j_tip"]),
                )
            ],
            [
                _joint("j_root", 0.5, 0.75),
                _joint("j_tip", 0.5, 0.25, parent="j_root"),
            ],
            clips=[
                _clip(
                    [
                        _key(0.0, joints={"j_tip": JointPose(rot=0.0)}),
                        _key(1.0, joints={"j_tip": JointPose(rot=25.0)}),
                    ],
                    frame_count=frame_count,
                    loop=True,
                )
            ],
        )
        return document, data

    def test_png_zip_carries_a_readme_and_padded_names(self) -> None:
        document, data = self._rig(frame_count=12)
        result = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_1", clip_id="clip_test"
        )

        with zipfile.ZipFile(io.BytesIO(result.artifact.data)) as archive:
            names = sorted(archive.namelist())
            readme = archive.read(RenderConstants.PNG_ZIP_README_NAME).decode("utf-8")

        self.assertIn(RenderConstants.PNG_ZIP_README_NAME, names)
        self.assertIn("frame-00.png", names)
        self.assertIn("frame-11.png", names)
        self.assertIn("No image generation was used", readme)

    def test_gif_reserves_a_transparent_palette_slot(self) -> None:
        document, data = self._rig(frame_count=4)
        result = RenderService.run(
            document,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            fmt=RenderConstants.FORMAT_GIF,
        )

        self.assertEqual(result.report.served_format, RenderConstants.FORMAT_GIF)
        self.assertEqual(result.artifact.mime_type, "image/gif")
        self.assertTrue(result.artifact.data.startswith(b"GIF8"))

        with Image.open(io.BytesIO(result.artifact.data)) as gif:
            self.assertEqual(gif.n_frames, 4)
            self.assertEqual(
                gif.info.get("transparency"),
                RenderConstants.GIF_TRANSPARENT_INDEX,
            )
            frame = np.asarray(gif.convert("RGBA"))

        self.assertEqual(int(frame[2, 2, 3]), 0, "the empty corner stays empty")
        self.assertGreater(int(frame[32, 32, 3]), 0, "the figure is drawn")

    def test_gif_is_capped_to_the_export_edge(self) -> None:
        document, data = self._rig(frame_count=2)
        result = RenderService.run(
            document,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            fmt=RenderConstants.FORMAT_GIF,
            max_edge=4096,
        )

        self.assertLessEqual(result.artifact.width, RenderConstants.MAX_GIF_EDGE)
        self.assertLessEqual(result.artifact.height, RenderConstants.MAX_GIF_EDGE)

    def test_mp4_mattes_a_transparent_request(self) -> None:
        """H.264 has no alpha, so the matte is applied and the caller is told."""
        document, data = self._rig(frame_count=2)
        try:
            result = RenderService.run(
                document,
                data,
                project_id=PROJECT,
                revision_id="rev_1",
                clip_id="clip_test",
                fmt=RenderConstants.FORMAT_MP4,
            )
        except RenderError as error:  # pragma: no cover - no ffmpeg on this host
            self.skipTest(f"ffmpeg unavailable: {error}")

        self.assertTrue(
            any("cannot carry an alpha channel" in w for w in result.report.warnings),
            result.report.warnings,
        )
        if result.report.served_format == RenderConstants.FORMAT_MP4:
            self.assertEqual(result.artifact.mime_type, "video/mp4")
            self.assertGreater(result.artifact.byte_length, 0)
        else:
            self.assertEqual(
                result.report.served_format, RenderConstants.FALLBACK_FORMAT
            )

    def test_webm_keeps_alpha_through_a_decode_round_trip(self) -> None:
        """VP9 is offered specifically because it carries an alpha plane.

        Asserted by decoding the encoded file back rather than by trusting the
        ``-pix_fmt yuva420p`` argument: ffmpeg accepts that flag whether or not
        the alpha plane survives muxing, and a WebM that silently lost its
        transparency looks correct in every check short of this one.
        """
        document, data = self._rig(frame_count=3)
        result = RenderService.run(
            document,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
            fmt=RenderConstants.FORMAT_WEBM,
        )

        if result.report.served_format != RenderConstants.FORMAT_WEBM:
            self.skipTest("ffmpeg unavailable; the PNG-zip fallback fired as designed")
        self.assertEqual(result.artifact.mime_type, "video/webm")
        self.assertTrue(result.artifact.data.startswith(b"\x1a\x45\xdf\xa3"), "EBML header")

        decoded = _decode_first_frame(result.artifact.data, result.artifact)
        if decoded is None:  # pragma: no cover - decoder-dependent
            self.skipTest("no VP9 decoder available to verify the alpha plane")
        self.assertEqual(int(decoded[2, 2, 3]), 0, "the empty corner stayed empty")
        self.assertGreater(int(decoded[32, 32, 3]), 200, "the figure stayed opaque")

    def test_missing_ffmpeg_falls_back_to_the_png_zip(self) -> None:
        """F9 8.5: a missing encoder degrades, it does not fail the stage."""
        document, data = self._rig(frame_count=2)
        original = Encoders.webm

        def unavailable(*args, **kwargs):
            raise EncoderUnavailable("no ffmpeg for this test")

        Encoders.webm = staticmethod(unavailable)  # type: ignore[method-assign]
        try:
            result = RenderService.run(
                document,
                data,
                project_id=PROJECT,
                revision_id="rev_1",
                clip_id="clip_test",
                fmt=RenderConstants.FORMAT_WEBM,
            )
        finally:
            Encoders.webm = original  # type: ignore[method-assign]

        self.assertEqual(result.report.requested_format, RenderConstants.FORMAT_WEBM)
        self.assertEqual(
            result.report.served_format, RenderConstants.FALLBACK_FORMAT
        )
        self.assertEqual(result.artifact.mime_type, "application/zip")
        self.assertEqual(len(_zip_frames(result.artifact.data)), 2)
        self.assertTrue(
            any("fell back" in warning for warning in result.report.warnings),
            result.report.warnings,
        )

    def test_unknown_format_is_refused(self) -> None:
        document, data = self._rig(frame_count=2)
        with self.assertRaises(RenderError):
            RenderService.run(
                document, data, project_id=PROJECT, revision_id="rev_1", fmt="tiff"
            )


# --- Storage handoff -------------------------------------------------------


class ArtifactHandoffTests(RenderTestCase):
    def test_small_artifact_rides_inline_as_base64(self) -> None:
        sheet = _sheet_rgba([((30, 30, 34, 34), (1, 2, 3, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.46875, 0.46875, 0.0625, 0.0625), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(
            document, data, project_id=PROJECT, revision_id="rev_1", max_edge=32
        )
        hint = RenderService.artifact_hint(result)

        self.assertLessEqual(
            result.artifact.byte_length, RenderConstants.ARTIFACT_INLINE_MAX_BYTES
        )
        self.assertIsInstance(hint["contentBase64"], str)
        self.assertEqual(hint["kind"], RenderConstants.ARTIFACT_KIND)
        self.assertEqual(hint["cacheKey"], result.cache_key)
        self.assertTrue(str(hint["downloadPath"]).endswith(result.cache_key))

    def test_large_artifact_is_handed_off_as_a_download_path(self) -> None:
        """Above the inline cap, Node gets a stream path instead of base64.

        Documented deviation from the infra slice's base64 contract; the reason
        is on ``RenderService.artifact_hint``. Node stays the storage owner
        either way.
        """
        document, data = EncoderTestsHelper.noisy_rig()
        result = RenderService.run(
            document,
            data,
            project_id=PROJECT,
            revision_id="rev_1",
            clip_id="clip_test",
        )
        hint = RenderService.artifact_hint(result)

        self.assertGreater(
            result.artifact.byte_length, RenderConstants.ARTIFACT_INLINE_MAX_BYTES
        )
        self.assertIsNone(hint["contentBase64"])
        self.assertEqual(
            hint["downloadPath"],
            RenderConstants.ARTIFACT_DOWNLOAD_PATH_TEMPLATE.format(
                cache_key=result.cache_key
            ),
        )
        self.assertIsNotNone(RenderCache.get(result.cache_key))


class EncoderTestsHelper:
    """A rig big enough to exceed the inline artifact cap."""

    @staticmethod
    def noisy_rig():
        rng = np.random.default_rng(7)
        size = 256
        sheet = np.zeros((size, size, 4), dtype=np.uint8)
        # Random noise so PNG cannot compress the frames away, which is what
        # makes the payload reliably exceed the inline threshold.
        sheet[32:224, 32:224, :3] = rng.integers(
            0, 256, size=(192, 192, 3), dtype=np.uint8
        )
        sheet[32:224, 32:224, 3] = 255
        data = _png_bytes(sheet)
        document = _document(
            _asset(data, size=size),
            [_part("p", (0.125, 0.125, 0.75, 0.75), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
            clips=[
                _clip(
                    [
                        _key(0.0, joints={"j_root": JointPose(rot=0.0)}),
                        _key(1.0, joints={"j_root": JointPose(rot=10.0)}),
                    ],
                    frame_count=6,
                )
            ],
        )
        return document, data


# --- Adapter deltas --------------------------------------------------------


class AdapterTests(RenderTestCase):
    def test_jointless_rig_gets_a_synthesized_root(self) -> None:
        """A prop rig legitimately has no skeleton, and must still render."""
        sheet = _sheet_rgba([((16, 16, 48, 48), (200, 200, 200, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p",
                    (0.25, 0.25, 0.5, 0.5),
                    deformer=DeformerRigid(kind="rigid"),
                    bound_joint=None,
                )
            ],
            [],
        )

        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")
        frame = _zip_frames(result.artifact.data)[0]

        np.testing.assert_array_equal(frame, sheet)
        self.assertTrue(
            any("synthesized" in warning for warning in result.report.warnings),
            result.report.warnings,
        )

    def test_part_local_verts_are_lifted_to_sheet_space(self) -> None:
        """Delta 2: a mesh authored in part-local units lands inside its rect.

        The whole point of part-local coordinates is that moving ``rect`` moves
        the artwork without touching a vertex. If the adapter forgot the
        conversion, a unit-square mesh would cover the whole sheet instead of the
        rect, so this asserts the pixels outside the rect stay empty.
        """
        sheet = _sheet_rgba([((32, 32, 48, 48), (0, 0, 0, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p",
                    (0.5, 0.5, 0.25, 0.25),
                    deformer=_mesh_deformer(["j_root->j_tip"]),
                )
            ],
            [
                _joint("j_root", 0.5, 0.5),
                _joint("j_tip", 0.75, 0.5, parent="j_root"),
            ],
        )

        adapted = RigAdapter.to_kernel(document)
        verts = np.asarray(adapted.kernel_rig.parts[0].deformer.verts, dtype=np.float64)

        np.testing.assert_allclose(verts.min(axis=0), [0.5, 0.5], atol=1e-6)
        np.testing.assert_allclose(verts.max(axis=0), [0.75, 0.75], atol=1e-6)

    def test_bound_joint_fallback_is_reported(self) -> None:
        sheet = _sheet_rgba([((16, 16, 48, 48), (9, 9, 9, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [
                _part(
                    "p",
                    (0.25, 0.25, 0.5, 0.5),
                    deformer=DeformerRigid(kind="rigid"),
                    bound_joint="j_nowhere",
                )
            ],
            [_joint("j_root", 0.5, 0.5)],
        )

        result = RenderService.run(document, data, project_id=PROJECT, revision_id="rev_1")

        self.assertTrue(
            any("j_nowhere" in warning for warning in result.report.warnings),
            result.report.warnings,
        )


# --- Endpoint ---------------------------------------------------------------


class EndpointTests(RenderTestCase):
    """The HTTP surface, mounted without ``app.main``.

    The router alone rather than the whole app, matching the rig stage's own
    endpoint tests: pulling in ``app.main`` would drag the rate limiter and the
    internal-token middleware into a test about request shapes. The token
    middleware is exercised where it lives.
    """

    def _client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from app.modules.anibuddy.router import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def _rig(self):
        sheet = _sheet_rgba([((16, 16, 48, 48), (33, 66, 99, 255))])
        data = _png_bytes(sheet)
        document = _document(
            _asset(data),
            [_part("p", (0.25, 0.25, 0.5, 0.5), deformer=DeformerRigid(kind="rigid"))],
            [_joint("j_root", 0.5, 0.5)],
        )
        return document, data

    def _post(self, client, document, data, **overrides):
        body = {
            "document": document.model_dump(mode="json"),
            "projectId": PROJECT,
            "revisionId": "rev_http",
            "revisionIndex": 1,
            "format": RenderConstants.FORMAT_GIF,
            **overrides,
        }
        import json as json_module

        # The envelope rides as a FILE part, not a form field: Starlette caps a
        # non-file part at 1 MB and a 64-part document exceeds that on its own.
        return client.post(
            "/anibuddy/render",
            files={
                "request": (
                    "request.json",
                    json_module.dumps(body).encode("utf-8"),
                    "application/json",
                ),
                "image": ("sheet.png", data, "image/png"),
            },
        )

    def test_render_endpoint_returns_document_and_artifact(self) -> None:
        client = self._client()
        document, data = self._rig()

        response = self._post(client, document, data)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["document"]["schemaVersion"], 5)
        self.assertEqual(payload["document"]["revision"]["reason"], "render")
        self.assertEqual(payload["requestedFormat"], RenderConstants.FORMAT_GIF)
        self.assertEqual(payload["servedFormat"], RenderConstants.FORMAT_GIF)
        self.assertFalse(payload["cacheHit"])
        self.assertEqual(payload["artifact"]["mimeType"], "image/gif")
        self.assertEqual(payload["artifact"]["cacheKey"], payload["cacheKey"])
        self.assertIsInstance(payload["artifact"]["contentBase64"], str)

    def test_second_identical_request_reports_a_cache_hit(self) -> None:
        client = self._client()
        document, data = self._rig()

        first = self._post(client, document, data).json()
        second = self._post(client, document, data).json()

        self.assertFalse(first["cacheHit"])
        self.assertTrue(second["cacheHit"])
        self.assertEqual(first["cacheKey"], second["cacheKey"])
        self.assertEqual(
            first["artifact"]["contentHash"], second["artifact"]["contentHash"]
        )

    def test_artifact_download_streams_the_same_bytes(self) -> None:
        client = self._client()
        document, data = self._rig()

        payload = self._post(client, document, data).json()
        download = client.get(payload["artifact"]["downloadPath"])

        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.headers["content-type"], "image/gif")
        self.assertEqual(
            hashlib.sha256(download.content).hexdigest(),
            payload["artifact"]["contentHash"],
        )

    def test_evicted_artifact_is_a_404(self) -> None:
        client = self._client()
        document, data = self._rig()
        payload = self._post(client, document, data).json()

        RenderCache.clear()
        download = client.get(payload["artifact"]["downloadPath"])

        self.assertEqual(download.status_code, 404)
        self.assertIn("re-request", download.json()["detail"])

    def test_blocked_document_is_a_422_naming_the_reason(self) -> None:
        client = self._client()
        document, data = self._rig()
        blocked = document.model_copy(
            update={
                "diagnostics": document.diagnostics.model_copy(
                    update={"blockingReason": "This rig has no skeleton yet."}
                )
            }
        )

        response = self._post(client, blocked, data)

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "This rig has no skeleton yet.")

    def test_empty_upload_is_a_422(self) -> None:
        client = self._client()
        document, _ = self._rig()

        response = self._post(client, document, b"")

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
