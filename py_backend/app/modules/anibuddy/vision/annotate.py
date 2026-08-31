"""Draw numbered part outlines over the user's own sheet.

This is the whole input to the ``semantics`` stage's vision call (F9 §8.2). It
exists because the model is being asked a question about *these* parts, not
about the picture in general: without the numbers it answers "there is an arm
here" and there is no way to bind that to the part the decompose stage found.

Three decisions worth reading before changing anything here.

**The numbers are a reasoning aid, not the answer key.** The model must reply
with the part ids from the legend, and the caller rejects any id that is not in
it. If the numbers were the reply protocol, an off-by-one in this file would
silently reassign every role in the rig.

**The composite is matted opaque.** A cutout sheet has transparent pixels, and
what a remote decoder fills those with is not something this pipeline gets to
know. Dark line art on an unknown matte is how a part becomes invisible to the
model, so the matte is chosen here and stated.

**Nothing here generates a pixel of artwork (R2).** Every pixel inside an
outline is a resampled pixel of the user's drawing; the only new pixels are the
strokes and the number badges. The source bytes are never written (R8).
"""

from __future__ import annotations

import io
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image

from app.modules.anibuddy.constants import VisionConstants
from app.modules.anibuddy.rig.raster import Raster, rect_pixel_bounds
from app.modules.anibuddy.rig.types import RigError
from app.modules.anibuddy.schemas import Part, RigDocument
from app.modules.anibuddy.vision.types import (
    AnnotatedSheet,
    PartOutline,
    VisionError,
    to_bgr,
)

_LABEL_FONT = cv2.FONT_HERSHEY_SIMPLEX


def _encode_png(rgb: np.ndarray) -> bytes:
    """RGB uint8 to PNG bytes.

    Pillow rather than ``cv2.imencode`` for the same reason the render encoders
    use it: ``imencode`` wants BGR and returns a numpy array, and converting
    back and forth around a one-line encode is where a channel swap hides.
    """
    buffer = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def _matte_to_rgb(sheet_rgba: np.ndarray, matte: Tuple[int, int, int]) -> np.ndarray:
    """Composite straight-alpha RGBA over an opaque matte, returning RGB.

    Straight alpha, not premultiplied: this is the decoded sheet as
    ``decode_sheet`` hands it over, and the one multiply here is the only place
    it is combined with a background.
    """
    rgb = sheet_rgba[:, :, :3].astype(np.float32)
    alpha = (sheet_rgba[:, :, 3].astype(np.float32) / 255.0)[:, :, None]
    background = np.array(matte, dtype=np.float32)[None, None, :]
    composited = rgb * alpha + background * (1.0 - alpha)
    return np.clip(np.rint(composited), 0, 255).astype(np.uint8)


def _fit_scale(width: int, height: int, max_edge: int) -> float:
    """Downscale factor that fits the longest edge, never upscaling.

    Never upscaling matters: enlarging a 96px sprite to 1024 spends image
    tokens on interpolation artifacts, and a role decision cannot be read out of
    an artifact that was not in the artwork.
    """
    longest = max(int(width), int(height))
    if longest <= 0:
        raise VisionError("The sheet has no dimensions to annotate.")
    return min(1.0, float(max_edge) / float(longest))


def _outline_polygon(
    part: Part,
    sheet_rgba: Optional[np.ndarray],
    sheet_w: int,
    sheet_h: int,
    scale: float,
) -> Tuple[Tuple[int, int], ...]:
    """The part's silhouette in annotated-sheet pixels.

    Traced from the resolved mask rather than drawn as the rect, because the
    rect of an overlapping part covers its neighbours and a box around three
    limbs tells the model nothing about which one it is being asked about. A
    mask that cannot be traced falls back to its rect, which is honest: the rect
    is what the decompose stage was sure of.
    """
    try:
        raster = Raster.for_part(part, sheet_rgba, sheet_w, sheet_h)
    except RigError:
        raster = None

    if raster is not None and raster.solid_pixels > 0:
        contours, _ = cv2.findContours(
            raster.mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if contours:
            largest = max(contours, key=cv2.contourArea)
            points = largest.reshape(-1, 2)
            lifted = [
                (
                    int(round((raster.origin_x + int(px)) * scale)),
                    int(round((raster.origin_y + int(py)) * scale)),
                )
                for px, py in points
            ]
            if len(lifted) >= 3:
                return tuple(lifted)

    x, y, width, height = rect_pixel_bounds(part, sheet_w, sheet_h)
    return (
        (int(round(x * scale)), int(round(y * scale))),
        (int(round((x + width) * scale)), int(round(y * scale))),
        (int(round((x + width) * scale)), int(round((y + height) * scale))),
        (int(round(x * scale)), int(round((y + height) * scale))),
    )


def _draw_label(canvas_bgr: np.ndarray, label: int, at: Tuple[int, int], scale: float) -> None:
    """A filled badge behind the number, so it survives on light artwork."""
    text = str(label)
    thickness = max(1, int(round(scale * 2)))
    (text_w, text_h), baseline = cv2.getTextSize(text, _LABEL_FONT, scale, thickness)
    pad = VisionConstants.ANNOTATION_LABEL_PAD_PX

    height, width = canvas_bgr.shape[:2]
    left = int(np.clip(at[0], 0, max(0, width - text_w - 2 * pad)))
    top = int(np.clip(at[1], 0, max(0, height - text_h - baseline - 2 * pad)))

    cv2.rectangle(
        canvas_bgr,
        (left, top),
        (left + text_w + 2 * pad, top + text_h + baseline + 2 * pad),
        to_bgr(VisionConstants.ANNOTATION_LABEL_BACKGROUND_RGB),
        thickness=cv2.FILLED,
    )
    cv2.putText(
        canvas_bgr,
        text,
        (left + pad, top + text_h + pad),
        _LABEL_FONT,
        scale,
        to_bgr(VisionConstants.ANNOTATION_LABEL_TEXT_RGB),
        thickness,
        lineType=cv2.LINE_AA,
    )


class SheetAnnotator:
    """Compose the numbered-outline sheet the semantics stage sends."""

    __slots__ = ()

    @staticmethod
    def annotate(
        document: RigDocument,
        sheet_rgba: np.ndarray,
        *,
        max_edge: int = VisionConstants.ANNOTATION_MAX_EDGE,
    ) -> AnnotatedSheet:
        """Draw every part's outline and number onto a matted copy of the sheet.

        Refuses rather than annotating nothing when the document has no parts:
        a semantics call on a partless sheet cannot produce a proposal that
        resolves against anything, so spending a vision call on it is spending
        a credit on a guaranteed rejection.
        """
        parts: Sequence[Part] = document.parts
        if not parts:
            raise VisionError(
                "This document has no parts to annotate; run the decompose "
                "stage before asking for semantics."
            )
        if len(parts) > VisionConstants.MAX_PARTS:
            raise VisionError(
                f"This document declares {len(parts)} parts, above the "
                f"{VisionConstants.MAX_PARTS}-part cap."
            )

        sheet_h, sheet_w = sheet_rgba.shape[:2]
        if sheet_w != int(document.asset.width) or sheet_h != int(document.asset.height):
            # Refused rather than rescaled, for the reason the render stage
            # refuses: every rect in the document is normalized against the
            # declared size, so a mismatched sheet puts every outline in the
            # wrong place and the model critiques the annotation, not the art.
            raise VisionError(
                f"The uploaded sheet is {sheet_w}x{sheet_h} but the document "
                f"declares {document.asset.width}x{document.asset.height}."
            )

        scale = _fit_scale(sheet_w, sheet_h, max_edge)
        matted = _matte_to_rgb(sheet_rgba, VisionConstants.ANNOTATION_MATTE_RGB)
        if scale < 1.0:
            matted = cv2.resize(
                matted,
                (max(1, int(round(sheet_w * scale))), max(1, int(round(sheet_h * scale)))),
                interpolation=cv2.INTER_AREA,
            )

        out_h, out_w = matted.shape[:2]
        longest = max(out_w, out_h)
        stroke = max(
            VisionConstants.ANNOTATION_MIN_STROKE_PX,
            int(round(longest * VisionConstants.ANNOTATION_STROKE_RATIO)),
        )
        label_scale = max(
            VisionConstants.ANNOTATION_MIN_LABEL_SCALE,
            longest * VisionConstants.ANNOTATION_LABEL_SCALE_RATIO,
        )

        canvas_bgr = cv2.cvtColor(matted, cv2.COLOR_RGB2BGR)
        outlines: List[PartOutline] = []
        warnings: List[str] = []

        for index, part in enumerate(parts):
            label = VisionConstants.ANNOTATION_FIRST_LABEL + index
            polygon = _outline_polygon(part, sheet_rgba, sheet_w, sheet_h, scale)
            cv2.polylines(
                canvas_bgr,
                [np.asarray(polygon, dtype=np.int32)],
                isClosed=True,
                color=to_bgr(VisionConstants.ANNOTATION_OUTLINE_RGB),
                thickness=stroke,
                lineType=cv2.LINE_AA,
            )
            label_x = min(point[0] for point in polygon)
            label_y = min(point[1] for point in polygon)
            _draw_label(canvas_bgr, label, (label_x, label_y), label_scale)
            outlines.append(
                PartOutline(
                    part_id=part.id,
                    label=label,
                    name=part.name,
                    polygon=polygon,
                    label_x=label_x,
                    label_y=label_y,
                )
            )
            if part.confidence < VisionConstants.CONFIDENCE_REVIEW_FLOOR:
                warnings.append(
                    f'Part {label} ("{part.name}") was decomposed with low '
                    "confidence, so its outline may not match what the artist drew."
                )

        annotated_rgb = cv2.cvtColor(canvas_bgr, cv2.COLOR_BGR2RGB)
        return AnnotatedSheet(
            png=_encode_png(annotated_rgb),
            width=out_w,
            height=out_h,
            outlines=tuple(outlines),
            warnings=warnings,
        )
