// Every magic number the deformation kernel uses, in one place.
//
// This module is mirrored, value for value, by
// py_backend/app/modules/anibuddy/kernel/constants.py. The two deformation
// kernels are independent implementations of the same math, so a constant that
// drifts between them is a silent export bug: the artist poses in the browser,
// the server renders something else, and nothing fails loudly. Any edit here
// must be made in the Python file in the same commit, and the parity harness
// (scripts/test-anibuddy-kernel.sh) is what enforces that.

export const KernelConstants = {
  // --- Triangle warp -------------------------------------------------------

  /**
   * Below this absolute area (in source pixels squared) a source triangle is
   * degenerate: its inverse is numerically meaningless and the affine warp
   * derived from it would be garbage, so the triangle is skipped entirely.
   */
  MIN_TRIANGLE_AREA: 1e-4,

  /**
   * Outward push, in destination pixels, applied to every destination triangle
   * about its centroid before it is used as a clip path. Adjacent clipped
   * triangles otherwise leave hairline antialiasing gaps along every shared
   * edge, which reads as a cracked figure.
   */
  SEAM_BLEED: 0.5,

  /**
   * Anisotropy (sigmaMax / sigmaMin) above which a triangle is smeared far
   * enough out of shape to be worth surfacing to the user rather than quietly
   * shipping.
   */
  STRETCH_WARNING: 2.5,

  /**
   * sigmaMin below this is treated as zero, making the stretch ratio infinite
   * (i.e. the triangle collapsed to a line). Such triangles are excluded from
   * maxStretch rather than poisoning it with Infinity.
   */
  SINGULAR_EPSILON: 1e-6,

  /**
   * A destination vertex closer than this to its triangle centroid has no
   * well-defined outward direction, so it is left where it is instead of being
   * pushed in an arbitrary one.
   */
  BLEED_LENGTH_EPSILON: 1e-6,

  // --- Keyframe interpolation ----------------------------------------------

  /**
   * Keyframe time comparison tolerance. Keyframe times are authored as
   * normalized 0..1 floats, so exact equality would make a key at 0.3
   * unreachable at t = 0.3.
   */
  KEYFRAME_EPSILON: 1e-4,

  /**
   * Rest value for the `scale` channel. A channel absent from one side of a
   * keyframe pair falls back to rest rather than to the other side's value, so
   * a key that only sets `rot` does not freeze `scale`.
   */
  REST_SCALE: 1,

  /** Rest value for every channel other than `scale`. */
  REST_DEFAULT: 0,

  // --- Part transform tree --------------------------------------------------

  /**
   * Deepest chain of `parentPartId` links the kernel will evaluate, counted in
   * EDGES: a root part is depth 0, its child depth 1. Mirrors the wire schema's
   * MAX_PART_DEPTH, and is declared here rather than imported for the same
   * reason MIN_TRIANGLE_AREA and STRETCH_WARNING are -- the kernel's numeric
   * contract has to be readable, and identical, from Python, which cannot
   * import a TypeScript constant. A document that exceeds it is refused, not
   * truncated: a truncated tree drops a part's parent and leaves it animating
   * in place while its siblings move.
   */
  MAX_PART_DEPTH: 8,

  /**
   * Attachment points one part may offer. Mirrors the schema's
   * MAX_SLOTS_PER_PART for the same reason as above.
   */
  MAX_SLOTS_PER_PART: 8,

  /**
   * Rect a part falls back to when the caller states none: the whole sheet,
   * which collapses part-local and sheet-normalized onto the same space.
   */
  FULL_SHEET_RECT: [0, 0, 1, 1] as readonly [number, number, number, number],

  /**
   * Pivot a part falls back to: the centre of its own rect. Wrong for every
   * specific part and harmless for all of them, because a part that never
   * rotates never reads its pivot.
   */
  DEFAULT_PIVOT: [0.5, 0.5] as readonly [number, number],

  // --- Lattice (free-form deformation) --------------------------------------

  /**
   * Samples per lattice cell edge when evaluating a bicubic lattice. The
   * bicubic surface is curved inside a cell, but the renderer draws flat
   * affine-warped triangles, so the cell has to be subdivided for the curvature
   * to survive rasterization. Bilinear needs no subdivision: the per-triangle
   * affine warp already reproduces bilinear exactly at the cell corners.
   */
  LATTICE_BICUBIC_SUBDIV: 4,

  /** Sanity bounds on hand-authored lattice dimensions. */
  LATTICE_MIN_DIVISIONS: 1,
  LATTICE_MAX_DIVISIONS: 64,

  // --- Spline warp ----------------------------------------------------------

  /**
   * Samples along a spline are `segments + 1`. Bounds keep a bad authoring
   * value from producing either a degenerate ribbon or millions of verts.
   */
  SPLINE_MIN_SEGMENTS: 1,
  SPLINE_MAX_SEGMENTS: 256,

  /**
   * A curve tangent shorter than this has no usable direction (the control
   * points coincide), so the normal falls back to the chord direction.
   */
  SPLINE_TANGENT_EPSILON: 1e-9,

  /**
   * Catmull-Rom to Bezier conversion factor. The interior Bezier controls sit
   * one sixth of the neighbour chord away from the span endpoints, which is
   * what makes the piecewise curve C1 continuous.
   */
  CATMULL_ROM_SIXTH: 1 / 6,

  // --- Parity ---------------------------------------------------------------

  /**
   * Maximum float32 ULP distance tolerated between the TypeScript and Python
   * kernels for a position-like output.
   *
   * Four ULPs, not an absolute epsilon, because the tolerance has to scale with
   * coordinate magnitude: 4 ULP is ~4.8e-7 px near the origin and ~4.9e-4 px at
   * 4096 px. An absolute epsilon tight enough for the origin would
   * false-positive at the far corner of a large sheet, and one loose enough for
   * the far corner would hide a real bug near the origin.
   *
   * Four is the budget for the only legitimate source of divergence: both
   * kernels compute in float64 and round to float32 once at the boundary, so a
   * 1 ULP float64 difference in libm sin/cos/atan2 propagates through at most a
   * couple of multiply-adds before that rounding absorbs it. Any real
   * algorithmic defect -- a swapped bone column, a dropped scale, a transposed
   * warp matrix -- moves a vertex by whole pixels, which is roughly 2^13 ULP at
   * 1024 px. The gap between "tolerated" and "detected" is about three orders
   * of magnitude.
   */
  PARITY_ULP_TOLERANCE: 4,

  /**
   * Relative tolerance for maxStretch specifically. Looser than the position
   * tolerance because sigmaMin is computed as `abs(sum - difference)` of two
   * nearly equal quantities on a nearly rigid triangle: catastrophic
   * cancellation there can amplify a sub-ULP input difference into several
   * significant figures of the ratio. The metric is a user-facing warning, not
   * geometry, so this is safe to relax -- but only this one field.
   */
  PARITY_STRETCH_RELATIVE_TOLERANCE: 1e-5,

  /**
   * Pose channels, in the order they are interpolated. The order matches the
   * Python kernel; the channels are independent so it does not affect results.
   */
  POSE_CHANNELS: ["rot", "tx", "ty", "scale"] as const,
} as const;
