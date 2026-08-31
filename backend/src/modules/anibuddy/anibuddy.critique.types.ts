// Bookkeeping shapes for the closed critique loop (F9 §11.5, §11.6).
//
// `CritiqueReport`, `Correction`, `CorrectionKind`, `DeformerKind`, `Diagnostics`
// and `RigDocument` are generated from the canonical JSON Schema and are imported,
// never redeclared (R10). What lives here is everything AROUND them: the per-pass
// ledger, the revision chain, and the closed set of reasons the loop can stop.

import type { AniBuddyCritiqueErrorCode } from './anibuddy.constants';
import type {
  Correction,
  CorrectionKind,
  CritiqueReport,
  DeformerKind,
  Diagnostics,
  RigDocument,
} from './dto/rig-document.generated';

/**
 * One revision the loop produced.
 *
 * `origin` is not decoration. A `render` revision's `diagnostics` were MEASURED on
 * frames that exist; a `correction` revision inherits its parent's numbers because
 * nobody has drawn it yet. Only the first kind may compete to be "best", and this
 * field is what makes that distinction available to the selector.
 */
export type AniBuddyLoopRevision = {
  passIndex: number;
  document: RigDocument;
  diagnostics: Diagnostics;
  origin: 'render' | 'correction';
};

export type AniBuddyCritiquePassOutcome = {
  passIndex: number;
  /** Absent when the pass never got a report (provider or render failure). */
  verdict: CritiqueReport['verdict'] | null;
  observations: string[];
  corrections: Correction[];
  appliedKinds: CorrectionKind[];
  deformerOverrides: Record<string, DeformerKind>;
  creditsCharged: number;
  creditsRefunded: number;
  servedModel: string | null;
  /** Present when the pass ended badly; names which failure class it was. */
  failure: { code: AniBuddyCritiqueErrorCode; error: string } | null;
};

/** Why the loop stopped. Every one of these is a defined outcome, not a crash. */
export type AniBuddyLoopStopReason =
  | 'accepted'
  | 'aborted'
  | 'pass-cap'
  | 'credit-ceiling'
  | 'time-budget'
  | 'render-failed'
  | 'critique-invalid'
  | 'provider-failed'
  | 'apply-refused';

/** Which of the three §11.6 tiers picked the winning revision. */
export type AniBuddyBestRevisionSelection =
  | 'lowest-stretch-clean'
  | 'last-unblocked'
  | 'pass-zero';

export type AniBuddyCritiqueLoopResult = {
  /** The BEST revision, not the last (F9 §11.6). */
  best: AniBuddyLoopRevision;
  /** How `best` was chosen, so the UI can explain the selection. */
  bestSelection: AniBuddyBestRevisionSelection;
  stopReason: AniBuddyLoopStopReason;
  passes: AniBuddyCritiquePassOutcome[];
  revisions: AniBuddyLoopRevision[];
  creditsCharged: number;
  creditsRefunded: number;
  /** Deformer swaps still owed a rig pass, merged across every pass. */
  deformerOverrides: Record<string, DeformerKind>;
  warnings: string[];
};

/**
 * What the vision call needs to know about the frames it is looking at.
 *
 * The id lists are the whole safety property of the call: the model may only name
 * an id that appears in one of them, and revalidation rejects the entire report
 * for an id that does not — a sign it is working from a stale revision (§11.4).
 */
export type AniBuddyCritiqueCallInput = {
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
