// The closed critique loop (F9 §11).
//
//   rig -> animate -> render (contact sheet) -> critique
//    ^                                            |
//    +----------- corrections, pass N+1 ----------+
//
// The model looks at frames the renderer really produced, not at its own plan.
// That is the entire point: a proposal is a hypothesis about pixels the model has
// never seen deformed, and a loop that fed it back its own JSON would be
// reflection dressed up as review.
//
// Dependency-injected on purpose
// ------------------------------
// Every side effect the loop needs — render a contact sheet, ask the model, apply
// corrections, charge, refund, reconcile — arrives as a function. Three payoffs,
// and the third is why the loop is here rather than beside a route handler:
//
// * The pass cap, the credit ceiling, the wall-clock budget and the best-revision
//   selection are testable without a provider, a renderer or a credit balance.
// * "Bill each pass" is one code path rather than one per call site, so a new
//   stop condition cannot forget to refund.
// * The four functions are the ONLY thing that changed when the loop moved out of
//   the Next route handler and into this gateway's BullMQ worker. The body below
//   is the body that ran there. The loop is the part that must not exist twice,
//   and it now exists here and nowhere else.
//
// Three hard stops, and they are independent
// ------------------------------------------
// * `maxPasses` (3) bounds the iteration count.
// * `creditCeiling` (24) bounds the spend, checked BEFORE a pass is enqueued.
//   Independent of the pass cap because a pass on a 64-part sheet costs more than
//   a pass on a 3-part one, and only the ceiling bounds the worst case. A resumed
//   loop carries its prior spend in, which is when the ceiling binds before the
//   pass cap does.
// * A wall-clock budget bounds the latency, so a user watching `stageProgress`
//   gets a defined ending rather than an indefinite spinner.
//
// Non-convergence is a normal outcome with a defined ending, not a retry storm:
// the loop stops, the BEST revision is selected
// (`anibuddy.critique.best-revision.ts`), the unaccepted chain is kept so the user
// can step through what was tried, and one warning names the stop condition.

import { AniBuddyBestRevisionSelector } from './anibuddy.critique.best-revision';
import { ANIBUDDY_CRITIQUE_ERROR_CODES, AniBuddyConstants } from './anibuddy.constants';
import type { AniBuddyCritiqueErrorCode } from './anibuddy.constants';
import { UsageConstants } from '../usage/usage.constants';
import type {
  AniBuddyCritiqueLoopResult,
  AniBuddyCritiquePassOutcome,
  AniBuddyLoopRevision,
  AniBuddyLoopStopReason,
} from './anibuddy.critique.types';
import type { CritiqueReport, DeformerKind, RigDocument } from './dto/rig-document.generated';

// ─────────────────────────────────────────────────────────────────────────────
// Injected dependencies
// ─────────────────────────────────────────────────────────────────────────────

export type AniBuddyRenderedPass = {
  imageDataUrl: string;
  document: RigDocument;
  columns: number;
  rows: number;
  frameTimes: number[];
  warnings: string[];
};

export type AniBuddyChargeResult =
  | { ok: true; eventId: string | null; credits: number }
  | { ok: false; status: number; error: string; code?: string };

/** The two ops one pass bills under. Neither rate is redesigned here. */
export type AniBuddyCritiqueLoopOp = 'anibuddy-critique' | 'anibuddy-render';

/**
 * Everything the loop is allowed to do to the outside world.
 *
 * `charge` returns the credits it actually took so the ledger tracks reality
 * rather than the loop's estimate. A `null` eventId is the un-metered path
 * (BYOK or development), where refund and reconcile are no-ops — the loop still
 * counts the credits so the ceiling behaves identically in both modes.
 */
export type AniBuddyCritiqueLoopDeps = {
  renderContactSheet: (input: {
    document: RigDocument;
    passIndex: number;
    usageEventId: string | null;
  }) => Promise<
    | { ok: true; value: AniBuddyRenderedPass }
    | { ok: false; code: AniBuddyCritiqueErrorCode; error: string }
  >;

  critique: (input: {
    imageDataUrl: string;
    document: RigDocument;
    passIndex: number;
    columns: number;
    rows: number;
    frameTimes: number[];
  }) => Promise<
    | { ok: true; report: CritiqueReport; servedModel: string; warnings: string[] }
    | { ok: false; code: AniBuddyCritiqueErrorCode; error: string; refundable: boolean }
  >;

  applyCorrections: (input: {
    document: RigDocument;
    report: CritiqueReport;
    passIndex: number;
    servedModel: string;
    usageEventId: string | null;
    creditsSpent: number;
  }) => Promise<
    | {
        ok: true;
        document: RigDocument;
        deformerOverrides: Record<string, DeformerKind>;
        warnings: string[];
      }
    | { ok: false; code: AniBuddyCritiqueErrorCode; error: string }
  >;

  /** Reserve credits for one op. `units` follows the landed cost table. */
  charge: (op: AniBuddyCritiqueLoopOp, units: number) => Promise<AniBuddyChargeResult>;
  refund: (eventId: string) => Promise<void>;
  reconcile: (eventId: string, model: string) => Promise<void>;

  /** Injected so a test can drive the wall-clock budget deterministically. */
  now?: () => number;
};

export type AniBuddyCritiqueLoopOptions = {
  /** Pass 0's revision: the rig as it stands before any critique. */
  document: RigDocument;
  /** Credits already spent on this project's loop, for a resumed run. */
  creditsAlreadySpent?: number;
  /** First pass index to run. 1 unless resuming (pass 0 is the unreviewed rig). */
  startPassIndex?: number;
  maxPasses?: number;
  creditCeiling?: number;
  budgetMs?: number;
};

type Ledger = {
  charged: number;
  refunded: number;
  /** Event ids of charges the loop has decided NOT to refund. */
  kept: string[];
};

type PassResult = {
  record: AniBuddyCritiquePassOutcome;
  rendered: AniBuddyLoopRevision | null;
  corrected: AniBuddyLoopRevision | null;
  warnings: string[];
  stop: AniBuddyLoopStopReason | null;
};

/**
 * What one pass charges, by op.
 *
 * Two charges, not one, and the split is what makes the refund table honest. The
 * render happens FIRST and produces frames that really exist; the vision call
 * happens second and may produce nothing usable. Billing them as one op would
 * force a single refund decision over two units of work with different outcomes
 * — and F9 §11.6 is explicit that a completed pass is not refunded while a
 * revalidation-rejected one is.
 *
 * `units` semantics come from the landed table in `usage.constants.ts`
 * (critique = passes, render = frames) and are not redesigned here.
 */
type PassCharge = { readonly op: AniBuddyCritiqueLoopOp; readonly units: number };

const RENDER_CHARGE: PassCharge = Object.freeze({
  op: AniBuddyConstants.critique.renderUsageOp,
  units: AniBuddyConstants.critique.contactSheetFrames,
});

const CRITIQUE_CHARGE: PassCharge = Object.freeze({
  op: AniBuddyConstants.critique.usageOp,
  units: AniBuddyConstants.critique.unitsPerPass,
});

/** In order. The render happens first, and the refund table depends on that. */
const PASS_CHARGES: readonly PassCharge[] = Object.freeze([RENDER_CHARGE, CRITIQUE_CHARGE]);

export const AniBuddyCritiqueLoop = {
  passCharges: PASS_CHARGES,

  /**
   * Credits one charge is EXPECTED to cost, priced from the same table the server
   * prices it from.
   *
   * A projection, and only used for the ceiling check before a pass starts; the
   * ledger then records whatever `charge` actually took. The rates are read out of
   * `UsageConstants.opCreditRates` rather than restated, which is the one thing
   * that changed about this function when the loop moved into the gateway: in Next
   * the backend's cost table was not importable, so the two rates had to be copied
   * and could drift. Here they cannot.
   *
   * `ceil(rate * units)` floored at `minCost`, matching `UsageService.costFor`.
   */
  projectedChargeCredits(op: AniBuddyCritiqueLoopOp, units: number): number {
    return Math.max(
      UsageConstants.minCost,
      Math.ceil(UsageConstants.opCreditRates[op] * units),
    );
  },

  /** Projected credits for a whole pass: the render plus the vision call. */
  projectedPassCost(): number {
    return PASS_CHARGES.reduce(
      (total, charge) => total + this.projectedChargeCredits(charge.op, charge.units),
      0,
    );
  },

  async run(
    deps: AniBuddyCritiqueLoopDeps,
    options: AniBuddyCritiqueLoopOptions,
  ): Promise<AniBuddyCritiqueLoopResult> {
    const now = deps.now ?? Date.now;
    const started = now();
    const maxPasses = options.maxPasses ?? AniBuddyConstants.critique.maxPasses;
    const ceiling = options.creditCeiling ?? AniBuddyConstants.critique.creditCeiling;
    const budgetMs = options.budgetMs ?? AniBuddyConstants.critique.budgetMs;

    const ledger: Ledger = {
      charged: options.creditsAlreadySpent ?? 0,
      refunded: 0,
      kept: [],
    };
    const passes: AniBuddyCritiquePassOutcome[] = [];
    const warnings: string[] = [];
    const overrides: Record<string, DeformerKind> = {};

    // Pass 0 is the rig as it stands. It is a candidate for "best" even though no
    // critique has seen it — §11.6's third tier is exactly this revision.
    const revisions: AniBuddyLoopRevision[] = [
      {
        passIndex: 0,
        document: options.document,
        diagnostics: options.document.diagnostics,
        origin: 'render',
      },
    ];

    let current = options.document;
    let stopReason: AniBuddyLoopStopReason = 'pass-cap';
    const firstPass = options.startPassIndex ?? 1;

    for (let passIndex = firstPass; passIndex <= maxPasses; passIndex += 1) {
      const projected = this.projectedPassCost();
      if (ledger.charged + projected > ceiling) {
        stopReason = 'credit-ceiling';
        warnings.push(
          `The critique loop stopped at the ${ceiling}-credit ceiling after ` +
            `${ledger.charged} credit(s); pass ${passIndex} was not started.`,
        );
        break;
      }

      const remaining = budgetMs - (now() - started);
      if (remaining < AniBuddyConstants.critique.minPassBudgetMs) {
        stopReason = 'time-budget';
        warnings.push(
          `The critique loop ran out of time before pass ${passIndex}. ` +
            'The best pass so far was kept.',
        );
        break;
      }

      const outcome = await this._runPass(deps, { passIndex, document: current, ledger });
      passes.push(outcome.record);
      for (const warning of outcome.warnings) {
        if (!warnings.includes(warning)) warnings.push(warning);
      }
      if (outcome.rendered) revisions.push(outcome.rendered);

      if (outcome.stop !== null) {
        stopReason = outcome.stop;
        break;
      }

      if (outcome.corrected) {
        revisions.push(outcome.corrected);
        current = outcome.corrected.document;
        Object.assign(overrides, outcome.record.deformerOverrides);
      }

      if (passIndex === maxPasses) {
        stopReason = 'pass-cap';
        warnings.push(
          `The critique loop reached its ${maxPasses}-pass cap without the model ` +
            'accepting a pass. The best pass was kept.',
        );
      }
    }

    const best = AniBuddyBestRevisionSelector.select(revisions);
    warnings.push(AniBuddyBestRevisionSelector.describe(best, stopReason));

    return {
      best: best.revision,
      bestSelection: best.selection,
      stopReason,
      passes,
      revisions,
      creditsCharged: ledger.charged - (options.creditsAlreadySpent ?? 0),
      creditsRefunded: ledger.refunded,
      deformerOverrides: overrides,
      warnings,
    };
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Internal method — one pass.
  //
  // Refund semantics per failure class (F9 §11.6). Credits for work that really
  // happened are NOT returned; credits for work that produced nothing usable are:
  //
  // | Where it failed                  | Render charge | Critique charge |
  // |----------------------------------|---------------|-----------------|
  // | Charge itself rejected (402)     | n/a           | n/a             |
  // | Contact-sheet render failed      | refunded      | not charged     |
  // | Provider unreachable             | KEPT          | refunded        |
  // | Report rejected at revalidation  | KEPT          | refunded        |
  // | Corrections refused on apply     | KEPT          | KEPT            |
  // | Pass completed (accept/revise)   | KEPT          | KEPT            |
  //
  // The two KEPT rows are the ones worth defending. The render charge survives a
  // failed vision call because the frames exist and are on the revision — the loop
  // can and does select that revision as "best". The critique charge survives an
  // apply refusal because the model was asked, answered, and its answer was
  // revalidated; the refusal is a statement about the answer's content, and the
  // vision call was really made.
  // ───────────────────────────────────────────────────────────────────────────
  async _runPass(
    deps: AniBuddyCritiqueLoopDeps,
    input: { passIndex: number; document: RigDocument; ledger: Ledger },
  ): Promise<PassResult> {
    const { passIndex, document, ledger } = input;
    const record: AniBuddyCritiquePassOutcome = {
      passIndex,
      verdict: null,
      observations: [],
      corrections: [],
      appliedKinds: [],
      deformerOverrides: {},
      creditsCharged: 0,
      creditsRefunded: 0,
      servedModel: null,
      failure: null,
    };
    const warnings: string[] = [];

    // --- Render the frames the model will look at ----------------------------

    const renderBilling = await deps.charge(RENDER_CHARGE.op, RENDER_CHARGE.units);
    if (!renderBilling.ok) {
      record.failure = {
        code: ANIBUDDY_CRITIQUE_ERROR_CODES.PROVIDER_FAILED,
        error: renderBilling.error,
      };
      warnings.push(`Pass ${passIndex} was not started: ${renderBilling.error}`);
      return { record, rendered: null, corrected: null, warnings, stop: 'credit-ceiling' };
    }
    ledger.charged += renderBilling.credits;
    record.creditsCharged += renderBilling.credits;

    const rendered = await deps.renderContactSheet({
      document,
      passIndex,
      usageEventId: renderBilling.eventId,
    });
    if (!rendered.ok) {
      // The frames do not exist, so nothing was produced to bill for.
      await this._refundInto(deps, ledger, record, renderBilling.eventId, renderBilling.credits);
      record.failure = { code: rendered.code, error: rendered.error };
      warnings.push(`Pass ${passIndex} could not be rendered: ${rendered.error}`);
      return { record, rendered: null, corrected: null, warnings, stop: 'render-failed' };
    }
    ledger.kept.push(renderBilling.eventId ?? '');
    warnings.push(...rendered.value.warnings);

    // The RENDER stage's child revision, whose diagnostics were measured on these
    // exact frames. Recorded as a candidate before the model has said anything:
    // if the vision call fails, this is still a real, measured revision.
    const renderedRevision: AniBuddyLoopRevision = {
      passIndex,
      document: rendered.value.document,
      diagnostics: rendered.value.document.diagnostics,
      origin: 'render',
    };

    // --- Ask the model about them --------------------------------------------

    const critiqueBilling = await deps.charge(CRITIQUE_CHARGE.op, CRITIQUE_CHARGE.units);
    if (!critiqueBilling.ok) {
      record.failure = {
        code: ANIBUDDY_CRITIQUE_ERROR_CODES.PROVIDER_FAILED,
        error: critiqueBilling.error,
      };
      warnings.push(
        `Pass ${passIndex} rendered but could not be reviewed: ${critiqueBilling.error}`,
      );
      return {
        record,
        rendered: renderedRevision,
        corrected: null,
        warnings,
        stop: 'credit-ceiling',
      };
    }
    ledger.charged += critiqueBilling.credits;
    record.creditsCharged += critiqueBilling.credits;

    const report = await deps.critique({
      imageDataUrl: rendered.value.imageDataUrl,
      document: rendered.value.document,
      passIndex,
      columns: rendered.value.columns,
      rows: rendered.value.rows,
      frameTimes: rendered.value.frameTimes,
    });

    if (!report.ok) {
      if (report.refundable) {
        // Only the vision charge. The render charge stays: those frames exist and
        // the revision that carries them is a live candidate for "best".
        await this._refundInto(
          deps,
          ledger,
          record,
          critiqueBilling.eventId,
          critiqueBilling.credits,
        );
      }
      record.failure = { code: report.code, error: report.error };
      warnings.push(`Pass ${passIndex} could not be reviewed: ${report.error}`);
      return {
        record,
        rendered: renderedRevision,
        corrected: null,
        warnings,
        // A provider outage and an unusable answer are different stop reasons, and
        // the UI says different things about them: one is "try again", the other is
        // "this rig needs a human".
        stop:
          report.code === ANIBUDDY_CRITIQUE_ERROR_CODES.PROVIDER_FAILED
            ? 'provider-failed'
            : 'critique-invalid',
      };
    }

    ledger.kept.push(critiqueBilling.eventId ?? '');
    record.servedModel = report.servedModel;
    record.verdict = report.report.verdict;
    record.observations = report.report.observations;
    record.corrections = report.report.corrections;
    warnings.push(...report.warnings);

    // The charge was authorized against the intended model; the chain may have
    // served a different one. Correct the audit trail now that we know which.
    if (critiqueBilling.eventId) {
      await deps.reconcile(critiqueBilling.eventId, report.servedModel);
    }

    if (report.report.verdict === 'accept') {
      return { record, rendered: renderedRevision, corrected: null, warnings, stop: 'accepted' };
    }
    if (report.report.verdict === 'abort') {
      return { record, rendered: renderedRevision, corrected: null, warnings, stop: 'aborted' };
    }

    // --- Apply what it asked for ---------------------------------------------

    const applied = await deps.applyCorrections({
      document: rendered.value.document,
      report: report.report,
      passIndex,
      servedModel: report.servedModel,
      usageEventId: critiqueBilling.eventId,
      creditsSpent: record.creditsCharged,
    });

    if (!applied.ok) {
      // Neither charge is refunded. The frames exist and the model really was
      // asked; the refusal is a statement about the CONTENT of a delivered answer.
      record.failure = { code: applied.code, error: applied.error };
      warnings.push(
        `Pass ${passIndex}'s corrections were refused: ${applied.error} ` +
          'The previous revision was kept unchanged.',
      );
      return {
        record,
        rendered: renderedRevision,
        corrected: null,
        warnings,
        stop: 'apply-refused',
      };
    }

    record.appliedKinds = report.report.corrections.map((correction) => correction.kind);
    record.deformerOverrides = applied.deformerOverrides;
    warnings.push(...applied.warnings);

    return {
      record,
      rendered: renderedRevision,
      corrected: {
        passIndex,
        document: applied.document,
        diagnostics: applied.document.diagnostics,
        origin: 'correction',
      },
      warnings,
      stop: null,
    };
  },

  /**
   * Internal method — return the credits of ONE charge, named explicitly.
   *
   * The amount is a parameter rather than derived from the pass total on purpose: a
   * pass that fails at the vision call has two charges on it and only one of them
   * is owed back, and deriving "everything charged so far" would silently refund
   * frames that really exist.
   */
  async _refundInto(
    deps: AniBuddyCritiqueLoopDeps,
    ledger: Ledger,
    record: AniBuddyCritiquePassOutcome,
    eventId: string | null,
    credits: number,
  ): Promise<void> {
    // Counted in the ledger whether or not there is an event to refund, so the
    // ceiling behaves identically on the metered and un-metered paths. A BYOK loop
    // that ignored refunds would get more passes for free than a signed-in one.
    const refundable = Math.max(0, Math.min(credits, ledger.charged));
    ledger.charged -= refundable;
    ledger.refunded += refundable;
    record.creditsRefunded += refundable;
    if (eventId) await deps.refund(eventId);
  },
};
