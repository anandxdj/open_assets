"""AniBuddy pipeline constants that are not part of the generated schema limits.

``ANIBUDDY_LIMITS`` (from ``schemas.py``) owns every cap that lives on the
wire. This module owns stage-local algorithm knobs — confidence ladders,
morphology sizes, escalation thresholds — so call sites never invent a
literal. Rule 9.
"""

from __future__ import annotations

from typing import Final

from app.modules.anibuddy.schemas import ANIBUDDY_LIMITS


class DecomposeConstants:
    """Frozen knobs for the classical-CV decompose cascade.

    Attribute-only class (same shape as ``KernelConstants``) so every magic
    number at a call site names its origin.
    """

    __slots__ = ()

    #: Shared with prepare / rig / schema ``ALPHA_FLOOR``. Pixels below this
    #: alpha are background and never claimed by a part.
    ALPHA_FLOOR: Final[int] = int(ANIBUDDY_LIMITS["ALPHA_FLOOR"])

    MAX_PARTS: Final[int] = int(ANIBUDDY_LIMITS["MAX_PARTS"])
    MAX_SOURCE_EDGE: Final[int] = int(ANIBUDDY_LIMITS["MAX_SOURCE_EDGE"])
    MAX_INLINE_BUFFER_ELEMENTS: Final[int] = int(
        ANIBUDDY_LIMITS["MAX_INLINE_BUFFER_ELEMENTS"]
    )
    CONFIDENCE_REVIEW_FLOOR: Final[float] = float(
        ANIBUDDY_LIMITS["CONFIDENCE_REVIEW_FLOOR"]
    )

    #: Gutter-grid / alpha-component: clean separations.
    CONFIDENCE_GUTTER_GRID: Final[float] = 0.92
    CONFIDENCE_ALPHA_COMPONENT: Final[float] = 0.88

    #: Watershed: parts that touch. Still above the review floor so the editor
    #: does not panic, but clearly lower than a clean separation.
    CONFIDENCE_WATERSHED: Final[float] = 0.62

    #: GrabCut: overlapping / shared silhouette. Below the review floor so the
    #: editor flags every part for human confirmation.
    CONFIDENCE_GRABCUT: Final[float] = 0.45

    #: Single-part degenerate sheet (whole atlas as one candidate). Valid
    #: outcome, not an error — matches v3's model.
    CONFIDENCE_WHOLE_SHEET: Final[float] = 0.75

    #: Minimum opaque pixels inside a gutter cell before it is kept as a part.
    MIN_CELL_FOREGROUND_PIXELS: Final[int] = 4

    #: Minimum component area (pixels) retained from alpha CC / watershed.
    MIN_COMPONENT_PIXELS: Final[int] = 8

    #: Morphological erode radius (pixels) used to probe whether a single
    #: alpha blob is actually several touching parts.
    TOUCH_PROBE_ERODE_PX: Final[int] = 2

    #: After erode, this many components means "touching → escalate watershed".
    TOUCH_PROBE_MIN_COMPONENTS: Final[int] = 2

    #: Distance-transform peak relative height (fraction of max) kept as a
    #: watershed seed. Lower admits more seeds; too low oversplits noise.
    WATERSHED_SEED_RELATIVE: Final[float] = 0.35

    #: Minimum distance between watershed seeds (pixels).
    WATERSHED_SEED_MIN_DISTANCE_PX: Final[int] = 6

    #: GrabCut iteration count. More is slower and rarely better on tiny sheets.
    GRABCUT_ITERATIONS: Final[int] = 3

    #: How far (px) to inflate each watershed/grabCut seed into a sure-FG rect
    #: before running grabCut on the shared silhouette.
    GRABCUT_SEED_PAD_PX: Final[int] = 2

    #: Coverage gap (1 - covered/foreground) above which we warn that the
    #: cascade left opaque pixels unclaimed.
    COVERAGE_GAP_WARN: Final[float] = 0.05

    #: GrabCut per-seed masks that cover more than this fraction of a smaller
    #: sibling are treated as duplicates and dropped.
    GRABCUT_DEDUP_OVERLAP: Final[float] = 0.8

    PIPELINE_VERSION: Final[str] = "anibuddy-decompose/1"
    #: Kernel is unused at this stage; recorded so StageRecord stays complete.
    KERNEL_VERSION: Final[str] = "none"

    DEFAULT_PART_ROLE: Final[str] = "other"
    DEFAULT_PIVOT_X: Final[float] = 0.5
    DEFAULT_PIVOT_Y: Final[float] = 0.5
    DEFAULT_OPACITY: Final[float] = 1.0

    #: Archetype used when the caller does not name one.
    #:
    #: The archetype is a semantic choice about the artwork (F9 §10) and this
    #: stage measures pixels, so it cannot derive one — it carries the caller's
    #: through. The default exists for a caller that has not asked the user yet;
    #: the ``semantics`` stage is what replaces it with a considered answer.
    DEFAULT_ARCHETYPE: Final[str] = "humanoid"

    REVISION_REASON: Final[str] = "decompose"


class RigConstants:
    """Frozen knobs for the rig stage: skeleton inference, meshing, skinning.

    Same shape and same reason as ``DecomposeConstants``. Wire-visible caps are
    re-read from ``ANIBUDDY_LIMITS`` rather than restated, so a schema change
    moves them here for free (Rule 9, R10).
    """

    __slots__ = ()

    # --- Caps lifted from the generated schema limits ----------------------

    ALPHA_FLOOR: Final[int] = int(ANIBUDDY_LIMITS["ALPHA_FLOOR"])
    MAX_PARTS: Final[int] = int(ANIBUDDY_LIMITS["MAX_PARTS"])
    MAX_PART_DEPTH: Final[int] = int(ANIBUDDY_LIMITS["MAX_PART_DEPTH"])
    MAX_JOINTS: Final[int] = int(ANIBUDDY_LIMITS["MAX_JOINTS"])
    MIN_JOINTS: Final[int] = int(ANIBUDDY_LIMITS["MIN_JOINTS"])
    MAX_JOINT_DEPTH: Final[int] = int(ANIBUDDY_LIMITS["MAX_JOINT_DEPTH"])
    MAX_BONES_PER_PART: Final[int] = int(ANIBUDDY_LIMITS["MAX_BONES_PER_PART"])
    MAX_CUTS_PER_PART: Final[int] = int(ANIBUDDY_LIMITS["MAX_CUTS_PER_PART"])
    MAX_SLOTS_PER_PART: Final[int] = int(ANIBUDDY_LIMITS["MAX_SLOTS_PER_PART"])
    MAX_VERTS_PER_PART: Final[int] = int(ANIBUDDY_LIMITS["MAX_VERTS_PER_PART"])
    MAX_TRIS_PER_PART: Final[int] = int(ANIBUDDY_LIMITS["MAX_TRIS_PER_PART"])
    MIN_TRIANGLE_AREA: Final[float] = float(ANIBUDDY_LIMITS["MIN_TRIANGLE_AREA"])
    MAX_LATTICE_COLS: Final[int] = int(ANIBUDDY_LIMITS["MAX_LATTICE_COLS"])
    MAX_LATTICE_ROWS: Final[int] = int(ANIBUDDY_LIMITS["MAX_LATTICE_ROWS"])
    MAX_SPLINE_SAMPLES: Final[int] = int(ANIBUDDY_LIMITS["MAX_SPLINE_SAMPLES"])
    MAX_INLINE_BUFFER_ELEMENTS: Final[int] = int(
        ANIBUDDY_LIMITS["MAX_INLINE_BUFFER_ELEMENTS"]
    )
    MAX_STAGE_RECORDS: Final[int] = int(ANIBUDDY_LIMITS["MAX_STAGE_RECORDS"])
    WEIGHT_ROW_EPSILON: Final[float] = float(ANIBUDDY_LIMITS["WEIGHT_ROW_EPSILON"])
    SKIN_TOP_K: Final[int] = int(ANIBUDDY_LIMITS["SKIN_TOP_K"])
    SKIN_FALLOFF: Final[int] = int(ANIBUDDY_LIMITS["SKIN_FALLOFF"])
    CONFIDENCE_REVIEW_FLOOR: Final[float] = float(
        ANIBUDDY_LIMITS["CONFIDENCE_REVIEW_FLOOR"]
    )
    MAX_SOURCE_EDGE: Final[int] = int(ANIBUDDY_LIMITS["MAX_SOURCE_EDGE"])

    # --- Numerical guards -------------------------------------------------

    #: Shared "is this quantity effectively zero" threshold for lengths and
    #: areas measured in part-local pixels. Same value as v3's ``EPSILON`` in
    #: ``lib/mesh.ts`` so the ported predicates keep their behaviour.
    EPSILON: Final[float] = 1e-6

    #: A part-local raster smaller than this on either axis cannot carry a
    #: contour worth triangulating; the part is downgraded to rigid.
    MIN_PART_EDGE_PX: Final[int] = 3

    # --- Contour trace / simplify / sample (ported from lib/contour.ts) ----

    #: RDP tolerance as a fraction of the part's longest edge. 0.004 is the v3
    #: value: tight enough to keep a silhouette recognisable, loose enough that
    #: a hand-drawn 1px wobble does not become three vertices.
    RDP_EPSILON_RATIO: Final[float] = 0.004

    #: RDP tolerance floor, as a fraction of the sampling pitch. The v3 ratio
    #: alone is a fraction of the part SIZE, which on a small part leaves the
    #: marching-squares stair steps in place — and three consecutive stair
    #: vertices are a near-collinear triple, which is a sliver by construction.
    #: Simplifying the boundary to the mesh's own resolution is what removes
    #: them, so the tolerance has to track the pitch and not only the part.
    RDP_PITCH_RATIO: Final[float] = 0.25

    #: Target interior sample count driving the initial Poisson pitch:
    #: ``spacing = sqrt(solidPixels / SAMPLE_AREA_PER_POINT)``. Verbatim from
    #: ``lib/mesh.ts`` line 51.
    SAMPLE_AREA_PER_POINT: Final[float] = 520.0
    MIN_SAMPLE_SPACING_PX: Final[float] = 3.0

    #: Vertex-budget retry ladder. Raising the pitch and rebuilding is the only
    #: safe response to an over-budget mesh — slicing the vertex array leaves
    #: triangle indices pointing at nothing (F9 §8.3).
    SPACING_GROWTH: Final[float] = 1.35
    SPACING_PASSES: Final[int] = 12

    #: Poisson-disc knobs, all verbatim from ``samplePoints`` in
    #: ``lib/contour.ts``. The hash constants are a deterministic jitter: a
    #: perfectly regular lattice becomes a visible deformation pattern, and a
    #: real RNG would make the stage non-idempotent on ``inputHash``.
    SAMPLE_CELL_RATIO: Final[float] = 0.5
    SAMPLE_CELL_MIN_PX: Final[float] = 2.0
    SAMPLE_PITCH_BASE: Final[float] = 0.55
    SAMPLE_PITCH_DISTANCE: Final[float] = 0.25
    SAMPLE_PITCH_MAX_FACTOR: Final[float] = 2.0
    SAMPLE_PACKING_RATIO: Final[float] = 0.8
    SAMPLE_JITTER_RATIO: Final[float] = 0.45
    SAMPLE_HASH_X: Final[float] = 12.9898
    SAMPLE_HASH_Y: Final[float] = 78.233
    SAMPLE_HASH_SCALE: Final[float] = 43758.5453

    #: Duplicate-point merge grid for the PSLG, in units of 1/DEDUP_SCALE of a
    #: pixel. Matches the ``Math.round(x * 1e5)`` key in ``lib/mesh.ts``.
    DEDUP_SCALE: Final[float] = 1e5

    # --- Quality-constrained triangulation --------------------------------

    #: Ruppert refinement stops once no triangle is below this smallest angle.
    #: 25 degrees is inside the ~20.7 degree bound where Ruppert's algorithm is
    #: proven to terminate, so the loop is bounded by geometry rather than only
    #: by the pass cap. Slivers below this are exactly what the renderer's
    #: sigma_max/sigma_min metric flags at export time.
    MIN_TRIANGLE_ANGLE_DEG: Final[float] = 25.0

    #: Hard pass caps. Refinement is bounded twice — by angle convergence and
    #: by these — because a pathological silhouette must cost bounded CPU in a
    #: request handler.
    REFINE_MAX_PASSES: Final[int] = 8
    ENCROACH_MAX_PASSES: Final[int] = 6

    #: Per-pass insertion cap. Inserting every bad triangle's circumcenter at
    #: once can overshoot the vertex budget badly; a cap keeps each pass's cost
    #: proportional to the mesh it started from.
    REFINE_INSERTS_PER_PASS: Final[int] = 128

    #: Longest boundary sub-segment, as a multiple of the sampling pitch. RDP
    #: leaves a straight edge as one long segment, and a long boundary segment
    #: facing interior points a pitch away is a sliver factory: the Delaunay
    #: triangles that span the gap have a base of one pitch and an apex anywhere
    #: along the edge. Resampling the boundary to the interior's own resolution
    #: is what makes the two agree, and it is why the mesh comes out near
    #: equilateral instead of near degenerate. Scaled by the pitch so the
    #: vertex-budget retry ladder coarsens the boundary along with the interior.
    BOUNDARY_SEGMENT_RATIO: Final[float] = 1.0

    #: Interior samples must keep this fraction of the sampling pitch away from
    #: any constraint segment. Two reasons, and the second one fixes the value:
    #:
    #: 1. A sample almost on the silhouette makes a triangle whose smallest
    #:    angle is atan(clearance / edge length) — a sliver no circumcentre
    #:    insertion can repair, because Ruppert's remedy is to split the
    #:    segment and that bottoms out at pixel resolution.
    #: 2. It must exceed HALF of ``BOUNDARY_SEGMENT_RATIO``. A point closer than
    #:    half a segment's length lies inside that segment's diametral circle,
    #:    which means it encroaches — so any smaller value makes *every* interior
    #:    sample encroach the boundary, the conforming pass splits the whole
    #:    boundary down to one pixel chasing them, and the mesh comes out worse
    #:    than with no refinement at all.
    SAMPLE_BOUNDARY_CLEARANCE: Final[float] = 0.55

    #: Shortest altitude, in part-local pixels, below which a thin triangle is
    #: not counted as a sliver at all.
    #:
    #: Not a fudge factor — it separates two different things that both look like
    #: "min angle under target". A polygonal boundary is a chord approximation of
    #: a curve, so the strip between the polyline and the interior points always
    #: needs a row of thin triangles covering the sub-pixel bulge. Those are
    #: geometrically necessary and cannot produce a visible artefact: a triangle
    #: less than a pixel thick covers less than a pixel-wide band no matter how
    #: it deforms. A thin triangle a pixel or more thick is the other thing — a
    #: real sliver spanning artwork the eye can see — and that is what the
    #: stretch metric flags at render time.
    SLIVER_MIN_ALTITUDE_PX: Final[float] = 1.0

    #: Fraction of a part's triangles allowed to be visible slivers before it is
    #: worth telling the user. A handful on a thousand-triangle limb is normal;
    #: a third of the mesh means the silhouette defeated the refiner, and only
    #: the second case is actionable.
    SLIVER_WARN_FRACTION: Final[float] = 0.05

    #: A constraint sub-segment shorter than this is never split again, which is
    #: the practical guard against the infinite recursion Ruppert's algorithm
    #: exhibits on inputs with angles under ~60 degrees between segments.
    MIN_SEGMENT_LENGTH_PX: Final[float] = 1.0

    # --- Skinning ---------------------------------------------------------

    #: A vertex is pinned (Dirichlet w = 1) to its nearest bone only when that
    #: bone is decisively nearest: ``d_nearest <= ratio * d_second``. Vertices
    #: in the ambiguous band are left free and get their weights from the
    #: harmonic solve, which is where the smooth blend comes from. Pinning
    #: everything would reproduce nearest-bone rigid banding.
    ANCHOR_DOMINANCE_RATIO: Final[float] = 0.5

    #: Cotangent clamp. On a near-degenerate triangle a cotangent blows up and
    #: an obtuse one makes it negative; either destroys the discrete maximum
    #: principle that is the reason harmonic weights land in [0, 1] at all.
    #: Clamping to a non-negative range keeps the Laplacian an M-matrix.
    #:
    #: The floor is a small POSITIVE number rather than zero on purpose. A hard
    #: zero disconnects any vertex whose every opposite angle happens to be
    #: obtuse — the diffusion then cannot reach it, its row solves to nothing,
    #: and it falls to the nearest-bone path for no reason a user could see. A
    #: weak edge keeps the graph connected while staying four orders of
    #: magnitude below a typical well-shaped triangle's weight, so it cannot
    #: move a converged answer.
    COTAN_MIN: Final[float] = 1e-3
    COTAN_MAX: Final[float] = 1e4

    #: Tiny diagonal added to the harmonic system. The unconstrained blocks of
    #: a cut-severed mesh are singular; a regulariser turns "no solution" into
    #: "the smoothest solution", and is orders of magnitude below the weight
    #: epsilon so it cannot shift a converged answer.
    HARMONIC_REGULARISER: Final[float] = 1e-9

    #: One Laplacian smoothing pass, kept from v3: raw per-bone weights step
    #: across the midline between two bones and that discontinuity renders as a
    #: crease when the limbs move apart.
    SMOOTH_PASSES: Final[int] = 1

    # --- Lattice ----------------------------------------------------------

    #: Target cell edge in part-local pixels. Divisions are derived from the
    #: part's own pixel size so a small cape and a full-screen cloth layer get
    #: comparable cell density instead of a fixed grid.
    LATTICE_TARGET_CELL_PX: Final[float] = 48.0
    LATTICE_MIN_DIVISIONS: Final[int] = 1
    LATTICE_DEFAULT_INTERPOLATION: Final[str] = "bilinear"

    # --- Spline -----------------------------------------------------------

    #: Aspect ratio below which a part is not actually long and tapering, so a
    #: spline spine would be a fiction. Such a part downgrades to rigid.
    SPLINE_MIN_ASPECT: Final[float] = 1.4

    #: Taper track resolution: ``SPLINE_SEGMENTS + 1`` half-widths sampled along
    #: the spine. Five stations track a tail's narrowing without giving the
    #: animator more handles than a tail has meaningful changes of width. It is
    #: a resolution, not a structure — the track is indexed by position along
    #: the spine, so it is independent of how many joints the chain ends up
    #: with.
    SPLINE_SEGMENTS: Final[int] = 4

    #: Ribbon evaluation resolution stored in the document, because the browser
    #: and the server must sample the same curve at the same points (R4).
    SPLINE_SAMPLES: Final[int] = 32

    #: Medial-axis probe count along the part's principal axis. Thickness and
    #: the spine polyline are both measured at these stations.
    SPLINE_PROBES: Final[int] = 17

    #: Floor on a half-width, part-local normalized, so a tapered tip still has
    #: a ribbon rather than collapsing to a zero-area quad.
    SPLINE_MIN_HALF_WIDTH: Final[float] = 0.01

    #: Diagnostics field maxima. These mirror plain JSON Schema ``maxItems`` /
    #: ``maxLength`` on ``Diagnostics`` that carry no ``x-limit`` name, so they
    #: are not in ``ANIBUDDY_LIMITS`` to import. Named here rather than written
    #: as literals at the truncation site, and any change to the schema has to
    #: change them too.
    MAX_DIAGNOSTIC_WARNINGS: Final[int] = 64
    MAX_DIAGNOSTIC_WARNING_LENGTH: Final[int] = 500
    MAX_BLOCKING_REASON_LENGTH: Final[int] = 500
    MAX_STAGE_MESSAGE_LENGTH: Final[int] = 2000

    #: 64 parts can overlap in up to 2016 pairs, well past the schema's cap, so
    #: the list is truncated rather than allowed to fail validation. It is an
    #: editor hint about which parts to inspect, not data anything computes from,
    #: so the first 256 pairs serve the same purpose as all of them.
    MAX_OVERLAPPING_PART_PAIRS: Final[int] = 256

    #: Fallback slot position when a prior entry omits its hint: the middle of
    #: the host part, which is wrong for every specific slot and harmless for
    #: all of them, since a slot with no hint has no attached child either.
    SLOT_DEFAULT_X: Final[float] = 0.5
    SLOT_DEFAULT_Y: Final[float] = 0.5

    #: Medial-axis pivot snap searches this many local half-thicknesses around
    #: the hint. Derived from the shape rather than fixed, so a wrist searches a
    #: few pixels and a torso searches tens.
    PIVOT_SNAP_RADIUS_FACTOR: Final[float] = 2.0

    #: Joints authored along a spline part's spine. The wire deformer stores a
    #: bezier chain; the kernel poses a spline from a JOINT chain, so the rig
    #: stage authors both from the same medial polyline and they agree.
    SPLINE_CHAIN_JOINTS: Final[int] = 4

    # --- Skeleton inference ------------------------------------------------

    #: Confidence stamped on a joint the rig stage derived from geometry alone
    #: (no vision proposal). Above the review floor — geometry is trustworthy —
    #: but below a model-confirmed joint so the editor still invites a look.
    JOINT_CONFIDENCE_DERIVED: Final[float] = 0.7

    #: Confidence stamped on a joint that came from a validated semantics
    #: proposal, when the proposal itself carried none.
    JOINT_CONFIDENCE_PROPOSED: Final[float] = 0.75

    #: The single structural root the stage always authors. `MIN_JOINTS` is 0,
    #: but the kernel refuses a rootless rig and a rigid part with no
    #: `boundJointId` has no transform to ride, so "no skeleton" is expressed
    #: as one root joint rather than as an empty list.
    ROOT_JOINT_ID: Final[str] = "j_root"
    ROOT_JOINT_NAME: Final[str] = "Root"

    #: Joint id prefix and the id budget it has to fit inside.
    JOINT_ID_PREFIX: Final[str] = "j_"
    MAX_ID_LENGTH: Final[int] = 32

    #: Part roles that make the best structural root when the part tree does
    #: not already declare one, most-preferred first. Everything else falls
    #: back to the largest part by rect area.
    ROOT_PART_ROLE_PRIORITY: Final[tuple[str, ...]] = (
        "pelvis",
        "torso",
        "chassis",
        "panel",
        "backgroundLayer",
        "prop",
        "head",
    )

    #: Part role to joint role. Rig-stage internal and deliberately not in
    #: ``archetype-priors.v1.json``: the browser never reads it, and adding a
    #: table to that file would force a matching edit to two TypeScript loaders
    #: and their drift tests for no wire-visible gain. Roles absent here become
    #: ``other``, which every archetype's joint vocabulary admits.
    PART_ROLE_TO_JOINT_ROLE: Final[dict[str, str]] = {
        "root": "root",
        "head": "head",
        "face": "head",
        "hair": "other",
        "torso": "spine",
        "pelvis": "spine",
        "neck": "neck",
        "armUpper": "limbUpper",
        "armLower": "limbLower",
        "hand": "limbTip",
        "legUpper": "limbUpper",
        "legLower": "limbLower",
        "foot": "limbTip",
        "eye": "eye",
        "jaw": "jaw",
        "ear": "ear",
        "cape": "other",
        "accessory": "prop",
        "tail": "tail",
        "wing": "wing",
        "fin": "fin",
        "horn": "horn",
        "paw": "limbTip",
        "snout": "jaw",
        "shell": "other",
        "tentacle": "tentacleSegment",
        "chassis": "root",
        "wheel": "wheel",
        "track": "hinge",
        "turret": "hinge",
        "barrel": "hinge",
        "piston": "slider",
        "hatch": "hinge",
        "rotor": "wheel",
        "thruster": "hinge",
        "antenna": "hinge",
        "prop": "prop",
        "weapon": "prop",
        "projectile": "prop",
        "effect": "prop",
        "spark": "prop",
        "smoke": "other",
        "trail": "other",
        "skyLayer": "layer",
        "backgroundLayer": "layer",
        "midgroundLayer": "layer",
        "foregroundLayer": "layer",
        "cloud": "layer",
        "foliage": "layer",
        "waterLayer": "layer",
        "logoMark": "anchor",
        "logoText": "anchor",
        "icon": "anchor",
        "badge": "anchor",
        "panel": "anchor",
        "glyph": "anchor",
        "underlay": "anchor",
        "other": "other",
    }
    FALLBACK_JOINT_ROLE: Final[str] = "other"

    #: Part roles the ``ui`` archetype only ever promotes past ``rigid`` on an
    #: explicit user override — never on a model hint (F9 §10.6).
    USER_ONLY_MESH_PROMOTION_ROLES: Final[tuple[str, ...]] = ("glyph",)

    # --- Storage ----------------------------------------------------------

    #: Content-addressed key template for a buffer that outgrew the inline
    #: budget. Content-addressed on purpose: the same geometry produces the
    #: same key, so a re-run is a no-op upload and the render cache stays
    #: trustworthy.
    BUFFER_KEY_TEMPLATE: Final[str] = "anibuddy/{project_id}/buffers/{sha256}.bin"

    # --- Provenance -------------------------------------------------------

    PIPELINE_VERSION: Final[str] = "anibuddy-rig/2"
    KERNEL_VERSION: Final[str] = "0.2.0-numpy"
    REVISION_REASON: Final[str] = "rig"

    #: Skinning method recorded in the stage message. Named explicitly because
    #: it is a documented deviation from the plan's "bounded biharmonic" — see
    #: ``rig/skin.py``.
    SKINNING_METHOD: Final[str] = "harmonic-cotangent"

    #: What the skinner falls back to when the harmonic solve is unavailable:
    #: v3's inverse-distance weights. Recorded on the result so a support case
    #: does not have to guess which solver produced a stiff-looking part.
    SKINNING_FALLBACK_METHOD: Final[str] = "inverse-distance-fallback"


class RenderConstants:
    """Frozen knobs for the render stage: rasterization, encoding, caching.

    Same shape and same reason as ``DecomposeConstants`` and ``RigConstants``.
    Anything that is parity-critical vertex math lives in ``KernelConstants``
    instead and is re-read from there rather than restated — ``SEAM_BLEED`` in
    particular must never acquire a second declaration, because the browser
    kernel's copy is the one it is compared against (R10, Rule 9).
    """

    __slots__ = ()

    # --- Caps lifted from the generated schema limits ----------------------

    MAX_PARTS: Final[int] = int(ANIBUDDY_LIMITS["MAX_PARTS"])
    MAX_FRAMES: Final[int] = int(ANIBUDDY_LIMITS["MAX_FRAMES"])
    MAX_FPS: Final[int] = int(ANIBUDDY_LIMITS["MAX_FPS"])
    MAX_SOURCE_EDGE: Final[int] = int(ANIBUDDY_LIMITS["MAX_SOURCE_EDGE"])
    MIN_TRIANGLE_AREA: Final[float] = float(ANIBUDDY_LIMITS["MIN_TRIANGLE_AREA"])
    STRETCH_WARNING: Final[float] = float(ANIBUDDY_LIMITS["STRETCH_WARNING"])
    MAX_STAGE_RECORDS: Final[int] = int(ANIBUDDY_LIMITS["MAX_STAGE_RECORDS"])
    CRITIQUE_CONTACT_SHEET_FRAMES: Final[int] = int(
        ANIBUDDY_LIMITS["CRITIQUE_CONTACT_SHEET_FRAMES"]
    )

    #: ``Diagnostics.warnings`` cap. Not in ``ANIBUDDY_LIMITS`` as a named
    #: constant — the schema expresses it as ``maxItems`` on the field — so it is
    #: named once here rather than at the two call sites that truncate.
    MAX_WARNINGS: Final[int] = 64

    # --- Output surface ----------------------------------------------------

    #: Largest destination edge a render request may ask for. Below
    #: ``MAX_SOURCE_EDGE`` on purpose: a frame is rasterized in float32 RGBA
    #: (16 bytes per pixel) and a whole clip's worth is held per part layer, so
    #: an 8192px request would be tens of gigabytes rather than a slow render.
    MAX_OUTPUT_EDGE: Final[int] = 2048
    MIN_OUTPUT_EDGE: Final[int] = 8

    #: GIF is palette-indexed and its file size scales with pixel count times
    #: frame count, so it is capped harder than the video formats. 512 is the v3
    #: browser value (``MAX_GIF_EDGE`` in ``features/anibuddy/types.ts``), kept
    #: so a v3 export and a v4 export of the same rig are the same size.
    MAX_GIF_EDGE: Final[int] = 512

    #: H.264 in yuv420p needs even dimensions on both axes; odd ones make
    #: ffmpeg either refuse or silently pad. Rounding here, once, keeps that out
    #: of the encoder call sites.
    EVEN_DIMENSION_MULTIPLE: Final[int] = 2

    # --- Sampling defaults -------------------------------------------------

    #: Sampling rate for a render whose clip does not state one. 12 is the
    #: traditional cel-animation rate and reads as deliberate on cutout artwork,
    #: where 24 mostly buys file size.
    DEFAULT_FPS: Final[int] = 12

    #: A render with no clip is one still at rest. The schema's
    #: ``Clip.frameCount`` minimum of 2 is a constraint on an animation, and a
    #: still is not one.
    DEFAULT_STILL_FRAME_COUNT: Final[int] = 1

    # --- Rasterization -----------------------------------------------------

    #: Fixed-point fractional bits handed to ``cv2.fillPoly`` so the sub-pixel
    #: seam bleed survives into the coverage mask. 4 bits is 1/16 px, which
    #: resolves ``SEAM_BLEED`` (0.5 px) with eight steps to spare, and keeps the
    #: shifted coordinates comfortably inside int32 at ``MAX_OUTPUT_EDGE``.
    POLY_SHIFT_BITS: Final[int] = 4

    #: A destination triangle whose affine map has |det| below this cannot be
    #: inverted, so there is no source pixel to read for its interior. Counted
    #: and reported rather than silently skipped.
    MIN_INVERTIBLE_DET: Final[float] = 1e-9

    #: Sentinel written into the per-pixel triangle label map for "no triangle
    #: covers this pixel". Labels are ``row + 1`` so 0 is free for this.
    NO_TRIANGLE_LABEL: Final[int] = 0

    #: Source coordinate assigned to an uncovered pixel, in source pixels. Far
    #: enough outside any tile that the resampler's transparent border answers
    #: for it, which is what lets the coverage mask be applied *through* the
    #: sampler instead of as a separate multiply over every pixel of every part
    #: of every frame. Negative and larger in magnitude than ``MAX_SOURCE_EDGE``
    #: so no tile, however placed, can reach it.
    UNCOVERED_SOURCE_COORDINATE: Final[float] = -float(4 * 8192)

    #: Alpha below this (0..1) is treated as fully transparent when
    #: un-premultiplying, which avoids amplifying quantization noise in the
    #: near-empty fringe of an antialiased edge into visible colour speckle.
    UNPREMULTIPLY_ALPHA_FLOOR: Final[float] = 1.0 / 255.0

    # --- Compositing -------------------------------------------------------
    #
    # Mirrored value for value by the browser's
    # ``frontend/src/features/anibuddy/editor/compositing.constants.ts``. These
    # are not rasterizer knobs — they are the shared reading of four wire
    # fields, and a constant that drifts between the two files is a preview that
    # disagrees with the export while every test stays green.

    #: ``PartPose`` channels that STEP rather than interpolate (F9 §7.7): there
    #: is no meaningful halfway between two sprites, between shown and hidden,
    #: or between two draw orders.
    STEPPED_PART_CHANNELS: Final[tuple[str, ...]] = ("visible", "zIndex", "swapTo")

    #: ``PartPose`` channels that interpolate at the render layer.
    #:
    #: The other four — ``rot``, ``tx``, ``ty``, ``scale`` — are geometry and
    #: are not listed here because the render layer never touches them:
    #: ``PoseTrack.part_pose_at`` samples them and ``kernel/parts.py`` applies
    #: them, which is what makes the export reproduce the browser preview (R4).
    INTERPOLATED_PART_CHANNELS: Final[tuple[str, ...]] = ("opacity",)

    #: Compositing channels whose REST value is a field on ``Part`` rather than
    #: a constant. This tuple IS the rule the schema states on ``PartPose``:
    #: ``Part.visible``, ``Part.opacity`` and ``Part.zIndex`` are the rest values
    #: of the pose channels of the same name. There is deliberately no
    #: ``REST_OPACITY`` constant here any more — one existed, the render layer
    #: blended against it and then multiplied the result by ``Part.opacity``,
    #: and the browser treated the same field as a plain fallback. The two
    #: agreed on every part authored at opacity 1 and disagreed on every other,
    #: which is the class of divergence a vertex-parity corpus cannot see.
    PART_REST_CHANNELS: Final[tuple[str, ...]] = ("visible", "opacity", "zIndex")

    #: ``swapTo`` is the one compositing channel with no static counterpart, so
    #: its rest is stated rather than looked up: draw this part's own pixels.
    REST_SWAP_TO: Final[None] = None

    #: Resolved opacity is clamped into these bounds once, at the end of
    #: resolution, so neither the rasterizer nor the shader has to.
    OPACITY_MIN: Final[float] = 0.0
    OPACITY_MAX: Final[float] = 1.0

    #: At or below this resolved opacity a layer contributes nothing and is
    #: dropped from the composite before any warp math runs. Named because the
    #: browser applies the same cut and a mismatch here is a layer that previews
    #: and does not export.
    MIN_DRAWN_OPACITY: Final[float] = 0.0

    #: Texture remap ``(scaleX, scaleY, offsetX, offsetY)`` for a part drawing
    #: its own pixels. A ``swapTo`` replaces it with the affine that carries this
    #: part's rect onto the target's; the identity is what every other part gets,
    #: so the swap path and the ordinary path are one code path.
    IDENTITY_UV_REMAP: Final[tuple[float, float, float, float]] = (1.0, 1.0, 0.0, 0.0)

    #: Warning raised when a ``swapTo`` names a part this rig does not contain.
    #:
    #: A template rather than an f-string at the call site, because the
    #: compositing parity corpus compares the warnings the two implementations
    #: emit, and a wording difference there is the cheapest possible early signal
    #: that the two sides have stopped agreeing about what is unresolvable.
    UNRESOLVED_SWAP_WARNING: Final[str] = (
        'Part "{part_id}" swaps to "{swap_to}", which is not a part of this '
        "rig; it was drawn as itself."
    )

    # --- Backgrounds -------------------------------------------------------

    #: Matte colours, RGB 0..255. Verbatim from v3's ``BACKGROUND_CSS`` so an
    #: export matted dark looks the same as it did in the browser.
    BACKGROUND_TRANSPARENT: Final[str] = "transparent"
    BACKGROUND_RGB: Final[dict[str, tuple[int, int, int]]] = {
        "white": (255, 255, 255),
        "dark": (24, 24, 27),
        "black": (0, 0, 0),
    }

    # --- Encoding ----------------------------------------------------------

    FORMAT_PNG_ZIP: Final[str] = "png-zip"
    FORMAT_GIF: Final[str] = "gif"
    FORMAT_WEBM: Final[str] = "webm"
    FORMAT_MP4: Final[str] = "mp4"

    #: Ordered so ``FORMAT_PNG_ZIP`` is first: it is the only encoder with no
    #: external dependency, which makes it the documented fallback when ffmpeg
    #: is missing or fails (F9 §8.5).
    FORMATS: Final[tuple[str, ...]] = (
        "png-zip",
        "gif",
        "webm",
        "mp4",
    )
    FALLBACK_FORMAT: Final[str] = "png-zip"

    MIME_BY_FORMAT: Final[dict[str, str]] = {
        "png-zip": "application/zip",
        "gif": "image/gif",
        "webm": "video/webm",
        "mp4": "video/mp4",
    }
    EXTENSION_BY_FORMAT: Final[dict[str, str]] = {
        "png-zip": "zip",
        "gif": "gif",
        "webm": "webm",
        "mp4": "mp4",
    }

    #: Formats that can carry a real alpha channel. MP4 cannot in any profile a
    #: browser will play, so an MP4 request with a transparent background is
    #: matted and told so rather than shipping a black-boxed figure.
    ALPHA_CAPABLE_FORMATS: Final[frozenset[str]] = frozenset(
        {"png-zip", "gif", "webm"}
    )

    #: Matte applied when a format cannot carry alpha and the caller asked for
    #: transparent. Black rather than white because it is what a video player
    #: letterboxes with anyway.
    OPAQUE_FALLBACK_BACKGROUND: Final[str] = "black"

    PNG_FRAME_NAME_TEMPLATE: Final[str] = "{stem}-{index}.png"
    PNG_ZIP_README_NAME: Final[str] = "README.txt"

    #: Deflate level for the frame zip. PNG payloads are already deflated, so a
    #: higher level buys almost nothing and costs real CPU in a request handler.
    ZIP_COMPRESS_LEVEL: Final[int] = 1

    #: GIF reserves one palette index for "nothing here". 255 entries of colour
    #: plus one transparent slot is what ``rgba4444`` + ``oneBitAlpha`` bought
    #: in the v3 browser encoder; without the reserved slot the cut-out edge
    #: picks up whatever colour the quantizer assigns the empty pixels.
    GIF_PALETTE_COLOURS: Final[int] = 255
    GIF_TRANSPARENT_INDEX: Final[int] = 255

    #: GIF alpha is one bit, so a partially transparent pixel has to choose.
    #: Half coverage is the threshold that keeps an antialiased silhouette the
    #: same visual weight it had with a full alpha channel.
    GIF_ALPHA_THRESHOLD: Final[int] = 128

    #: Restore-to-background between frames. Required with a transparent index:
    #: without it, a moving figure smears because the previous frame's pixels
    #: are never cleared.
    GIF_DISPOSAL_RESTORE_BACKGROUND: Final[int] = 2
    GIF_LOOP_FOREVER: Final[int] = 0
    GIF_LOOP_ONCE: Final[int] = 1

    #: Pixels sampled per frame when building the shared GIF palette. A global
    #: palette rather than one per frame: per-frame palettes make the figure's
    #: colours shift as it moves, which reads as flickering.
    GIF_PALETTE_SAMPLE_PER_FRAME: Final[int] = 4096

    #: VP9 carries alpha through ``yuva420p``, which is why WebM is the video
    #: format offered for transparent output.
    WEBM_CODEC: Final[str] = "libvpx-vp9"
    WEBM_PIX_FMT_ALPHA: Final[str] = "yuva420p"
    WEBM_PIX_FMT_OPAQUE: Final[str] = "yuv420p"
    #: Constant-quality VP9. 30 is visually transparent on flat cel artwork and
    #: roughly a third the size of 20.
    WEBM_CRF: Final[str] = "30"
    WEBM_BITRATE: Final[str] = "0"

    #: libvpx-vp9 defaults to its slowest search, which costs several hundred
    #: milliseconds per frame — at ``MAX_FRAMES`` that alone can outrun the
    #: gateway's 120s request budget and turn a working render into a timeout.
    #: ``cpu-used 4`` is roughly an order of magnitude faster and visually
    #: indistinguishable on flat cel artwork, which has almost no high-frequency
    #: detail for the extra search to find.
    WEBM_DEADLINE: Final[str] = "good"
    WEBM_CPU_USED: Final[str] = "4"

    #: Row-based multithreading, bounded rather than "all cores": several stage
    #: workers run concurrently under ``Config.anibuddy.workerConcurrency``, and
    #: an unbounded thread count per encoder oversubscribes the box.
    WEBM_ROW_MT: Final[str] = "1"
    ENCODER_THREADS: Final[str] = "4"

    MP4_CODEC: Final[str] = "libx264"
    MP4_PIX_FMT: Final[str] = "yuv420p"
    MP4_CRF: Final[str] = "20"
    #: x264's default. ``slow`` was measured at several times the cost for no
    #: visible gain here: what hurts cel artwork in H.264 is ``yuv420p`` chroma
    #: subsampling on hard edges, and no preset fixes that — a lower CRF is the
    #: lever that does, which is why this pairs ``medium`` with CRF 20.
    MP4_PRESET: Final[str] = "medium"
    #: Moves the moov atom to the front so a browser can start playing before
    #: the whole file has arrived.
    MP4_FASTSTART_FLAG: Final[str] = "+faststart"

    # --- Cost guard --------------------------------------------------------

    #: Measured rasterizer throughput in destination pixels per second, where a
    #: "destination pixel" is one pixel of one layer's bounding box on one frame
    #: (so overlapping layers each count their own). ``tools/profile_render.py``
    #: measures 3-6 M/s depending on rig shape; the low end is taken on purpose,
    #: because the estimate uses each part's REST rect while a rotated part
    #: occupies a larger box, and an optimistic constant would let a job through
    #: that then times out.
    RASTER_PIXELS_PER_SECOND: Final[float] = 3.0e6

    #: Rasterization budget for one render. Deliberately below the gateway's own
    #: 120s request timeout (``Config.pyBackend.timeoutMs``), leaving room for
    #: encoding and for shipping the artifact back. A job estimated past this is
    #: refused with the two levers named rather than allowed to time out — a
    #: timeout loses the work AND tells the user nothing.
    RASTER_BUDGET_SECONDS: Final[float] = 90.0

    #: Hard wall on an encoder subprocess. A hung ffmpeg in a request handler is
    #: indistinguishable from a hung service, so it is killed and the render
    #: falls back to the PNG zip.
    ENCODER_TIMEOUT_SECONDS: Final[float] = 120.0

    #: Bytes of stderr kept from a failed encoder, for the warning text. Enough
    #: for ffmpeg's actual error line, short enough for a 2000-char message.
    ENCODER_STDERR_TAIL_BYTES: Final[int] = 600

    # --- Artifact handoff --------------------------------------------------

    #: Node owns the ``StorageAdapter``. Below this size the artifact rides back
    #: inline as base64 (the existing infra-slice contract); above it, Node is
    #: handed a fetch path instead, because base64 inflates by 4/3 and a
    #: 120-frame PNG zip in a JSON body is tens of megabytes per in-flight job.
    #: See ``render/service.py`` for the full rationale.
    ARTIFACT_INLINE_MAX_BYTES: Final[int] = 256 * 1024

    ARTIFACT_KIND: Final[str] = "render"

    #: Content-addressed on the render cache key, so an unchanged rig re-renders
    #: to the same key and Node's upload is idempotent.
    ARTIFACT_KEY_TEMPLATE: Final[str] = (
        "anibuddy/{project_id}/render/{cache_key}.{extension}"
    )
    ARTIFACT_DOWNLOAD_PATH_TEMPLATE: Final[str] = "/anibuddy/render/artifacts/{cache_key}"

    # --- Cache -------------------------------------------------------------

    #: In-process artifact cache. This is a worker-local memo, not the system of
    #: record — Node's ``artifactRefs`` plus the content-addressed storage key
    #: are what survive a restart. Two entries is enough to make the common
    #: "re-request the render you just previewed" free without holding a whole
    #: clip library resident.
    CACHE_MAX_ENTRIES: Final[int] = 8
    CACHE_MAX_BYTES: Final[int] = 192 * 1024 * 1024

    #: Version tag folded into every cache key. Bumping it invalidates every
    #: cached artifact, which is the required move whenever the rasterizer or an
    #: encoder changes in a way that alters output bytes.
    #:
    #: Bumped to /2 when the part transform tree landed. The inputs that key a
    #: render did not change — ``pivot``, ``parentPartId``, ``attachSlot`` and
    #: the clip's part channels were all already folded in — but their MEANING
    #: did: the same document now renders different pixels. That is exactly the
    #: case a content hash cannot see, and exactly what this tag is for.
    #:
    #: Bumped to /3 by the schema/kernel reconciliation, for the same reason
    #: three times over: a lattice's ``controlPoints`` hash to the same bytes and
    #: are now read as absolute positions rather than as offsets from a rest
    #: grid; a spline's ``thickness`` buffer is unchanged and is now a taper
    #: track rather than a set of values to average; and a null ``boundJointId``
    #: now rides the root rather than nothing.
    #:
    #: Bumped to /4 by the compositing-semantics reconciliation, twice over and
    #: for the same reason again — identical bytes, different meaning.
    #: ``Part.opacity`` is now the REST value of ``PartPose.opacity`` instead of
    #: a gain multiplied onto it, so any clip that keys opacity on a part
    #: authored below 1 renders differently; and ``PartPose.swapTo`` now
    #: substitutes PIXELS rather than the whole posed part, so a swap draws the
    #: referring part's geometry with the target's artwork instead of the
    #: target's geometry.
    CACHE_KEY_VERSION: Final[str] = "render-cache/4"

    # --- Provenance --------------------------------------------------------

    #: Bumped to /2 by the compositing-semantics reconciliation. The stage's
    #: inputs and outputs are unchanged in shape and it renders the same document
    #: to different pixels, so a revision produced before this bump cannot be
    #: compared to one after it without knowing which reading of ``Part.opacity``
    #: and ``PartPose.swapTo`` produced it. That is what a pipeline version is
    #: for; the cache key version above handles invalidation separately.
    PIPELINE_VERSION: Final[str] = "anibuddy-render/2"
    KERNEL_VERSION: Final[str] = "0.2.0-numpy"
    REVISION_REASON: Final[str] = "render"

    #: Rasterizer identity recorded in the stage message. Rasterization is
    #: deliberately NOT shared with the browser (R4) — only the vertex math is —
    #: so naming the implementation is how a support ticket about a one-pixel
    #: difference gets attributed to the right half.
    #:
    #: Bumped to /2 when the gather grew the layer's uv remap: a swapped layer
    #: now samples the target's tile through this part's own triangles instead of
    #: drawing the target's tile through the target's triangles.
    RASTERIZER: Final[str] = "numpy-inverse-affine/2"

    #: Non-generative statement shipped inside the PNG zip. R2 is an invariant,
    #: and stating it in the artifact is what makes it visible to the person who
    #: downloaded the file rather than only to whoever reads the plan.
    PNG_ZIP_README_LINES: Final[tuple[str, ...]] = (
        "Every frame is the artwork you supplied, deformed by the rig you placed.",
        "No image generation was used at any point in producing these files.",
    )


class VisionConstants:
    """Frozen knobs for the two images a vision call is allowed to see, and for
    applying what it says back onto a document.

    Same shape and same reason as ``RenderConstants``. Nothing in this class
    generates a pixel: the annotated sheet is the user's own artwork with
    outlines drawn over it, and the contact sheet is a tiling of frames the
    render stage really produced (R2).
    """

    __slots__ = ()

    # --- Caps lifted from the generated schema limits ----------------------

    MAX_PARTS: Final[int] = int(ANIBUDDY_LIMITS["MAX_PARTS"])
    MAX_PART_DEPTH: Final[int] = int(ANIBUDDY_LIMITS["MAX_PART_DEPTH"])
    MAX_JOINT_DEPTH: Final[int] = int(ANIBUDDY_LIMITS["MAX_JOINT_DEPTH"])
    MAX_KEYFRAMES: Final[int] = int(ANIBUDDY_LIMITS["MAX_KEYFRAMES"])
    MAX_STAGE_RECORDS: Final[int] = int(ANIBUDDY_LIMITS["MAX_STAGE_RECORDS"])
    MAX_CRITIQUE_PASSES: Final[int] = int(ANIBUDDY_LIMITS["MAX_CRITIQUE_PASSES"])
    MAX_CORRECTIONS_PER_PASS: Final[int] = int(
        ANIBUDDY_LIMITS["MAX_CORRECTIONS_PER_PASS"]
    )
    CONTACT_SHEET_FRAMES: Final[int] = int(
        ANIBUDDY_LIMITS["CRITIQUE_CONTACT_SHEET_FRAMES"]
    )
    MAX_PIVOT_NUDGE: Final[float] = float(ANIBUDDY_LIMITS["CRITIQUE_MAX_PIVOT_NUDGE"])
    MIN_ROTATION_DAMP: Final[float] = float(
        ANIBUDDY_LIMITS["CRITIQUE_MIN_ROTATION_DAMP"]
    )
    CONFIDENCE_REVIEW_FLOOR: Final[float] = float(
        ANIBUDDY_LIMITS["CONFIDENCE_REVIEW_FLOOR"]
    )

    # --- Revalidation band -------------------------------------------------

    #: How far outside a schema bound a number may sit and still be CLAMPED
    #: rather than rejected, as a fraction of the bound's own span (F9 §11.4).
    #: The asymmetry is the whole point: a value 3% past a limit is a rounding
    #: artifact and clamping it loses nothing, while a value 5x past it means
    #: the model misunderstood the units and every other number in the same
    #: response is suspect. Refuse rather than repair (R7).
    CLAMP_TOLERANCE: Final[float] = 0.20

    # --- Annotated sheet (semantics stage input) ----------------------------

    #: Longest edge of the annotated sheet handed to the vision model. Vision
    #: models downsample anyway, and a 8192px sheet costs image tokens for
    #: detail no role decision depends on.
    ANNOTATION_MAX_EDGE: Final[int] = 1024

    #: Outline stroke width and label scale are derived from the sheet's longest
    #: edge so a 256px sprite and a 1024px sheet both get a readable overlay
    #: rather than a hairline on one and a slab on the other.
    ANNOTATION_STROKE_RATIO: Final[float] = 0.0035
    ANNOTATION_MIN_STROKE_PX: Final[int] = 1
    ANNOTATION_LABEL_SCALE_RATIO: Final[float] = 0.0011
    ANNOTATION_MIN_LABEL_SCALE: Final[float] = 0.35

    #: The overlay is drawn on a WHITE matte behind the artwork rather than on
    #: transparency: a cutout sheet composited onto whatever the model's own
    #: decoder defaults to is how a dark-lineart part becomes invisible.
    ANNOTATION_MATTE_RGB: Final[tuple[int, int, int]] = (255, 255, 255)

    #: Outline and label colours, RGB. Magenta is chosen because it is outside
    #: the palette of nearly all character artwork, so an outline never reads as
    #: part of the drawing.
    ANNOTATION_OUTLINE_RGB: Final[tuple[int, int, int]] = (255, 0, 200)
    ANNOTATION_LABEL_TEXT_RGB: Final[tuple[int, int, int]] = (255, 255, 255)
    ANNOTATION_LABEL_BACKGROUND_RGB: Final[tuple[int, int, int]] = (16, 16, 24)
    ANNOTATION_LABEL_PAD_PX: Final[int] = 3

    #: Part numbers start at 1. The model is asked to answer with the part ids
    #: from the legend, and the numbers exist only so it can tell two similar
    #: silhouettes apart when it reasons about the picture.
    ANNOTATION_FIRST_LABEL: Final[int] = 1

    # --- Contact sheet (critique stage input) -------------------------------

    #: Grid shape for ``CONTACT_SHEET_FRAMES``. 3x3 for the schema's 9 is square,
    #: which is the layout a vision model's fixed-aspect tiling degrades least.
    CONTACT_SHEET_COLUMNS: Final[int] = 3

    #: Longest edge of ONE tile. Nine of these plus gutters is the whole sheet,
    #: so this is the number that bounds the image-token bill of a pass.
    CONTACT_SHEET_TILE_MAX_EDGE: Final[int] = 320

    #: Gutter between tiles and the sheet's outer margin, in pixels. A gutter is
    #: not decoration: without it a limb leaving frame N reads as continuing
    #: into frame N+1 and the model critiques a motion that does not exist.
    CONTACT_SHEET_GUTTER_PX: Final[int] = 6
    CONTACT_SHEET_MARGIN_PX: Final[int] = 6

    #: Contact-sheet frames are rendered against an opaque matte, because the
    #: model must see the silhouette against a known background rather than
    #: against whatever its decoder fills alpha with.
    CONTACT_SHEET_BACKGROUND: Final[str] = "white"
    CONTACT_SHEET_SHEET_RGB: Final[tuple[int, int, int]] = (232, 232, 236)
    CONTACT_SHEET_TILE_BORDER_RGB: Final[tuple[int, int, int]] = (120, 120, 130)
    CONTACT_SHEET_LABEL_TEXT_RGB: Final[tuple[int, int, int]] = (16, 16, 24)
    CONTACT_SHEET_LABEL_SCALE: Final[float] = 0.4
    CONTACT_SHEET_LABEL_THICKNESS: Final[int] = 1

    #: Format the contact-sheet render asks the render stage for. PNG frames are
    #: the only encoder with no external dependency, and the tiler needs the
    #: individual frames rather than a video (F9 §8.5).
    CONTACT_SHEET_RENDER_FORMAT: Final[str] = "png-zip"

    #: Encoded MIME of the composed sheet, and the data-URL prefix the Node
    #: caller hands to the vision provider.
    CONTACT_SHEET_MIME: Final[str] = "image/png"
    DATA_URL_TEMPLATE: Final[str] = "data:{mime};base64,{payload}"

    # --- Provenance --------------------------------------------------------

    PIPELINE_VERSION: Final[str] = "anibuddy-critique/1"
    KERNEL_VERSION: Final[str] = "0.2.0-numpy"

    #: Revision reason written by the corrections applier. Named so the editor's
    #: revision list can group critique passes without matching a literal.
    REVISION_REASON: Final[str] = "critique"

    #: A critique revision is always a PROPOSAL. `accepted` stays false even for
    #: `verdict: accept`, because the loop accepting its own work is not the user
    #: accepting it (F9 §7.2, §11.6).
    REVISION_ACCEPTED: Final[bool] = False

    #: Stage the applier records against. `critique` rather than `rig`: the
    #: corrections are parametric, and attributing them to `rig` would make the
    #: audit trail claim geometry was rebuilt when it was not.
    STAGE_NAME: Final[str] = "critique"

    #: Corrections whose effect is a request to REBUILD geometry rather than a
    #: parameter edit. The applier records them as pending deformer overrides
    #: for the next rig pass instead of editing a deformer payload in place —
    #: writing mesh geometry from a critique response would put the model one
    #: field away from authoring vertices, which R3 forbids structurally.
    RERIG_CORRECTION_KINDS: Final[tuple[str, ...]] = ("deformer-swap",)

    #: `part-visibility` payload vocabulary. Closed, because "hide" and "hidden"
    #: differing in effect is exactly the class of bug a closed set removes.
    VISIBILITY_SHOW: Final[str] = "show"
    VISIBILITY_HIDE: Final[str] = "hide"
    VISIBILITY_VALUES: Final[tuple[str, ...]] = ("show", "hide")

    #: Channels a `rotation-damp` correction scales. Only rotation: damping a
    #: translation would change where the figure is, not how hard it swings, and
    #: the model asked for the second thing.
    DAMPED_POSE_CHANNELS: Final[tuple[str, ...]] = ("rot",)

    #: Smallest gap between two keyframe times after a `keyframe-retime`. Times
    #: must stay strictly increasing; without a floor a retime can collide two
    #: keys and the sampler's bracketing search divides by zero.
    MIN_KEYFRAME_TIME_GAP: Final[float] = 1e-4

    #: A `keyframe-retime` is applied as a monotone time warp that moves the
    #: clip's midpoint to the requested time (see ``corrections.py``). The peak
    #: is held away from both ends because a warp onto t=0 or t=1 collapses half
    #: the clip into a single instant, which is not a retime — it is a deletion.
    MIN_RETIME_PEAK: Final[float] = 0.05
    MAX_RETIME_PEAK: Final[float] = 0.95

    #: Midpoint the retime warp moves. Fixed at the clip's centre rather than
    #: measured from the keyframes: the warp has to be reproducible from the
    #: correction alone, and a data-dependent pivot makes the same scalar mean
    #: something different on every clip.
    RETIME_SOURCE_PEAK: Final[float] = 0.5

    #: Pivots stay inside the part-local unit square after a nudge. A pivot
    #: outside its own part is a rotation centre in another part's artwork.
    PIVOT_MIN: Final[float] = 0.0
    PIVOT_MAX: Final[float] = 1.0

    MAX_STAGE_MESSAGE_LENGTH: Final[int] = 2000
    MAX_DIAGNOSTIC_WARNINGS: Final[int] = 64
    MAX_DIAGNOSTIC_WARNING_LENGTH: Final[int] = 500
