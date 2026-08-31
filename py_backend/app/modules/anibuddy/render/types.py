"""Internal value objects for the render stage.

Deliberately NOT the wire schema, for the same reason ``rig/types.py`` and
``kernel/types.py`` are not: these shapes carry float32 pixel buffers and
encoder byte payloads that have no place in a ``RigDocument``, and keeping them
separate is what lets the rasterizer and the encoders be unit-tested without
constructing a whole document.

Coordinate spaces, stated rather than inferred (R6)
--------------------------------------------------
* ``PartSource.tile`` is indexed in PART-LOCAL PIXELS at SOURCE resolution:
  row 0 is the top of ``Part.rect``, not the top of the sheet.
* ``PartSource.origin_x`` / ``origin_y`` are that rect's top-left in SHEET
  pixels, which is the offset needed to turn a kernel ``src_vert`` (sheet
  pixels) into a tile lookup.
* ``RenderSurface.width`` / ``height`` and every destination vertex the kernel
  hands back are in DESTINATION pixels — the kernel applied ``scale_x`` /
  ``scale_y`` at the warp, so nothing downstream rescales again.

Alpha convention
----------------
Every pixel buffer in this module is **premultiplied** float32 RGBA in 0..1.
Premultiplied is not a preference: bilinear resampling of straight alpha bleeds
the colour of fully transparent pixels into the antialiased fringe of a cutout,
which is exactly the halo the layered-cutout model exists to avoid. Straight
alpha appears once, at the very end, in ``encode.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np


class RenderError(ValueError):
    """A render request that cannot be served, refused rather than repaired.

    Carries the same intent as ``RigError``: a render that quietly substitutes
    a guess produces a file the user believes is their animation. A refusal
    naming what is wrong is recoverable; a plausible wrong export is not.
    """


class EncoderUnavailable(RuntimeError):
    """An encoder's external dependency is missing or failed.

    Separate from ``RenderError`` because the response is different: F9 §8.5
    says a missing or failing ffmpeg falls back to the PNG zip, which needs no
    encoder, rather than failing the stage.
    """


@dataclass(frozen=True, slots=True)
class RenderSurface:
    """The destination raster's dimensions and the scale that produced them.

    ``scale_x`` / ``scale_y`` are handed to the kernel rather than applied
    afterwards, so a half-resolution preview and a full-resolution export
    differ by exactly one multiply inside the warp instead of by a resample of
    the finished frame.
    """

    width: int
    height: int
    scale_x: float
    scale_y: float

    @property
    def pixels(self) -> int:
        return self.width * self.height


@dataclass(frozen=True, eq=False, slots=True)
class PartSource:
    """One part's source pixels, cropped to its rect and gated by its mask.

    The mask gate is why this exists. A ``rigid`` part is two triangles over
    its whole rect, so without the gate it would draw every neighbour's artwork
    that happens to overlap that rect. Applying the mask here — as an alpha
    multiplier on a *copy* cropped out of the sheet — resolves that while
    honouring R8: the sheet itself is never written to, and the mask stays the
    reversible description it was.
    """

    part_id: str
    #: (height, width, 4) float32 premultiplied RGBA in 0..1, part-local pixels.
    tile: np.ndarray
    #: The rect's top-left in SHEET pixels.
    origin_x: int
    origin_y: int
    #: Opaque pixels the mask admitted. Zero means the part contributes nothing
    #: and is skipped before any warp math runs.
    solid_pixels: int

    @property
    def width(self) -> int:
        return int(self.tile.shape[1])

    @property
    def height(self) -> int:
        return int(self.tile.shape[0])


@dataclass(frozen=True, slots=True)
class PartComposite:
    """How one part participates in one frame's composite.

    Everything here comes from the render layer's own ``PartPose`` channel
    sampler, not from the kernel: the kernel's ``poseAt`` covers joints only,
    and these four channels are draw-order and visibility rather than vertex
    math. See ``partpose.py`` for why that split is the honest one.

    This IS the resolved compositing state, and the browser's
    ``PartDrawState`` is its twin. The compositing parity corpus compares the
    two field for field, because nothing else can: two implementations can
    disagree about every value here while their vertices stay bit-identical.
    """

    #: Whose GEOMETRY is drawn. Always this part's own — a ``swapTo`` never
    #: moves geometry.
    part_id: str
    #: Whose PIXELS are sampled. Differs from ``part_id`` only when a ``swapTo``
    #: channel redirected it to another part's crop of the same sheet.
    texture_part_id: str
    #: Sheet-normalized ``(scaleX, scaleY, offsetX, offsetY)`` carrying this
    #: part's rect onto the texture part's. ``IDENTITY_UV_REMAP`` when there is
    #: no swap, so the swap path and the ordinary path are one code path.
    uv_remap: Tuple[float, float, float, float]
    z_index: int
    opacity: float
    #: Document order, used only to break a z-index tie deterministically.
    order: int


@dataclass(eq=False, slots=True)
class FrameStats:
    """Distortion measured while rasterizing one frame.

    Reported, never swallowed. F9 §8.5 is explicit that a render above
    ``STRETCH_WARNING`` ships *and discloses*, which is only possible if the
    numbers survive out of the triangle loop.
    """

    max_stretch: float = 1.0
    flipped_triangles: int = 0
    degenerate_triangles: int = 0
    #: Triangles whose affine map was not invertible, so no source pixel could
    #: be read for their interior. Distinct from ``degenerate_triangles``, which
    #: the kernel drops on the SOURCE side before a matrix is even built.
    non_invertible_triangles: int = 0
    drawn_triangles: int = 0
    drawn_parts: int = 0

    def absorb(self, other: "FrameStats") -> None:
        """Fold another frame's stats in, taking the worst of each."""
        if other.max_stretch > self.max_stretch:
            self.max_stretch = other.max_stretch
        self.flipped_triangles = max(self.flipped_triangles, other.flipped_triangles)
        self.degenerate_triangles = max(
            self.degenerate_triangles, other.degenerate_triangles
        )
        self.non_invertible_triangles = max(
            self.non_invertible_triangles, other.non_invertible_triangles
        )
        self.drawn_triangles = max(self.drawn_triangles, other.drawn_triangles)
        self.drawn_parts = max(self.drawn_parts, other.drawn_parts)


@dataclass(frozen=True, slots=True)
class RenderOptions:
    """Resolved, validated render settings.

    Constructed by ``dto.py`` from the wire request and clamped there, so
    nothing downstream re-checks a bound or invents a default.
    """

    fmt: str
    fps: int
    frame_count: int
    loop: bool
    surface: RenderSurface
    #: ``"transparent"`` or a key of ``RenderConstants.BACKGROUND_RGB``.
    background: str
    clip_id: Optional[str]


@dataclass(eq=False, slots=True)
class RenderArtifact:
    """The encoded bytes plus everything Node needs to store them.

    ``data`` stays in memory rather than on disk because Node owns the
    ``StorageAdapter`` and the only consumer is the response. The size cap that
    makes that safe is ``RenderConstants.CACHE_MAX_BYTES``.
    """

    fmt: str
    mime_type: str
    data: bytes
    content_hash: str
    storage_key: str
    frame_count: int
    width: int
    height: int
    #: Carried on the artifact, not recomputed, so a cache hit can still author
    #: honest ``diagnostics``. Without it a cached render would have to report
    #: ``maxStretch`` of 1 and zero flipped triangles — a clean bill of health
    #: for a frame that was never re-measured.
    stats: FrameStats

    @property
    def byte_length(self) -> int:
        return len(self.data)


@dataclass(eq=False, slots=True)
class RenderReport:
    """Everything the stage learned that is not the artifact itself.

    Mirrors ``rig/types.py``'s ``StageReport`` on purpose: the two stages hand
    their findings to the same document assembler, and one shape means one
    assembler.
    """

    warnings: List[str] = field(default_factory=list)
    blocking_reasons: List[str] = field(default_factory=list)
    stats: FrameStats = field(default_factory=FrameStats)
    #: Whether the requested format was served, or the PNG-zip fallback was.
    requested_format: str = ""
    served_format: str = ""
    cache_hit: bool = False

    def warn(self, message: str) -> None:
        """Append a warning, ignoring an exact duplicate.

        Deduplicated because a per-frame or per-part warning would otherwise
        repeat up to 120 times and blow the schema's 64-entry cap, pushing the
        one warning that mattered off the end.
        """
        if message not in self.warnings:
            self.warnings.append(message)

    def block(self, reason: str) -> None:
        if reason not in self.blocking_reasons:
            self.blocking_reasons.append(reason)

    def blocking_reason(self) -> Optional[str]:
        """One user-facing sentence, or None when the render is trustworthy.

        A sentence rather than a boolean, for the reason v3's
        ``rigInvalidReason`` was one: the editor has to explain the lock.
        """
        if not self.blocking_reasons:
            return None
        return " ".join(self.blocking_reasons)


@dataclass(frozen=True, eq=False, slots=True)
class AdaptedRig:
    """A ``RigDocument`` translated into the kernel's own input struct.

    ``notes`` carries what the translation found wrong with THIS DOCUMENT — a
    rig with no skeleton, a part naming a joint that is not there. It used to
    carry the schema deltas the adapter bridged as well; those are gone, because
    the schema and the kernel describe the same thing now, and a note about the
    contract was never something the user could act on anyway.

    Returned rather than logged: they surface in ``diagnostics.warnings``, and
    the person reading those is exactly the person who can fix the rig.
    """

    #: ``kernel.KernelRig``; typed loosely here to keep this module free of a
    #: kernel import, which would make the wire adapter and the kernel mutually
    #: dependent.
    kernel_rig: object
    #: Part id to its wire ``Part``, for mask and composite lookups.
    parts_by_id: Dict[str, object]
    #: Part ids in the order the kernel evaluates them, so a ``KernelFrame``'s
    #: ``parts`` tuple can be indexed back to a wire part without a search.
    part_order: Tuple[str, ...]
    notes: Tuple[str, ...]
