"""Internal value objects for the two vision-facing image builders and the
corrections applier.

Deliberately not the wire schema, for the reason ``render/types.py`` is not:
these carry decoded pixel buffers and per-correction bookkeeping that has no
place in a ``RigDocument``, and keeping them separate is what lets the tiler and
the applier be unit-tested without constructing a whole document.

Coordinate spaces, stated rather than inferred (R6)
--------------------------------------------------
* ``PartOutline.polygon`` is in SHEET PIXELS at the ANNOTATED sheet's
  resolution, not at source resolution — the annotator downsamples first, so a
  vertex is already where it will be drawn.
* ``ContactSheetResult.frame_times`` are NORMALIZED clip times in 0..1, the same
  space ``Keyframe.t`` uses, so a ``keyframe-retime`` correction the model
  derives from a tile index lands in the units the document speaks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np


class VisionError(ValueError):
    """A vision-facing request that cannot be served, refused rather than repaired.

    Same intent as ``RenderError`` and ``RigError``: a refusal naming what is
    wrong is recoverable, and a plausible wrong answer is not. Callers surface
    the message verbatim, so every raise site writes a sentence for a person.
    """


@dataclass(frozen=True, slots=True)
class PartOutline:
    """One numbered part outline drawn onto the annotated sheet.

    ``label`` is the number the model sees; ``part_id`` is what it must answer
    with. Both travel back in the legend so the caller can reject a proposal
    that invented an id — which is the only reason the number exists at all.
    """

    part_id: str
    label: int
    name: str
    #: Closed polyline, flat [(x, y), ...] in annotated-sheet pixels.
    polygon: Tuple[Tuple[int, int], ...]
    #: Where the number badge was drawn, annotated-sheet pixels.
    label_x: int
    label_y: int


@dataclass(eq=False, slots=True)
class AnnotatedSheet:
    """The user's own sheet with numbered part outlines drawn over it.

    R2/R8 both apply here and neither is subtle: the source bytes are untouched
    on disk, and every pixel of the artwork inside this image is a resampled
    pixel of the user's drawing. The only new pixels are the outlines and the
    number badges.
    """

    #: PNG bytes of the annotated composite.
    png: bytes
    width: int
    height: int
    outlines: Tuple[PartOutline, ...]
    warnings: List[str] = field(default_factory=list)


@dataclass(eq=False, slots=True)
class ContactSheetResult:
    """A grid of frames the render stage really produced, plus what it measured.

    ``document`` is the render stage's own child revision, carried through
    untouched. It is the thing worth keeping: its ``diagnostics`` were measured
    on these exact frames, which is what makes "best revision" (F9 §11.6) a
    measurement rather than a guess.
    """

    png: bytes
    width: int
    height: int
    columns: int
    rows: int
    frame_count: int
    frame_times: Tuple[float, ...]
    #: ``schemas.RigDocument``; typed loosely so this module needs no schema
    #: import, which would make the value objects and the wire contract
    #: mutually dependent.
    document: object
    max_stretch: float
    flipped_triangles: int
    blocking_reason: Optional[str]
    cache_key: str
    warnings: List[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class AppliedCorrection:
    """One correction that survived revalidation, and what it actually changed.

    Returned per correction rather than aggregated because a pass that applied
    two of five corrections and clamped a third is a different story from one
    that applied all five, and the editor shows that story to the user.
    """

    kind: str
    target_id: Optional[str]
    reason: str
    #: Human-readable statement of the effect, e.g. "pivot moved by (0.00, 0.04)".
    effect: str
    clamped: bool


@dataclass(eq=False, slots=True)
class CorrectionOutcome:
    """The result of applying a whole ``CritiqueReport`` to one document.

    There is no partial-success path. Either every correction resolved and the
    child revision is returned, or ``VisionError`` was raised and nothing was
    written (R7) — a rig with three of five corrections applied looks
    deliberate and animates wrongly.
    """

    #: ``schemas.RigDocument``, the child revision.
    document: object
    applied: Tuple[AppliedCorrection, ...]
    #: Per-part deformer changes the next rig pass must rebuild geometry for.
    #: Not applied here on purpose — see ``VisionConstants.RERIG_CORRECTION_KINDS``.
    deformer_overrides: Dict[str, str] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    @property
    def requires_rerig(self) -> bool:
        return bool(self.deformer_overrides)


def as_rgb_tuple(colour: Tuple[int, int, int]) -> Tuple[int, int, int]:
    """Identity with a name, so a BGR/RGB mix-up has one place to be caught.

    OpenCV draws in BGR. Every constant in ``VisionConstants`` is authored RGB
    because that is what the rest of the pipeline speaks (``decode_sheet``
    normalizes to RGBA), so the drawing helpers convert once, here, instead of
    each call site reversing a tuple and one of them forgetting.
    """
    return colour


def to_bgr(colour: Tuple[int, int, int]) -> Tuple[int, int, int]:
    """RGB constant to the BGR order ``cv2`` drawing primitives expect."""
    return (int(colour[2]), int(colour[1]), int(colour[0]))


def blank_canvas(
    width: int, height: int, colour: Tuple[int, int, int]
) -> np.ndarray:
    """An opaque HxWx3 uint8 RGB canvas filled with an RGB constant."""
    canvas = np.empty((int(height), int(width), 3), dtype=np.uint8)
    canvas[:, :] = np.array(colour, dtype=np.uint8)
    return canvas
