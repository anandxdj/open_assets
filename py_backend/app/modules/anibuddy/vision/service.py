"""Public service surface for the vision-facing stages.

Two entry points, one for each half of the propose-then-critique loop:

* ``annotate`` builds the numbered-outline sheet the ``semantics`` call sees.
* ``contact_sheet`` renders frames through the render stage and tiles them into
  the one image the ``critique`` call sees.

Why this calls ``RenderService`` in-process rather than over HTTP
---------------------------------------------------------------
The contact sheet is nine frames of the render stage's own output, and this
module runs inside the same worker the render endpoint does. Posting to our own
``/anibuddy/render`` to get them would double the serialization of a whole
``RigDocument``, re-upload the sheet bytes, and give the loop a second place to
time out — for no isolation gain, since a crash in the rasterizer takes the
process down either way.

What is preserved is the *contract*: this calls the same public
``RenderService.run`` the endpoint calls, with the same arguments, and reads only
its documented result. It does not reach into the rasterizer or the encoders. If
the render stage ever moves to its own service, this becomes an HTTP client and
nothing else changes.

Consent
-------
``AssetRef.remoteVisionConsented`` gates both entry points, and it is checked
here rather than at the caller. §7.3 blocks ``semantics``, ``animate`` and
``critique`` on it — those are the stages that send the user's artwork to a third
party — and a gate the caller can route around by not calling it is advice.
"""

from __future__ import annotations

import base64
from typing import List, Optional, Tuple

import numpy as np

from app.modules.anibuddy.constants import VisionConstants
from app.modules.anibuddy.render import RenderError, RenderService, decode_sheet
from app.modules.anibuddy.schemas import Clip, RigDocument
from app.modules.anibuddy.vision.annotate import SheetAnnotator
from app.modules.anibuddy.vision.contact_sheet import (
    ContactSheet,
    frames_from_png_zip,
    pick_frame_indices,
)
from app.modules.anibuddy.vision.types import (
    AnnotatedSheet,
    ContactSheetResult,
    VisionError,
)


def to_data_url(png: bytes, mime: str = VisionConstants.CONTACT_SHEET_MIME) -> str:
    """Base64 data URL, the form every LLM adapter's ``image_url`` part wants.

    Built here rather than in Node so the bytes cross the internal boundary once
    already in the shape the provider needs — re-encoding a 400 KB PNG on the
    way through is pure cost.
    """
    return VisionConstants.DATA_URL_TEMPLATE.format(
        mime=mime, payload=base64.b64encode(png).decode("ascii")
    )


class VisionService:
    """Build the images a vision call may see, and nothing else."""

    __slots__ = ()

    @staticmethod
    def annotate(
        document: RigDocument,
        sheet_bytes: bytes,
        *,
        max_edge: int = VisionConstants.ANNOTATION_MAX_EDGE,
    ) -> AnnotatedSheet:
        VisionService._require_consent(document, "semantics")
        return SheetAnnotator.annotate(
            document, decode_sheet(sheet_bytes), max_edge=max_edge
        )

    @staticmethod
    def contact_sheet(
        document: RigDocument,
        sheet_bytes: bytes,
        *,
        project_id: str,
        revision_id: str,
        clip_id: Optional[str] = None,
        parent_revision_id: Optional[str] = None,
        revision_index: int = 0,
        pass_index: int = 0,
        usage_event_id: Optional[str] = None,
        frames: int = VisionConstants.CONTACT_SHEET_FRAMES,
        tile_max_edge: int = VisionConstants.CONTACT_SHEET_TILE_MAX_EDGE,
    ) -> ContactSheetResult:
        """Render the clip and tile ``frames`` of it into one labelled image.

        The render is asked for exactly ``frames`` frames rather than the clip's
        own ``frameCount`` and then subsampled. Two reasons, and the second is
        the load-bearing one: it bounds what a critique pass costs regardless of
        clip length, and it makes the render's measured ``maxStretch`` a
        measurement of the poses the model is looking at rather than of poses it
        never saw.
        """
        VisionService._require_consent(document, "critique")

        try:
            result = RenderService.run(
                document,
                sheet_bytes,
                project_id=project_id,
                revision_id=revision_id,
                clip_id=clip_id,
                fmt=VisionConstants.CONTACT_SHEET_RENDER_FORMAT,
                frame_count=max(1, int(frames)),
                max_edge=tile_max_edge,
                background=VisionConstants.CONTACT_SHEET_BACKGROUND,
                parent_revision_id=parent_revision_id,
                revision_index=revision_index,
                pass_index=pass_index,
                usage_event_id=usage_event_id,
            )
        except RenderError as error:
            # Re-typed rather than propagated so one caller-visible error class
            # covers the whole vision surface. The message is the render stage's
            # own sentence, which is the part the user needs.
            raise VisionError(str(error)) from error

        decoded = frames_from_png_zip(result.artifact.data)
        wanted = max(1, int(frames))
        indices = pick_frame_indices(len(decoded), wanted)
        selected = [decoded[index] for index in indices]

        clip = VisionService._clip(result.document, clip_id)
        times = VisionService._times(clip, len(decoded), indices)

        png, width, height, columns, rows = ContactSheet.compose(
            selected, times, tile_max_edge=tile_max_edge
        )

        warnings: List[str] = list(result.report.warnings)
        if len(decoded) < wanted:
            warnings.append(
                f"This clip renders only {len(decoded)} distinct frame(s), so the "
                f"{wanted}-tile contact sheet repeats poses."
            )

        return ContactSheetResult(
            png=png,
            width=width,
            height=height,
            columns=columns,
            rows=rows,
            frame_count=len(selected),
            frame_times=tuple(times),
            document=result.document,
            max_stretch=float(result.document.diagnostics.maxStretch),
            flipped_triangles=int(result.document.diagnostics.flippedTriangles),
            blocking_reason=result.document.diagnostics.blockingReason,
            cache_key=result.cache_key,
            warnings=warnings,
        )

    # --- Internal ----------------------------------------------------------

    @staticmethod
    def _require_consent(document: RigDocument, stage: str) -> None:
        if not document.asset.remoteVisionConsented:
            raise VisionError(
                f"This sheet has not been cleared for remote vision, so the "
                f"{stage} stage cannot run. The geometry stages are unaffected."
            )

    @staticmethod
    def _clip(document: RigDocument, clip_id: Optional[str]) -> Optional[Clip]:
        if clip_id is None:
            return None
        for clip in document.clips:
            if clip.id == clip_id:
                return clip
        return None

    @staticmethod
    def _times(
        clip: Optional[Clip], rendered: int, indices: Tuple[int, ...]
    ) -> List[float]:
        """Normalized clip time of each selected frame.

        Derived from the frame index rather than from the keyframes, because that
        is what the render stage sampled: a tile labelled ``t=0.50`` has to be
        the pose the sampler produced at 0.5, or a ``keyframe-retime`` derived
        from the label lands somewhere else.
        """
        if clip is None or rendered <= 1:
            return [0.0 for _ in indices]
        span = float(rendered - 1)
        return [float(index) / span for index in indices]


def sheet_shape(sheet_bytes: bytes) -> Tuple[int, int]:
    """Decoded ``(width, height)`` of a sheet, for a caller that only needs size."""
    decoded: np.ndarray = decode_sheet(sheet_bytes)
    return int(decoded.shape[1]), int(decoded.shape[0])
