"""Every magic number the deformation kernel uses, in one place.

This module is mirrored, value for value, by
``frontend/src/features/anibuddy/kernel/constants.ts``. The two deformation
kernels are independent implementations of the same math, so a constant that
drifts between them is a silent export bug: the artist poses in the browser,
the server renders something else, and nothing fails loudly. Any edit here
must be made in the TypeScript file in the same commit, and the parity
harness (``scripts/test-anibuddy-kernel.sh``) is what enforces that.
"""

from __future__ import annotations

from typing import Final


class KernelConstants:
    """Frozen numeric contract shared by the Python and TypeScript kernels.

    Attribute-only class rather than a module of bare globals so callers are
    forced to name the origin of a number at the call site
    (``KernelConstants.SEAM_BLEED`` reads as a decision, ``0.5`` reads as a
    typo).
    """

    __slots__ = ()

    # --- Triangle warp -----------------------------------------------------

    #: Below this absolute area (in source pixels squared) a source triangle is
    #: degenerate: its inverse is numerically meaningless and the affine warp
    #: derived from it would be garbage, so the triangle is skipped entirely.
    MIN_TRIANGLE_AREA: Final[float] = 1e-4

    #: Outward push, in destination pixels, applied to every destination
    #: triangle about its centroid before it is used as a clip path. Adjacent
    #: clipped triangles otherwise leave hairline antialiasing gaps along every
    #: shared edge, which reads as a cracked figure. Ported verbatim from the
    #: v3 browser renderer.
    SEAM_BLEED: Final[float] = 0.5

    #: Anisotropy (sigma_max / sigma_min) above which a triangle is smeared far
    #: enough out of shape to be worth surfacing to the user rather than
    #: quietly shipping.
    STRETCH_WARNING: Final[float] = 2.5

    #: sigma_min below this is treated as zero, making the stretch ratio
    #: infinite (i.e. the triangle collapsed to a line). Such triangles are
    #: excluded from ``max_stretch`` rather than poisoning it with infinity.
    SINGULAR_EPSILON: Final[float] = 1e-6

    #: A destination vertex closer than this to its triangle centroid has no
    #: well-defined outward direction, so it is left where it is instead of
    #: being pushed in an arbitrary one.
    BLEED_LENGTH_EPSILON: Final[float] = 1e-6

    # --- Keyframe interpolation -------------------------------------------

    #: Keyframe time comparison tolerance. Keyframe times are authored as
    #: normalized 0..1 floats, so exact equality would make a key at 0.3
    #: unreachable at t = 0.3.
    KEYFRAME_EPSILON: Final[float] = 1e-4

    #: Pose channels, in the order they are interpolated. The order is part of
    #: the contract only because it must match the TypeScript kernel; the
    #: channels are independent so it does not affect results.
    POSE_CHANNELS: Final[tuple[str, ...]] = ("rot", "tx", "ty", "scale")

    #: Rest value for the ``scale`` channel. A channel absent from one side of
    #: a keyframe pair falls back to rest rather than to the other side's
    #: value, so a key that only sets ``rot`` does not freeze ``scale``.
    REST_SCALE: Final[float] = 1.0

    #: Rest value for every channel other than ``scale``.
    REST_DEFAULT: Final[float] = 0.0

    # --- Part transform tree ------------------------------------------------

    #: Deepest chain of ``parentPartId`` links the kernel will evaluate, counted
    #: in EDGES: a root part is depth 0, its child depth 1. Mirrors the wire
    #: schema's ``MAX_PART_DEPTH``, and is declared here rather than imported
    #: for the same reason ``MIN_TRIANGLE_AREA`` and ``STRETCH_WARNING`` are --
    #: the kernel's numeric contract has to be readable, and identical, from
    #: TypeScript, which cannot import a Python constant. A document that
    #: exceeds it is refused, not truncated: a truncated tree drops a part's
    #: parent and leaves it animating in place while its siblings move.
    MAX_PART_DEPTH: Final[int] = 8

    #: Attachment points one part may offer. Mirrors the schema's
    #: ``MAX_SLOTS_PER_PART`` for the same reason as above.
    MAX_SLOTS_PER_PART: Final[int] = 8

    #: Rect a part falls back to when the caller states none: the whole sheet,
    #: which collapses part-local and sheet-normalized onto the same space. Used
    #: only by the mapping adapter; both real adapters always supply a rect.
    FULL_SHEET_RECT: Final[tuple[float, float, float, float]] = (0.0, 0.0, 1.0, 1.0)

    #: Pivot a part falls back to: the centre of its own rect. Wrong for every
    #: specific part and harmless for all of them, because a part that never
    #: rotates never reads its pivot.
    DEFAULT_PIVOT: Final[tuple[float, float]] = (0.5, 0.5)

    # --- Lattice (free-form deformation) ----------------------------------

    #: Samples per lattice cell edge when evaluating a bicubic lattice. The
    #: bicubic surface is curved inside a cell, but the renderer draws flat
    #: affine-warped triangles, so the cell has to be subdivided for the
    #: curvature to survive rasterization. Bilinear needs no subdivision: the
    #: per-triangle affine warp already reproduces bilinear exactly at the
    #: cell corners.
    LATTICE_BICUBIC_SUBDIV: Final[int] = 4

    #: Guard rails on lattice dimensions. A lattice is authored by hand, so
    #: these are sanity bounds, not performance tuning.
    LATTICE_MIN_DIVISIONS: Final[int] = 1
    LATTICE_MAX_DIVISIONS: Final[int] = 64

    # --- Spline warp -------------------------------------------------------

    #: Samples along a spline are ``segments + 1``. Bounds keep a bad authoring
    #: value from producing either a degenerate ribbon or millions of verts.
    SPLINE_MIN_SEGMENTS: Final[int] = 1
    SPLINE_MAX_SEGMENTS: Final[int] = 256

    #: A curve tangent shorter than this has no usable direction (the control
    #: points coincide), so the normal falls back to the chord direction.
    SPLINE_TANGENT_EPSILON: Final[float] = 1e-9

    #: Catmull-Rom to Bezier conversion factor. The interior Bezier controls
    #: sit one sixth of the neighbour chord away from the span endpoints,
    #: which is what makes the piecewise curve C1 continuous.
    CATMULL_ROM_SIXTH: Final[float] = 1.0 / 6.0

    # --- Parity ------------------------------------------------------------

    #: Maximum float32 ULP distance tolerated between the Python and
    #: TypeScript kernels for a position-like output.
    #:
    #: Four ULPs, not an absolute epsilon, because the tolerance has to scale
    #: with coordinate magnitude: 4 ULP is ~4.8e-7 px near the origin and
    #: ~4.9e-4 px at 4096 px. An absolute epsilon tight enough for the origin
    #: would false-positive at the far corner of a large sheet, and one loose
    #: enough for the far corner would hide a real bug near the origin.
    #:
    #: Four is the budget for the only legitimate source of divergence: both
    #: kernels compute in float64 and round to float32 once at the boundary,
    #: so a 1 ULP float64 difference in libm ``sin``/``cos``/``atan2``
    #: propagates through at most a couple of multiply-adds before that
    #: rounding absorbs it. Any real algorithmic defect -- a swapped bone
    #: column, a dropped scale, a transposed warp matrix -- moves a vertex by
    #: whole pixels, which is roughly 2^13 ULP at 1024 px. The gap between
    #: "tolerated" and "detected" is about three orders of magnitude.
    PARITY_ULP_TOLERANCE: Final[int] = 4

    #: Relative tolerance for ``max_stretch`` specifically. Looser than the
    #: position tolerance because sigma_min is computed as
    #: ``abs(sum - difference)`` of two nearly equal quantities on a nearly
    #: rigid triangle: catastrophic cancellation there can amplify a sub-ULP
    #: input difference into several significant figures of the ratio. The
    #: metric is a user-facing warning, not geometry, so this is safe to relax
    #: -- but only this one field.
    PARITY_STRETCH_RELATIVE_TOLERANCE: Final[float] = 1e-5
