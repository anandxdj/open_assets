// Shared shapes for the three proposal calls.
//
// The three PROPOSAL types themselves are generated — `SemanticsProposal`,
// `MotionProposal` and `CritiqueReport` come from the canonical JSON Schema and
// are imported, never redeclared (R10). What lives here is everything around
// them: the wire projection a strict-schema provider can actually express, the
// revalidation result, and the per-pass loop bookkeeping.

import type {
  CritiqueReport,
  MotionProposal,
  PartRole,
  SemanticsProposal,
} from "../rig/index.rig";
import type { ProposalErrorCode } from "./proposal.constants";

/**
 * Either a validated value or one user-facing rejection sentence.
 *
 * A single reason string rather than a list, because the reason is fed straight
 * back to the model on the retry (F9 §11.5) and a model handed five complaints
 * fixes the last one.
 */
export type Revalidation<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; reason: string };

/** What a route hands back when a proposal call could not be served. */
export type ProposalFailure = {
  ok: false;
  code: ProposalErrorCode;
  status: number;
  error: string;
  /**
   * Whether the credits for this call should be returned.
   *
   * False for work that really happened. Reported rather than inferred from the
   * status, because the two come apart — a revalidation rejection and a py_backend
   * refusal are both 422s and only one is owed back. The gateway's critique loop
   * branches on this; see its refund table in
   * `backend/src/modules/anibuddy/anibuddy.critique.loop.ts`.
   */
  refundable: boolean;
};

export type ProposalSuccess<T> = {
  ok: true;
  value: T;
  /** The model that actually SERVED the call, for `reconcileUsage` (F9 §13). */
  servedModel: string;
  provider: string;
  warnings: string[];
  /** True when the first attempt was rejected and the retry produced this. */
  retried: boolean;
};

export type ProposalResult<T> = ProposalSuccess<T> | ProposalFailure;

// ─────────────────────────────────────────────────────────────────────────────
// Wire projections
//
// OpenAI-compatible `strict: true` structured output cannot express two things
// the canonical schema uses: a map with dynamic keys, and an optional property.
// Every property must be listed in `required`, and `additionalProperties` must
// be false with no pattern-keyed alternative.
//
// So the wire shape below is a PROJECTION of the canonical schema, not a second
// copy of it: dynamic maps become arrays keyed by an explicit `id`, and optional
// numeric channels become nullable-and-required. Revalidation converts the
// projection into the real generated type, and null becomes "absent" — which is
// exactly the sparsity rule §7.7 depends on.
// ─────────────────────────────────────────────────────────────────────────────

export type WireJointChannels = {
  id: string;
  rot: number | null;
  tx: number | null;
  ty: number | null;
  scale: number | null;
};

export type WirePartChannels = {
  id: string;
  rot: number | null;
  tx: number | null;
  ty: number | null;
  scale: number | null;
  visible: boolean | null;
  opacity: number | null;
  zIndex: number | null;
  swapTo: string | null;
};

export type WireKeyframe = {
  t: number;
  ease: "linear" | "ease" | "hold";
  joints: WireJointChannels[];
  parts: WirePartChannels[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

/** One row of the number-to-part-id legend py_backend drew onto the sheet. */
export type PartLegendEntry = {
  partId: string;
  label: number;
  name: string;
  role: PartRole | string;
  zIndex: number;
  confidence: number;
};

/** What the semantics call needs: the annotated image plus what it must bind to. */
export type SemanticsCallInput = {
  imageDataUrl: string;
  legend: PartLegendEntry[];
  /** The archetype the pipeline currently believes. The model may change it. */
  archetype: string;
};

/** The real ids a motion proposal may reference. Anything else is rejected. */
export type MotionCallInput = {
  imageDataUrl: string;
  request: string;
  partIds: string[];
  joints: Array<{ id: string; role: string; parent: string | null }>;
  defaultFps: number;
  defaultFrameCount: number;
};

export type CritiqueCallInput = {
  imageDataUrl: string;
  passIndex: number;
  columns: number;
  rows: number;
  frameTimes: number[];
  partIds: string[];
  jointIds: string[];
  clipIds: string[];
  /** Measured on the frames the model is looking at, so it can be told about them. */
  maxStretch: number;
  flippedTriangles: number;
};

// The loop's per-pass bookkeeping types are deliberately NOT here any more.
// `LoopRevision`, `CritiquePassOutcome`, `LoopStopReason` and the best-revision
// selection moved with the loop into
// `backend/src/modules/anibuddy/anibuddy.critique.types.ts`. They described one
// implementation's internal state, and leaving a copy behind would leave two
// declarations of the stop-reason set for one loop to disagree with.

export type { CritiqueReport, MotionProposal, SemanticsProposal };
