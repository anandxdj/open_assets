// Every editor-side magic number, in one place (Rule 9).
//
// Nothing here is a schema constraint or a kernel invariant. Those live in
// ANIBUDDY_LIMITS (generated from the JSON Schema) and KernelConstants
// respectively, and re-declaring either of them is a review rejection (R10).
// What is left over -- hit radii, pointer thresholds, IK iteration budgets,
// poll intervals -- is genuinely presentation policy, and belongs here.

import { ANIBUDDY_LIMITS } from "@/features/anibuddy/rig/index.rig";

export const EditorConstants = Object.freeze({
  // --- Viewport ------------------------------------------------------------

  /**
   * Longest edge of the drawing surface, in CSS pixels. The sheet is letterboxed
   * into this, so a 4096px sheet and a 512px sheet get the same on-screen size
   * and the same handle sizes.
   */
  VIEWPORT_MAX_EDGE: 720,

  /** Upper bound on devicePixelRatio honoured by the backing store. */
  MAX_DEVICE_PIXEL_RATIO: 2,

  /** Checkerboard cell size, in CSS pixels, for the transparency backdrop. */
  CHECKER_CELL_PX: 12,

  // --- Handles and hit testing --------------------------------------------

  /** Drawn radius of a joint handle, in CSS pixels. */
  JOINT_HANDLE_RADIUS_PX: 6,

  /**
   * Pick radius of a joint handle, in CSS pixels. Larger than the drawn radius
   * because a 6px target is not reachable with a trackpad, and a joint that
   * cannot be grabbed is a joint that cannot be posed.
   */
  JOINT_PICK_RADIUS_PX: 14,

  /**
   * Pointer travel, in CSS pixels, before a press becomes a drag. Below this a
   * press is a selection click, so tapping a joint to inspect it does not write
   * a keyframe.
   */
  DRAG_THRESHOLD_PX: 3,

  // --- Inverse kinematics --------------------------------------------------

  /**
   * Chain length used when a joint carries no `ikChainLength`.
   *
   * One link. Dragging an FK-only joint rotates its parent and nothing above,
   * which is the same solver with a shorter chain rather than a second code
   * path.
   */
  FK_CHAIN_LENGTH: 1,

  /**
   * Cyclic-coordinate-descent sweeps per pointer move. Four is enough for the
   * two- and three-link chains the archetype priors actually emit, and it keeps
   * the solve inside one animation frame on a 64-part rig.
   */
  IK_ITERATIONS: 4,

  /** Effector-to-target distance, in source pixels, treated as solved. */
  IK_TOLERANCE_PX: 0.5,

  /**
   * Per-joint per-sweep rotation cap, in degrees. Without it a chain whose
   * effector is nearly coincident with a chain joint takes a huge step from a
   * numerically meaningless angle and the limb snaps inside out.
   */
  IK_MAX_STEP_DEG: 30,

  /**
   * Below this distance, in source pixels, from a chain joint to the effector or
   * the target, the angle between them has no usable direction and the joint is
   * skipped for this sweep.
   */
  IK_MIN_LEVER_PX: 1e-3,

  // --- Pose channel bounds (editor affordances, not schema limits) ---------

  /** Slider range for `rot`, in degrees. */
  ROTATION_RANGE_DEG: 180,

  /** Slider range for `tx`/`ty`, in figure-height fractions (R6). */
  TRANSLATION_RANGE: 1,

  /** Slider range for `scale`. */
  SCALE_MIN: 0.2,
  SCALE_MAX: 3,

  /** Step used by the numeric inputs in the inspector. */
  ROTATION_STEP_DEG: 0.5,
  TRANSLATION_STEP: 0.005,
  SCALE_STEP: 0.01,
  OPACITY_STEP: 0.01,

  /** Draw-order range an editor may author. Matches the critique z-order bound. */
  Z_INDEX_MIN: -512,
  Z_INDEX_MAX: 512,

  // --- Timeline ------------------------------------------------------------

  /** Frame count floor. Two keys is the minimum a clip can interpolate between. */
  MIN_FRAMES: 2,

  /** Frame count ceiling, from the schema. Restated here only as an alias. */
  MAX_FRAMES: ANIBUDDY_LIMITS.MAX_FRAMES,

  /** fps ceiling, from the schema. */
  MAX_FPS: ANIBUDDY_LIMITS.MAX_FPS,

  /** fps values offered in the picker. All are <= MAX_FPS. */
  FPS_CHOICES: Object.freeze([8, 12, 24, 30, 60] as const),

  /** Default sampling rate for a hand-authored clip. */
  DEFAULT_FPS: 12,

  /** Default length of a hand-authored clip, in frames. */
  DEFAULT_FRAME_COUNT: 24,

  /**
   * Keyframe pick tolerance on the timeline, as a fraction of one frame. Half a
   * frame either side, so every authored key is reachable by exactly one frame
   * cell and no key is unreachable.
   */
  KEYFRAME_PICK_FRAMES: 0.5,

  // --- Clip identity -------------------------------------------------------

  /**
   * Prefix and random-hex length of a hand-authored clip's id.
   *
   * Sized to the schema's 32-character id pattern rather than to a UUID's 36:
   * `clip_` plus 16 hex characters is 21, which leaves room for the prefix to stay
   * readable in a revision reason (`clip-create:clip_…`) without truncation.
   */
  CLIP_ID_PREFIX: "clip_",
  CLIP_ID_HEX_CHARS: 16,

  // --- Pipeline polling ----------------------------------------------------

  /** Poll interval, in ms, while a stage is queued or running. */
  POLL_ACTIVE_MS: 1500,

  /** Poll interval, in ms, while nothing is in flight. */
  POLL_IDLE_MS: 15000,

  /**
   * Consecutive poll failures tolerated before polling stops and the error is
   * surfaced. Without a cap a dead gateway produces an unbounded request loop.
   */
  POLL_MAX_FAILURES: 4,

  // --- Preview evaluation --------------------------------------------------

  /**
   * Source-pixel to destination-surface scale handed to the kernel.
   *
   * One, because the preview's projection matrix maps source pixels onto the
   * canvas on the GPU: the kernel's destination surface IS the sheet. The render
   * worker passes its own output scale here instead, and that is the only input
   * the two callers legitimately differ on -- the kernel applies it at the final
   * warp only, so a preview and an export differ by one multiply rather than by
   * a different evaluation.
   */
  PREVIEW_SCALE: 1,

  // --- Preview fallbacks ---------------------------------------------------

  /**
   * Id of the anchor joint synthesized when a document has an empty skeleton.
   *
   * MIN_JOINTS is 0 -- a prop or a parallax sheet legitimately has no joints --
   * but forward kinematics needs a root to hang the parts on. The synthetic
   * joint sits at the sheet centre, carries no pose, and is never written back
   * to the document.
   */
  SYNTHETIC_ROOT_JOINT_ID: "__preview_root__",

  /** Where the synthetic root sits, sheet-normalized (R6). */
  SYNTHETIC_ROOT_X: 0.5,
  SYNTHETIC_ROOT_Y: 0.5,

  // --- Renderer palette ----------------------------------------------------

  /**
   * Per-part tints, as linear RGB plus a mix strength.
   *
   * Tinting is applied per PART rather than per triangle. The kernel reports
   * `maxStretch` and `flippedTriangles` as frame-level counts, not as a per-
   * triangle list, and recomputing which triangles they came from would mean
   * re-deriving the singular-value metric on this side of the wire -- exactly the
   * duplication R12 warns about. A tinted part plus the numbers is honest; a
   * re-derived per-triangle heatmap that disagrees with the server's numbers is
   * not.
   */
  TINT: Object.freeze({
    /** A part whose worst triangle exceeds STRETCH_WARNING. */
    stretched: Object.freeze([0.98, 0.68, 0.11, 0.4] as const),
    /** A part with at least one orientation-flipped triangle. */
    flipped: Object.freeze([0.94, 0.27, 0.27, 0.55] as const),
    /** The current selection. */
    selected: Object.freeze([0.75, 0.15, 0.83, 0.28] as const),
    /** No tint. */
    none: Object.freeze([0, 0, 0, 0] as const),
  }),

  /** Wireframe overlay stroke, as RGBA. */
  WIREFRAME_COLOR: Object.freeze([0.09, 0.09, 0.11, 0.45] as const),
});

export type EditorConstantName = keyof typeof EditorConstants;
