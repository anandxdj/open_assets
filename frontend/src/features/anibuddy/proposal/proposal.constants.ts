// Every cap, budget, ceiling and error code the AniBuddy AI layer agrees on.
//
// Rule 9 / R10: anything that exists in `ANIBUDDY_LIMITS` is RE-EXPORTED from
// there, never restated. A second declaration of MAX_CRITIQUE_PASSES is a
// review rejection, because the two copies will disagree exactly once and the
// disagreement will be a billing incident.

import { ANIBUDDY_LIMITS } from "../rig/index.rig";

/**
 * Typed error codes. Every failure a caller can act on differently gets one, so
 * the UI branches on a code rather than on a message substring — the messages
 * are user-facing sentences and are expected to be rewritten.
 */
export const PROPOSAL_ERROR_CODES = Object.freeze({
  /** The pipeline flag is off. Not an error the user caused. */
  DISABLED: "ANIBUDDY_PIPELINE_DISABLED",
  /** The request body did not describe a document this route can work on. */
  BAD_REQUEST: "ANIBUDDY_BAD_REQUEST",
  /** `AssetRef.remoteVisionConsented` is false (F9 §7.3). */
  CONSENT_REQUIRED: "ANIBUDDY_VISION_CONSENT_REQUIRED",
  /** Provider chain exhausted: no usable response at all. */
  PROVIDER_FAILED: "ANIBUDDY_PROVIDER_FAILED",
  /** A response arrived and failed revalidation twice. Refund, fall back. */
  SEMANTICS_INVALID: "ANIBUDDY_SEMANTICS_INVALID",
  MOTION_INVALID: "ANIBUDDY_MOTION_INVALID",
  CRITIQUE_INVALID: "ANIBUDDY_CRITIQUE_INVALID",
  /** py_backend refused the image work or the corrections. */
  PIPELINE_REFUSED: "ANIBUDDY_PIPELINE_REFUSED",
  /** py_backend was unreachable. */
  PIPELINE_UNAVAILABLE: "ANIBUDDY_PIPELINE_UNAVAILABLE",
});

export type ProposalErrorCode =
  (typeof PROPOSAL_ERROR_CODES)[keyof typeof PROPOSAL_ERROR_CODES];

export const ProposalConstants = Object.freeze({
  // --- Caps re-exported from the generated schema limits -------------------
  //
  // Named here so a call site reads `ProposalConstants.maxCritiquePasses` and
  // gets the schema's value, rather than importing ANIBUDDY_LIMITS and being one
  // typo away from `undefined` compared against a number.

  maxParts: ANIBUDDY_LIMITS.MAX_PARTS,
  maxJoints: ANIBUDDY_LIMITS.MAX_JOINTS,
  maxJointDepth: ANIBUDDY_LIMITS.MAX_JOINT_DEPTH,
  maxPartDepth: ANIBUDDY_LIMITS.MAX_PART_DEPTH,
  maxKeyframes: ANIBUDDY_LIMITS.MAX_KEYFRAMES,
  maxFps: ANIBUDDY_LIMITS.MAX_FPS,
  maxFrames: ANIBUDDY_LIMITS.MAX_FRAMES,
  maxCorrectionsPerPass: ANIBUDDY_LIMITS.MAX_CORRECTIONS_PER_PASS,

  /** One retry per call, carrying the rejection reason back (F9 §11.5). */
  retryLimit: ANIBUDDY_LIMITS.PROPOSAL_RETRY_LIMIT,

  /** Pass 0 is the initial unreviewed rig; 1..3 are critique iterations. */
  maxCritiquePasses: ANIBUDDY_LIMITS.MAX_CRITIQUE_PASSES,

  /**
   * Hard credit stop per project per loop, checked BEFORE each pass is
   * enqueued. Independent of the pass cap on purpose: a pass on a 64-part sheet
   * costs more than a pass on a 3-part one, and only the ceiling bounds the
   * worst case (F9 §11.5).
   */
  critiqueCreditCeiling: ANIBUDDY_LIMITS.CRITIQUE_CREDIT_CEILING,

  contactSheetFrames: ANIBUDDY_LIMITS.CRITIQUE_CONTACT_SHEET_FRAMES,
  maxPivotNudge: ANIBUDDY_LIMITS.CRITIQUE_MAX_PIVOT_NUDGE,
  minRotationDamp: ANIBUDDY_LIMITS.CRITIQUE_MIN_ROTATION_DAMP,
  confidenceReviewFloor: ANIBUDDY_LIMITS.CONFIDENCE_REVIEW_FLOOR,
  stretchWarning: ANIBUDDY_LIMITS.STRETCH_WARNING,

  // --- Revalidation policy -------------------------------------------------

  /**
   * How far outside a bound a number may sit and still be CLAMPED rather than
   * refused, as a fraction of the bound's own span (F9 §11.4 step 3). Mirrors
   * `VisionConstants.CLAMP_TOLERANCE` in py_backend — the two boundaries apply
   * the same rule to the same numbers, so they must agree, and a test asserts
   * the value here rather than trusting the comment.
   */
  clampTolerance: 0.2,

  // --- Billing units -------------------------------------------------------
  //
  // `units` semantics are fixed by the landed cost table
  // (backend/src/modules/usage/usage.constants.ts) and are not redesigned here:
  // rig = parts, animate = clips, critique = passes, render = frames.

  /** One critique vision call per pass. */
  critiqueUnitsPerPass: 1,
  /** One clip per animate call. */
  motionUnits: 1,

  // --- Token budgets and timeouts ------------------------------------------
  //
  // Sized per call rather than shared: the semantics call answers about up to 64
  // parts, the critique call answers about at most 12 corrections, and giving
  // the smaller one the larger budget buys nothing but latency variance.

  semanticsMaxTokens: 3600,
  motionMaxTokens: 2400,
  critiqueMaxTokens: 1600,

  /** Low, and the same for all three: these are extraction tasks, not prose. */
  temperature: 0.1,

  /**
   * Wall clock for the whole loop, under the route's `maxDuration` with room
   * for the credits round trip and the final response. A pass that cannot start
   * inside this stops the loop and the best revision so far is selected — the
   * same defined outcome as hitting the pass cap (F9 §11.6).
   */
  loopBudgetMs: 100_000,

  /**
   * Below this much remaining budget a new pass is not started. A pass is a
   * render plus a vision call; starting one with less than this leaves it to
   * time out after spending the render.
   */
  minPassBudgetMs: 25_000,

  /** Wall clock for one call to py_backend. Renders are the slow half. */
  pipelineTimeoutMs: 60_000,

  // --- Wire limits on our own request bodies -------------------------------

  maxMotionRequestLength: 500,
  maxWarnings: 32,
  maxObservations: 16,

  // --- Provider titles -----------------------------------------------------
  //
  // Per-route X-Title, which is what the provider dashboard groups spend by.

  semanticsTitle: "AniBuddy - Semantics",
  motionTitle: "AniBuddy - Motion",
  critiqueTitle: "AniBuddy - Critique",
});

export type ProposalConstantsShape = typeof ProposalConstants;
