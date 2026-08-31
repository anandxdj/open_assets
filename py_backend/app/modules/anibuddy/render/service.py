"""Render stage orchestration: pose, rasterize, encode, disclose.

Pipeline, matching F9 §8.5
-------------------------
1. **Refuse before spending a frame.** A non-null inbound
   ``diagnostics.blockingReason`` means an earlier stage already found the
   document unrenderable, and the render must not talk its way past that gate.
2. Resolve the clip and the render options, clamped once (``options.py``).
3. Derive the content-hash cache key and serve a hit without touching pixels.
4. Adapt the wire document into kernel input (``adapter.py``).
5. Crop and mask-gate each part's source pixels once (``rasterize.py``).
6. Sample the clip: joint channels through the parity-locked kernel, part
   compositing channels through ``partpose.py``.
7. Rasterize each frame lazily and stream it into the encoder (``encode.py``),
   falling back to the PNG zip if ffmpeg is missing or fails.
8. Author ``diagnostics`` — including the distortion the render actually
   measured — and write a child revision.

Where the two halves of a ``PartPose`` are sampled
--------------------------------------------------
``PartPose`` carries eight channels and they split by responsibility:

* ``rot``, ``tx``, ``ty`` and ``scale`` move vertices, so they belong to the
  parity-locked kernel. They are sampled by ``PoseTrack.part_pose_at`` and
  applied by the part transform tree (``kernel/parts.py``), which means the
  browser preview reproduces them exactly (R4).
* ``visible``, ``opacity``, ``zIndex`` and ``swapTo`` decide which layers are
  drawn, in what order, how strongly and out of whose pixels. That is
  compositing, so they stay in ``partpose.py`` — which is mirrored by the
  browser's ``part-track.ts`` and held to it by the compositing parity corpus in
  ``fixtures/anibuddy-compositing/``. Rasterization is per-target; deciding what
  to rasterize is not.

Both halves bracket through the same ``PoseTrack.bracket_index``, so a part and
a joint keyed on the same clip resolve at the same instant.

Storage handoff
---------------
Node stays the ``StorageAdapter`` owner. What changes for render, and why, is
documented on ``RenderService.artifact_hint``.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from typing import Dict, Iterator, List, Optional, Tuple

import cv2
import numpy as np

from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.kernel import AniBuddyKernel, PoseTrack
from app.modules.anibuddy.render.adapter import RigAdapter
from app.modules.anibuddy.render.cache import RenderCache
from app.modules.anibuddy.render.encode import Encoders
from app.modules.anibuddy.render.options import RenderOptionsResolver
from app.modules.anibuddy.render.partpose import PartPoseTrack
from app.modules.anibuddy.render.rasterize import Rasterizer
from app.modules.anibuddy.render.types import (
    EncoderUnavailable,
    FrameStats,
    PartComposite,
    RenderArtifact,
    RenderError,
    RenderOptions,
    RenderReport,
)
from app.modules.anibuddy.schemas import (
    Clip,
    Diagnostics,
    DocumentProvenance,
    RevisionLink,
    RigDocument,
    StageRecord,
)

_OPAQUE: int = 255


def _utcnow_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def decode_sheet(data: bytes) -> np.ndarray:
    """Decode the source sheet to straight uint8 RGBA.

    OpenCV hands back BGR(A) or single-channel grey. Normalizing to RGBA here
    means one channel-order conversion for the whole stage rather than one per
    consumer, and RGBA specifically because that is what Pillow and the raw-video
    pipe both want at the other end.

    Synthesizing a fully opaque alpha channel for an image that has none is a
    layout fix, not a pixel invent (R2/R8): every opaque pixel stays exactly the
    colour it was, and no pixel becomes something it was not.
    """
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if decoded is None:
        raise RenderError("The source sheet could not be decoded.")

    if decoded.ndim == 2:
        grey = decoded
        alpha = np.full(grey.shape, _OPAQUE, dtype=np.uint8)
        return np.dstack([grey, grey, grey, alpha])
    if decoded.ndim == 3 and decoded.shape[2] == 3:
        rgb = cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
        alpha = np.full(decoded.shape[:2], _OPAQUE, dtype=np.uint8)
        return np.dstack([rgb, alpha])
    if decoded.ndim == 3 and decoded.shape[2] == 4:
        return cv2.cvtColor(decoded, cv2.COLOR_BGRA2RGBA)
    raise RenderError(f"Unsupported sheet shape {decoded.shape}.")


class RenderResult:
    """What the endpoint needs: a child revision, an artifact, and the report."""

    __slots__ = ("document", "artifact", "report", "cache_key", "options")

    def __init__(
        self,
        *,
        document: RigDocument,
        artifact: RenderArtifact,
        report: RenderReport,
        cache_key: str,
        options: RenderOptions,
    ) -> None:
        self.document = document
        self.artifact = artifact
        self.report = report
        self.cache_key = cache_key
        self.options = options


class RenderService:
    """Public service surface for the render stage."""

    __slots__ = ()

    @staticmethod
    def run(
        document: RigDocument,
        sheet_bytes: bytes,
        *,
        project_id: str,
        revision_id: str,
        clip_id: Optional[str] = None,
        fmt: str = RenderConstants.FALLBACK_FORMAT,
        fps: Optional[int] = None,
        frame_count: Optional[int] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        max_edge: Optional[int] = None,
        background: str = RenderConstants.BACKGROUND_TRANSPARENT,
        loop: Optional[bool] = None,
        parent_revision_id: Optional[str] = None,
        revision_index: int = 0,
        pass_index: int = 0,
        usage_event_id: Optional[str] = None,
    ) -> RenderResult:
        started = _utcnow_iso()
        report = RenderReport(requested_format=fmt, served_format=fmt)

        RenderService._refuse_if_blocked(document)
        clip = RenderService._clip(document, clip_id)
        options = RenderOptionsResolver.resolve(
            document,
            clip,
            fmt=fmt,
            fps=fps,
            frame_count=frame_count,
            width=width,
            height=height,
            max_edge=max_edge,
            background=background,
            loop=loop,
            warn=report.warn,
        )

        # The cache key is derived before any pixel is touched, which is the
        # whole point: a re-render of an unchanged rig costs one hash.
        cache_key = RenderCache.key(document, clip, options)
        cached = RenderCache.get(cache_key)
        if cached is not None:
            artifact = cached
            report.cache_hit = True
            report.served_format = cached.fmt
            # Stats ride on the artifact so a hit still authors honest
            # diagnostics rather than a clean bill of health for a frame nobody
            # re-measured.
            report.stats = cached.stats
        else:
            artifact = RenderService._render(
                document,
                sheet_bytes,
                clip=clip,
                options=options,
                report=report,
                project_id=project_id,
                cache_key=cache_key,
            )
            RenderCache.put(cache_key, artifact)

        return RenderResult(
            document=RenderService._child_revision(
                document,
                report=report,
                options=options,
                artifact=artifact,
                cache_key=cache_key,
                started=started,
                project_id=project_id,
                revision_id=revision_id,
                parent_revision_id=parent_revision_id,
                revision_index=revision_index,
                pass_index=pass_index,
                usage_event_id=usage_event_id,
            ),
            artifact=artifact,
            report=report,
            cache_key=cache_key,
            options=options,
        )

    # --- Gates ------------------------------------------------------------

    @staticmethod
    def _refuse_if_blocked(document: RigDocument) -> None:
        """F9 §8.5: a non-null ``blockingReason`` refuses before a frame is spent.

        Checked server-side, on the document as received, because
        ``Diagnostics.blockingReason`` is the export gate (§7.8) and a gate a
        caller can route around by not sending it is advice, not a gate.
        """
        reason = document.diagnostics.blockingReason
        if reason:
            raise RenderError(reason)

    @staticmethod
    def _clip(document: RigDocument, clip_id: Optional[str]) -> Optional[Clip]:
        """The requested clip, or None for a still at rest.

        An unknown clip id is refused rather than falling back to the first clip
        or to rest: a caller that asked for "walk" and silently got "idle" has no
        way to notice, and the frames look deliberate.
        """
        if clip_id is None:
            return None
        for clip in document.clips:
            if clip.id == clip_id:
                return clip
        available = ", ".join(clip.id for clip in document.clips) or "none"
        raise RenderError(
            f'This rig has no clip "{clip_id}". Available clips: {available}.'
        )

    @staticmethod
    def _refuse_if_over_budget(
        document: RigDocument,
        options: RenderOptions,
        composites: List[List[PartComposite]],
    ) -> None:
        """Refuse a render that cannot finish inside the request budget.

        The rasterizer's cost tracks the destination AREA each layer covers, not
        the triangle count — twelve limb-shaped parts and twelve full-sheet parts
        at identical triangle counts differ by an order of magnitude. So a rig
        that is legitimate in every other respect (64 full-sheet parallax layers,
        120 frames, 2048px) can still be a job that no request handler can
        finish.

        Estimated from the layers that actually composite, so a clip that hides
        most of its parts is charged for what it draws. The alternative to
        refusing is a gateway timeout, which loses the work and explains nothing;
        this names the two levers — fewer frames, smaller output — that fix it.
        """
        area_by_part = {
            part.id: float(part.rect.width) * float(part.rect.height)
            for part in document.parts
        }
        surface_pixels = float(options.surface.pixels)
        # Keyed on the GEOMETRY owner, not the texture owner: a swapped layer
        # covers its own rect and samples someone else's, so the destination
        # area — which is what the rasterizer's cost actually tracks — is the
        # referring part's.
        pixels = sum(
            area_by_part.get(entry.part_id, 0.0) * surface_pixels
            for frame in composites
            for entry in frame
        )
        estimate = pixels / RenderConstants.RASTER_PIXELS_PER_SECOND
        if estimate <= RenderConstants.RASTER_BUDGET_SECONDS:
            return

        raise RenderError(
            f"This render is estimated at {estimate:.0f}s of rasterization, over "
            f"the {RenderConstants.RASTER_BUDGET_SECONDS:.0f}s budget: "
            f"{len(composites)} frame(s) of layers covering "
            f"{pixels / max(1, len(composites)) / 1e6:.1f} megapixels each. "
            "Lower the frame count or the output size and try again."
        )

    # --- Render -----------------------------------------------------------

    @staticmethod
    def _render(
        document: RigDocument,
        sheet_bytes: bytes,
        *,
        clip: Optional[Clip],
        options: RenderOptions,
        report: RenderReport,
        project_id: str,
        cache_key: str,
    ) -> RenderArtifact:
        sheet = decode_sheet(sheet_bytes)
        sheet_h, sheet_w = sheet.shape[:2]
        if sheet_w != document.asset.width or sheet_h != document.asset.height:
            # Refused rather than rescaled. Every vertex in the document is
            # normalized against the declared dimensions, so rendering against a
            # differently-sized sheet shifts the whole rig by the ratio and looks
            # like a rigging error rather than a mismatched upload.
            raise RenderError(
                f"The uploaded sheet is {sheet_w}x{sheet_h} but the document "
                f"declares {document.asset.width}x{document.asset.height}."
            )

        adapted = RigAdapter.to_kernel(document)
        for note in adapted.notes:
            report.warn(note)

        sources = Rasterizer.part_sources(document, sheet, report.warn)
        times = RenderService._sample_times(clip, options)
        kernel_clip = None if clip is None else RigAdapter.clip_to_kernel(clip)
        composites = PartPoseTrack.sample(
            list(document.parts), clip, times, report.warn
        )
        RenderService._refuse_if_over_budget(document, options, composites)

        def frames() -> Iterator[np.ndarray]:
            """Rasterize lazily, one frame resident at a time.

            A generator rather than a list because a 120-frame clip at
            ``MAX_OUTPUT_EDGE`` is gigabytes of RGBA. The encoders consume this
            in one pass; only the GIF encoder holds the sequence, and only
            because a shared palette requires it.
            """
            for index, time in enumerate(times):
                pose = (
                    {}
                    if kernel_clip is None
                    else PoseTrack.pose_at(kernel_clip, time)
                )
                part_pose = (
                    {}
                    if kernel_clip is None
                    else PoseTrack.part_pose_at(kernel_clip, time)
                )
                kernel_frame = AniBuddyKernel.evaluate(
                    adapted.kernel_rig,
                    pose,
                    options.surface.scale_x,
                    options.surface.scale_y,
                    part_pose,
                )
                geometry = Rasterizer.index_geometry(kernel_frame)
                pixels, stats = Rasterizer.frame(
                    geometry,
                    composites[index],
                    sources,
                    options.surface,
                    options.background,
                    sheet_w,
                    sheet_h,
                )
                report.stats.absorb(stats)
                yield pixels

        data, served = RenderService._encode(frames, options, report)
        return RenderService._artifact(
            data,
            fmt=served,
            options=options,
            project_id=project_id,
            cache_key=cache_key,
            stats=report.stats,
        )

    @staticmethod
    def _sample_times(clip: Optional[Clip], options: RenderOptions) -> List[float]:
        """Normalized times to sample, mirroring ``PoseTrack.sample``.

        Computed here rather than delegated because the part channels need the
        same instants as the joint channels, and the kernel's sampler returns
        poses rather than times. The formulas are the kernel's verbatim: a
        looping clip samples ``i / count`` so the last frame is one step short of
        the start and the wrap is seamless; a one-shot samples ``i / (count - 1)``
        so it actually reaches its final key.
        """
        count = options.frame_count
        if clip is None or count <= 1:
            return [0.0] * max(1, count)
        if options.loop:
            return [index / count for index in range(count)]
        return [index / (count - 1) for index in range(count)]

    @staticmethod
    def _encode(frames, options: RenderOptions, report: RenderReport) -> Tuple[bytes, str]:
        """Encode, falling back to the PNG zip when an encoder is unavailable.

        F9 §8.5 names this fallback explicitly, and it is why the PNG zip is
        first in ``RenderConstants.FORMATS``: it is the only encoder with no
        external dependency, so it is the only one that can be the floor. The
        served format is reported rather than silently substituted — a caller
        that asked for MP4 and got a zip needs to know before it sets a
        ``video/mp4`` content type on it.
        """
        try:
            return Encoders.encode(options.fmt, frames, options, report.warn), options.fmt
        except EncoderUnavailable as error:
            if options.fmt == RenderConstants.FALLBACK_FORMAT:
                raise RenderError(f"Rendering failed: {error}") from error
            report.warn(
                f"{options.fmt} encoding was unavailable ({error}); the render "
                f"fell back to {RenderConstants.FALLBACK_FORMAT}."
            )
            report.served_format = RenderConstants.FALLBACK_FORMAT
            fallback = RenderOptions(
                fmt=RenderConstants.FALLBACK_FORMAT,
                fps=options.fps,
                frame_count=options.frame_count,
                loop=options.loop,
                surface=options.surface,
                background=options.background,
                clip_id=options.clip_id,
            )
            return (
                Encoders.encode(fallback.fmt, frames, fallback, report.warn),
                fallback.fmt,
            )

    @staticmethod
    def _artifact(
        data: bytes,
        *,
        fmt: str,
        options: RenderOptions,
        project_id: str,
        cache_key: str,
        stats: FrameStats,
    ) -> RenderArtifact:
        """Wrap the encoded bytes with everything Node needs to store them.

        The storage key is content-addressed on the render cache key, which is
        what makes Node's upload idempotent: an unchanged rig re-renders to the
        same key, so the upload either overwrites itself with identical bytes or
        is skipped entirely.
        """
        return RenderArtifact(
            fmt=fmt,
            mime_type=RenderConstants.MIME_BY_FORMAT[fmt],
            data=data,
            content_hash=hashlib.sha256(data).hexdigest(),
            storage_key=RenderConstants.ARTIFACT_KEY_TEMPLATE.format(
                project_id=project_id,
                cache_key=cache_key,
                extension=RenderConstants.EXTENSION_BY_FORMAT[fmt],
            ),
            frame_count=options.frame_count,
            width=options.surface.width,
            height=options.surface.height,
            stats=stats,
        )

    # --- Document assembly -------------------------------------------------

    @staticmethod
    def _child_revision(
        document: RigDocument,
        *,
        report: RenderReport,
        options: RenderOptions,
        artifact: RenderArtifact,
        cache_key: str,
        started: str,
        project_id: str,
        revision_id: str,
        parent_revision_id: Optional[str],
        revision_index: int,
        pass_index: int,
        usage_event_id: Optional[str],
    ) -> RigDocument:
        """Write a child revision carrying the render's own diagnostics (R9)."""
        finished = _utcnow_iso()
        stats = report.stats

        if stats.max_stretch > RenderConstants.STRETCH_WARNING:
            # F9 §8.5: render anyway and DISCLOSE. v3 showed the problem rather
            # than hiding it, and hiding it is how a user ships a smeared frame
            # believing the tool approved of it.
            report.warn(
                f"Peak stretch reached {stats.max_stretch:.2f} (warning "
                f"threshold {RenderConstants.STRETCH_WARNING}); some artwork is "
                "being smeared out of shape. Re-check the mesh or ease the pose."
            )
        if stats.flipped_triangles:
            report.warn(
                f"{stats.flipped_triangles} triangle(s) turned inside out on the "
                "worst frame, so that artwork is drawn mirrored."
            )
        if stats.non_invertible_triangles:
            report.warn(
                f"{stats.non_invertible_triangles} triangle(s) collapsed to a "
                "line and could not be textured; they were left empty."
            )
        if stats.drawn_parts == 0:
            report.block(
                "Nothing was drawn: no part was both visible and inside the "
                "frame. Check part visibility and the pose."
            )

        diagnostics = Diagnostics(
            foregroundPixels=document.diagnostics.foregroundPixels,
            coveredForegroundPixels=document.diagnostics.coveredForegroundPixels,
            overlappingPartPairs=document.diagnostics.overlappingPartPairs,
            # Measured by this render, not carried forward. maxStretch and
            # flippedTriangles are the same metric v3's lib/deform.ts reported,
            # and they are only meaningful for the pose that was actually posed.
            maxStretch=float(stats.max_stretch),
            flippedTriangles=int(stats.flipped_triangles),
            isolatedVertices=document.diagnostics.isolatedVertices,
            warnings=report.warnings[: RenderConstants.MAX_WARNINGS],
            # Server authors the gate (§7.8, R5).
            blockingReason=report.blocking_reason(),
        )

        stage = StageRecord(
            stage="render",
            status="succeeded",
            startedAt=started,
            finishedAt=finished,
            inputHash=cache_key,
            passIndex=pass_index,
            modelId=None,
            usageEventId=usage_event_id,
            creditsSpent=0,
            message=RenderService._stage_message(report, options, artifact),
        )

        return document.model_copy(
            update={
                "id": revision_id,
                "projectId": project_id,
                "updatedAt": finished,
                "revision": RevisionLink(
                    index=revision_index,
                    parentRevisionId=parent_revision_id or document.id,
                    reason=RenderConstants.REVISION_REASON,
                    accepted=False,
                ),
                "provenance": DocumentProvenance(
                    pipelineVersion=RenderConstants.PIPELINE_VERSION,
                    kernelVersion=RenderConstants.KERNEL_VERSION,
                    # Oldest records drop first when the cap is reached: a
                    # critique loop appends a render record per pass, and the
                    # recent history is what explains the current revision.
                    stages=[
                        *document.provenance.stages[
                            -(RenderConstants.MAX_STAGE_RECORDS - 1) :
                        ],
                        stage,
                    ],
                ),
                "diagnostics": diagnostics,
            }
        )

    @staticmethod
    def _stage_message(
        report: RenderReport,
        options: RenderOptions,
        artifact: RenderArtifact,
    ) -> str:
        """One line naming what ran, at what size, and through which rasterizer.

        The rasterizer is named because rasterization is deliberately per-target
        (R4). When a support ticket says the export differs from the preview by a
        pixel, this string is what attributes it to the right half.
        """
        source = "cache" if report.cache_hit else RenderConstants.RASTERIZER
        return (
            f"render {artifact.frame_count} frame(s) at "
            f"{artifact.width}x{artifact.height} @{options.fps}fps as "
            f"{artifact.fmt} ({artifact.byte_length} bytes) via {source}"
        )

    # --- Storage handoff ---------------------------------------------------

    @staticmethod
    def artifact_hint(result: RenderResult) -> Dict[str, object]:
        """The artifact as Node's ``_persistArtifact`` wants it — with a deviation.

        **Node stays the ``StorageAdapter`` owner.** That is unchanged and worth
        keeping: py_backend has no provider credentials, and giving it some would
        put upload retry, folder policy and public-id derivation in two codebases.

        **What changes is how the bytes get there.** The infra slice has Python
        return ``artifact.contentBase64`` and Node upload it. That is right for a
        2 KB stage-result JSON and wrong for a render: base64 inflates by 4/3, so
        a 120-frame PNG zip becomes tens of megabytes of string inside a JSON
        body, buffered simultaneously by FastAPI's serializer, the socket, axios,
        and ``Buffer.from``. Four copies of the same tens of megabytes per
        in-flight job, multiplied by ``Config.anibuddy.workerConcurrency``.

        So the response carries ``contentBase64`` only while the payload is under
        ``ARTIFACT_INLINE_MAX_BYTES`` — which covers a GIF preview or a short
        contact sheet, and needs no Node change at all. Above it, the hint
        carries ``downloadPath`` instead: a ``GET`` on this same
        internal-token-protected service that streams the bytes once, straight
        into ``storage.upload()``.

        The follow-up Node needs for the streaming path is one branch in
        ``_persistArtifact``: when ``contentBase64`` is absent and
        ``downloadPath`` is present, fetch it with ``responseType: 'stream'`` and
        pass that to the adapter instead of a ``Buffer``. Until that lands, a
        large render still succeeds and still caches — Node records the
        content-addressed key without the upload, exactly as it already does when
        credentials are missing.
        """
        artifact = result.artifact
        inline = artifact.byte_length <= RenderConstants.ARTIFACT_INLINE_MAX_BYTES
        hint: Dict[str, object] = {
            "kind": RenderConstants.ARTIFACT_KIND,
            "suggestedStorageKey": artifact.storage_key,
            "contentHash": artifact.content_hash,
            "mimeType": artifact.mime_type,
            "byteLength": artifact.byte_length,
            "frameCount": artifact.frame_count,
            "width": artifact.width,
            "height": artifact.height,
            "format": artifact.fmt,
            "cacheKey": result.cache_key,
            "contentBase64": None,
            "downloadPath": RenderConstants.ARTIFACT_DOWNLOAD_PATH_TEMPLATE.format(
                cache_key=result.cache_key
            ),
        }
        if inline:
            hint["contentBase64"] = base64.b64encode(artifact.data).decode("ascii")
        return hint
