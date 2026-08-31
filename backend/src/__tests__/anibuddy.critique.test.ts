// The closed critique loop's contract (F9 §11.5, §11.6), now driven from the
// gateway's BullMQ worker instead of from a Next route handler.
//
// Every dependency is a fake, which is the whole reason the loop is
// dependency-injected: the pass cap, the credit ceiling, the wall-clock budget, the
// refund classification and the best-revision selection are all testable without a
// provider, a renderer or a credit balance. A loop whose stop conditions could only
// be tested against a live vision model would be a loop whose stop conditions were
// never tested.
//
// These are the tests that moved with the loop, and they are the proof that the
// migration was a swap of the four injected functions rather than a rewrite: the
// assertions did not change, only where the implementation they exercise lives.
//
// Nothing here imports `anibuddy.critique.service.ts` or `bullmq.ts` — constructing
// a Queue attaches an open Redis handle that keeps the node:test process alive.
// That constraint is why the loop takes its side effects as parameters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIBUDDY_CRITIQUE_ERROR_CODES,
  AniBuddyConstants,
} from '../modules/anibuddy/anibuddy.constants';
import { AniBuddyCritiqueLoop } from '../modules/anibuddy/anibuddy.critique.loop';
import type {
  AniBuddyChargeResult,
  AniBuddyCritiqueLoopDeps,
} from '../modules/anibuddy/anibuddy.critique.loop';
import { AniBuddyBestRevisionSelector } from '../modules/anibuddy/anibuddy.critique.best-revision';
import type { AniBuddyLoopRevision } from '../modules/anibuddy/anibuddy.critique.types';
import { UsageConstants } from '../modules/usage/usage.constants';
import { AniBuddyRigDocumentDto } from '../modules/anibuddy/dto/rig-document.generated';
import type {
  CritiqueReport,
  DeformerKind,
  Diagnostics,
  RigDocument,
} from '../modules/anibuddy/dto/rig-document.generated';

// --- Fixtures ---------------------------------------------------------------

function diagnostics(overrides: Partial<Diagnostics> = {}): Diagnostics {
  return {
    foregroundPixels: 1000,
    coveredForegroundPixels: 1000,
    overlappingPartPairs: [],
    maxStretch: 1,
    flippedTriangles: 0,
    isolatedVertices: 0,
    warnings: [],
    blockingReason: null,
    ...overrides,
  };
}

function document(id: string, diags: Diagnostics = diagnostics()): RigDocument {
  return {
    schemaVersion: 5,
    id,
    projectId: 'proj_loop',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    revision: { index: 0, parentRevisionId: null, reason: 'test', accepted: false },
    archetype: 'humanoid',
    asset: {
      id: 'asset_loop',
      name: 'loop.png',
      storageKey: 'anibuddy/loop.png',
      contentHash: '0'.repeat(64),
      width: 64,
      height: 64,
      figureHeight: null,
      mimeType: 'image/png',
      rightsConfirmed: true,
      remoteVisionConsented: true,
    },
    parts: [],
    skeleton: { joints: [] },
    clips: [],
    generation: {
      mode: 'external-prompt-only',
      prompt: null,
      transcript: [],
      producedBy: null,
    },
    provenance: { pipelineVersion: 'test/1', kernelVersion: 'test/1', stages: [] },
    diagnostics: diags,
  };
}

function report(verdict: CritiqueReport['verdict'], passIndex: number): CritiqueReport {
  return {
    verdict,
    passIndex,
    observations: [],
    corrections:
      verdict === 'revise'
        ? [
            {
              kind: 'z-order',
              targetId: 'torso',
              reason: 'The arm is drawn behind the torso.',
              vec2: null,
              scalar: null,
              intValue: 3,
              deformerKind: null,
              stringValue: null,
            },
          ]
        : [],
  };
}

type Log = {
  charges: Array<{ op: string; units: number; credits: number }>;
  refunds: string[];
  reconciles: Array<{ eventId: string; model: string }>;
  renders: number[];
  critiques: number[];
  applies: number[];
};

type FakeOptions = {
  /** Verdict per pass index. Absent means "revise". */
  verdicts?: Record<number, CritiqueReport['verdict']>;
  /** Diagnostics the render reports per pass index. */
  renderDiagnostics?: Record<number, Diagnostics>;
  failRenderAtPass?: number;
  failCritiqueAtPass?: { pass: number; refundable: boolean; code?: string };
  failApplyAtPass?: number;
  rejectChargeAtPass?: number;
  /** Milliseconds the clock advances per pass, for the budget test. */
  msPerPass?: number;
  chargeCredits?: (op: string, units: number) => number;
};

function fakeDeps(options: FakeOptions = {}): { deps: AniBuddyCritiqueLoopDeps; log: Log } {
  const log: Log = {
    charges: [],
    refunds: [],
    reconciles: [],
    renders: [],
    critiques: [],
    applies: [],
  };
  let clock = 0;
  let passSeen = 0;

  const deps: AniBuddyCritiqueLoopDeps = {
    now: () => clock,

    async charge(op, units): Promise<AniBuddyChargeResult> {
      if (options.rejectChargeAtPass !== undefined && passSeen >= options.rejectChargeAtPass) {
        return { ok: false, status: 402, error: 'Out of credits.' };
      }
      const credits = options.chargeCredits
        ? options.chargeCredits(op, units)
        : AniBuddyCritiqueLoop.projectedChargeCredits(op, units);
      log.charges.push({ op, units, credits });
      return { ok: true, eventId: `evt-${log.charges.length}`, credits };
    },

    async refund(eventId) {
      log.refunds.push(eventId);
    },

    async reconcile(eventId, model) {
      log.reconciles.push({ eventId, model });
    },

    async renderContactSheet({ passIndex }) {
      passSeen = passIndex;
      clock += options.msPerPass ?? 0;
      log.renders.push(passIndex);
      if (options.failRenderAtPass === passIndex) {
        return {
          ok: false,
          code: ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_REFUSED,
          error: 'Nothing was drawn.',
        };
      }
      return {
        ok: true,
        value: {
          imageDataUrl: 'data:image/png;base64,AAAA',
          document: document(
            `rev-render-${passIndex}`,
            options.renderDiagnostics?.[passIndex] ?? diagnostics(),
          ),
          columns: 3,
          rows: 3,
          frameTimes: [0, 0.5, 1],
          warnings: [],
        },
      };
    },

    async critique({ passIndex }) {
      log.critiques.push(passIndex);
      const failure = options.failCritiqueAtPass;
      if (failure && failure.pass === passIndex) {
        return {
          ok: false,
          code: (failure.code ??
            ANIBUDDY_CRITIQUE_ERROR_CODES.CRITIQUE_INVALID) as never,
          error: 'The review could not produce usable corrections.',
          refundable: failure.refundable,
        };
      }
      return {
        ok: true,
        report: report(options.verdicts?.[passIndex] ?? 'revise', passIndex),
        servedModel: 'google/gemini-2.5-flash-served',
        warnings: [],
      };
    },

    async applyCorrections({ document: parent, passIndex }) {
      log.applies.push(passIndex);
      if (options.failApplyAtPass === passIndex) {
        return {
          ok: false,
          code: ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_REFUSED,
          error: 'That reparent would close a cycle.',
        };
      }
      const deformerOverrides: Record<string, DeformerKind> =
        passIndex === 1 ? { torso: 'mesh' } : {};
      return {
        ok: true,
        // Diagnostics carried forward from the render, matching py_backend's
        // applier: this revision has not been rendered, so its numbers are
        // inherited rather than measured.
        document: document(`rev-apply-${passIndex}`, parent.diagnostics),
        deformerOverrides,
        warnings: [],
      };
    },
  };

  return { deps, log };
}

// --- Cost model -------------------------------------------------------------

test('cost model: a pass charges the render AND the vision call, separately', () => {
  // Two charges, not one. The split is what makes the refund table honest: the
  // render produces frames that really exist, and the vision call may produce
  // nothing usable, so they cannot share one refund decision.
  assert.equal(AniBuddyCritiqueLoop.passCharges.length, 2);
  assert.deepEqual(
    AniBuddyCritiqueLoop.passCharges.map((charge) => charge.op),
    ['anibuddy-render', 'anibuddy-critique'],
  );
  assert.equal(
    AniBuddyCritiqueLoop.passCharges[0]!.units,
    AniBuddyConstants.critique.contactSheetFrames,
    'the render is billed per frame, per the landed cost table',
  );
  // Both ops are registered. The loop reuses the landed billing contract and does
  // not introduce a rate of its own.
  for (const charge of AniBuddyCritiqueLoop.passCharges) {
    assert.equal(
      (UsageConstants.registeredOps as readonly string[]).includes(charge.op),
      true,
      `${charge.op} must be a registered usage op`,
    );
  }
});

test('cost model: the projection reads the landed rate table rather than copying it', () => {
  // This is the one thing that changed about the projection when the loop moved into
  // the gateway. In Next the backend's cost table was not importable, so the two
  // rates had to be duplicated and could drift; here they cannot.
  for (const charge of AniBuddyCritiqueLoop.passCharges) {
    assert.equal(
      AniBuddyCritiqueLoop.projectedChargeCredits(charge.op, charge.units),
      Math.max(
        UsageConstants.minCost,
        Math.ceil(UsageConstants.opCreditRates[charge.op] * charge.units),
      ),
    );
  }
  // Floored at `minCost`, matching `UsageService.costFor`: render is 0.25/frame, so a
  // single frame would otherwise project as less than one credit.
  assert.equal(
    AniBuddyCritiqueLoop.projectedChargeCredits('anibuddy-render', 1),
    UsageConstants.minCost,
  );
});

test('cost model: the full pass budget fits inside the credit ceiling', () => {
  // Both stops must be reachable. If three passes cost more than the ceiling the
  // pass cap would be dead code; if they cost far less the ceiling would be.
  const perPass = AniBuddyCritiqueLoop.projectedPassCost();
  assert.ok(perPass > 0);
  assert.ok(
    perPass * AniBuddyConstants.critique.maxPasses <=
      AniBuddyConstants.critique.creditCeiling,
    'a full three-pass loop must not be pre-emptively blocked by the ceiling',
  );
});

test('cost model: the caps come from the generated schema, not from this gateway', () => {
  // R10: a second declaration of MAX_CRITIQUE_PASSES would disagree with the first
  // exactly once, and the disagreement would be a billing incident.
  assert.equal(AniBuddyConstants.critique.maxPasses, 3);
  assert.equal(AniBuddyConstants.critique.creditCeiling, 24);
  assert.equal(AniBuddyConstants.critique.contactSheetFrames, 9);
  // The wall-clock budget is preserved from the Next route it used to run under: a
  // pass needs a render plus a vision call, and one must not start without room to
  // finish.
  assert.equal(AniBuddyConstants.critique.budgetMs, 100_000);
  assert.ok(
    AniBuddyConstants.critique.minPassBudgetMs < AniBuddyConstants.critique.budgetMs,
  );
});

// --- Happy path -------------------------------------------------------------

test('loop: an accepted pass stops the loop immediately', async () => {
  const { deps, log } = fakeDeps({ verdicts: { 1: 'accept' } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'accepted');
  assert.deepEqual(log.renders, [1]);
  assert.deepEqual(log.critiques, [1]);
  assert.deepEqual(log.applies, [], 'an accepted pass has nothing to apply');
  assert.equal(result.creditsRefunded, 0);
});

test('loop: an aborting verdict stops without spending another pass', async () => {
  const { deps, log } = fakeDeps({ verdicts: { 1: 'abort' } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'aborted');
  assert.equal(log.renders.length, 1);
  assert.equal(log.applies.length, 0);
});

test('loop: the served model is reconciled onto the usage event', async () => {
  // The charge was authorized against the intended model; the chain may have
  // served a different one, and F9 §13 requires the audit trail to name reality.
  const { deps, log } = fakeDeps({ verdicts: { 1: 'accept' } });
  await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });
  assert.equal(log.reconciles.length, 1);
  assert.equal(log.reconciles[0]!.model, 'google/gemini-2.5-flash-served');
});

// --- Hard stops -------------------------------------------------------------

test('loop: the pass cap stops a loop that never converges', async () => {
  const { deps, log } = fakeDeps();
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'pass-cap');
  assert.equal(log.renders.length, AniBuddyConstants.critique.maxPasses);
  assert.equal(result.passes.length, AniBuddyConstants.critique.maxPasses);
  assert.ok(
    result.warnings.some((warning) => warning.includes('pass cap')),
    'the stop condition must be named in a warning the editor can show',
  );
});

test('loop: the credit ceiling stops the loop before a pass is enqueued', async () => {
  // Checked BEFORE the pass, so the ceiling is never exceeded rather than merely
  // detected afterwards. A resumed loop is where this binds before the pass cap.
  const alreadySpent =
    AniBuddyConstants.critique.creditCeiling - AniBuddyCritiqueLoop.projectedPassCost() + 1;
  const { deps, log } = fakeDeps();
  const result = await AniBuddyCritiqueLoop.run(deps, {
    document: document('rev-0'),
    creditsAlreadySpent: alreadySpent,
  });

  assert.equal(result.stopReason, 'credit-ceiling');
  assert.equal(log.renders.length, 0, 'not one credit may be spent past the ceiling');
  assert.ok(result.warnings.some((warning) => warning.includes('ceiling')));
});

test('loop: the credit ceiling is independent of the pass cap', async () => {
  // A pass that costs more than expected must be stopped by the ceiling even
  // though passes remain. That is the §11.5 "only the ceiling bounds the worst
  // case" property, and it is why the two limits are separate numbers.
  const { deps, log } = fakeDeps({ chargeCredits: () => 9 });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'credit-ceiling');
  assert.ok(
    log.renders.length < AniBuddyConstants.critique.maxPasses,
    'the ceiling must bite before the pass cap when passes cost more than projected',
  );
});

test('loop: the wall-clock budget stops a loop that is too slow', async () => {
  const { deps, log } = fakeDeps({ msPerPass: AniBuddyConstants.critique.budgetMs });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'time-budget');
  assert.equal(log.renders.length, 1, 'a pass must not start without budget to finish');
  assert.ok(result.warnings.some((warning) => warning.includes('out of time')));
});

test('loop: a rejected charge stops the loop rather than proceeding unbilled', async () => {
  const { deps, log } = fakeDeps({ rejectChargeAtPass: 1 });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });
  assert.equal(log.renders.length, 1);
  assert.ok(result.passes.some((pass) => pass.failure !== null));
});

// --- Refund semantics per failure class ------------------------------------

test('refunds: a failed contact-sheet render refunds its own charge', async () => {
  // The frames do not exist, so there is nothing to bill for.
  const { deps, log } = fakeDeps({ failRenderAtPass: 1 });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'render-failed');
  assert.equal(log.charges.length, 1, 'the vision call is never charged');
  assert.equal(log.refunds.length, 1);
  assert.equal(result.creditsRefunded, log.charges[0]!.credits);
});

test('refunds: a revalidation-rejected report refunds the vision call only', async () => {
  // §11.6: revalidation-rejected passes ARE refunded. The render charge is NOT,
  // because those frames exist and the revision carrying them is a live candidate
  // for "best".
  const { deps, log } = fakeDeps({ failCritiqueAtPass: { pass: 1, refundable: true } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'critique-invalid');
  assert.equal(log.charges.length, 2);
  assert.equal(log.refunds.length, 1);
  assert.equal(result.creditsRefunded, log.charges[1]!.credits);
  assert.equal(result.creditsCharged, log.charges[0]!.credits);
});

test('refunds: a provider outage refunds the vision call and names its own stop reason', async () => {
  const { deps, log } = fakeDeps({
    failCritiqueAtPass: {
      pass: 1,
      refundable: true,
      code: ANIBUDDY_CRITIQUE_ERROR_CODES.PROVIDER_FAILED,
    },
  });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  // A provider outage and an unusable answer are different stop reasons because
  // the UI says different things: "try again" versus "this rig needs a human".
  assert.equal(result.stopReason, 'provider-failed');
  assert.equal(log.refunds.length, 1);
});

test('refunds: a non-refundable failure keeps both charges', async () => {
  // The Next vision route decides refundability and the loop obeys it, because the
  // two come apart: a revalidation rejection and a refused correction are both 422s
  // and only one of them is owed back.
  const { deps, log } = fakeDeps({ failCritiqueAtPass: { pass: 1, refundable: false } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(log.refunds.length, 0);
  assert.equal(result.creditsRefunded, 0);
  assert.equal(result.creditsCharged, AniBuddyCritiqueLoop.projectedPassCost());
});

test('refunds: a completed pass is never refunded', async () => {
  // §11.6, verbatim: credits for a pass that was enqueued and completed are not
  // refunded, because the work was really done and the frames really exist.
  const { deps, log } = fakeDeps({ verdicts: { 1: 'accept' } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });
  assert.equal(log.refunds.length, 0);
  assert.equal(result.creditsRefunded, 0);
  assert.equal(result.creditsCharged, AniBuddyCritiqueLoop.projectedPassCost());
});

test('refunds: a refused apply refunds nothing', async () => {
  // The frames exist and the model really was asked. The refusal is a statement
  // about the CONTENT of a delivered answer, not about work that did not happen.
  const { deps, log } = fakeDeps({ failApplyAtPass: 1 });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.stopReason, 'apply-refused');
  assert.equal(log.refunds.length, 0);
  assert.equal(result.creditsCharged, AniBuddyCritiqueLoop.projectedPassCost());
});

test('refunds: the ledger tracks refunds even with nothing to refund against', async () => {
  // The un-metered path (BYOK or development) has no usage event, and the ceiling
  // must behave identically there: a loop that ignored refunds without an event id
  // would get more passes for free than a signed-in one.
  const { deps, log } = fakeDeps({ failRenderAtPass: 1 });
  deps.charge = async (op, units) => ({
    ok: true,
    eventId: null,
    credits: AniBuddyCritiqueLoop.projectedChargeCredits(op, units),
  });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(log.refunds.length, 0, 'there is no event to refund');
  assert.ok(result.creditsRefunded > 0, 'but the ledger still returns the credits');
  assert.equal(result.creditsCharged, 0);
});

// --- Best revision ---------------------------------------------------------

test('best revision: the lowest-stretch clean pass wins, not the last', async () => {
  // The reason this matters: a critique pass can make a rig worse, and the loop
  // stops on a pass cap rather than on convergence — so "last" is "whichever pass
  // we ran out of budget on", which is not a quality signal.
  const { deps } = fakeDeps({
    renderDiagnostics: {
      1: diagnostics({ maxStretch: 1.2 }),
      2: diagnostics({ maxStretch: 3.9 }),
      3: diagnostics({ maxStretch: 2.4 }),
    },
  });
  const result = await AniBuddyCritiqueLoop.run(deps, {
    document: document('rev-0', diagnostics({ maxStretch: 2.0 })),
  });

  assert.equal(result.bestSelection, 'lowest-stretch-clean');
  assert.equal(result.best.passIndex, 1);
  assert.equal(result.best.diagnostics.maxStretch, 1.2);
});

test('best revision: flipped triangles disqualify a pass however low its stretch', () => {
  const revisions: AniBuddyLoopRevision[] = [
    {
      passIndex: 0,
      document: document('rev-0'),
      diagnostics: diagnostics({ maxStretch: 2.5 }),
      origin: 'render',
    },
    {
      passIndex: 1,
      document: document('rev-1'),
      diagnostics: diagnostics({ maxStretch: 1.01, flippedTriangles: 4 }),
      origin: 'render',
    },
  ];
  const best = AniBuddyBestRevisionSelector.select(revisions);
  assert.equal(best.selection, 'lowest-stretch-clean');
  assert.equal(best.revision.passIndex, 0, 'an inside-out triangle is not a clean render');
});

test('best revision: with nothing clean, the last unblocked revision wins', () => {
  const revisions: AniBuddyLoopRevision[] = [
    {
      passIndex: 0,
      document: document('rev-0'),
      diagnostics: diagnostics({ flippedTriangles: 1 }),
      origin: 'render',
    },
    {
      passIndex: 1,
      document: document('rev-1'),
      diagnostics: diagnostics({ flippedTriangles: 2 }),
      origin: 'render',
    },
  ];
  const best = AniBuddyBestRevisionSelector.select(revisions);
  assert.equal(best.selection, 'last-unblocked');
  assert.equal(best.revision.passIndex, 1);
});

test('best revision: with nothing exportable, pass 0 wins', () => {
  const revisions: AniBuddyLoopRevision[] = [
    {
      passIndex: 0,
      document: document('rev-0'),
      diagnostics: diagnostics({ blockingReason: 'Weight rows do not sum to one.' }),
      origin: 'render',
    },
    {
      passIndex: 1,
      document: document('rev-1'),
      diagnostics: diagnostics({ blockingReason: 'Nothing was drawn.' }),
      origin: 'render',
    },
  ];
  const best = AniBuddyBestRevisionSelector.select(revisions);
  assert.equal(best.selection, 'pass-zero');
  assert.equal(best.revision.passIndex, 0);
});

test('best revision: a tie goes to the earlier pass', () => {
  // Fewer corrections applied for the same measured quality is the simpler rig,
  // and a correction that changed nothing measurable should not win on recency.
  const revisions: AniBuddyLoopRevision[] = [
    {
      passIndex: 1,
      document: document('rev-1'),
      diagnostics: diagnostics({ maxStretch: 1.5 }),
      origin: 'render',
    },
    {
      passIndex: 2,
      document: document('rev-2'),
      diagnostics: diagnostics({ maxStretch: 1.5 }),
      origin: 'render',
    },
  ];
  assert.equal(AniBuddyBestRevisionSelector.select(revisions).revision.passIndex, 1);
});

test('best revision: pass 0 is a candidate even though no critique saw it', async () => {
  const { deps } = fakeDeps({
    renderDiagnostics: {
      1: diagnostics({ maxStretch: 4 }),
      2: diagnostics({ maxStretch: 4 }),
      3: diagnostics({ maxStretch: 4 }),
    },
  });
  const result = await AniBuddyCritiqueLoop.run(deps, {
    document: document('rev-0', diagnostics({ maxStretch: 1.05 })),
  });
  assert.equal(result.best.passIndex, 0);
});

test('best revision: a failed vision call still leaves its rendered revision selectable', async () => {
  // The render charge is kept precisely because this revision is real and
  // measured. If it were not selectable, keeping the charge would be indefensible.
  const { deps } = fakeDeps({
    failCritiqueAtPass: { pass: 1, refundable: true },
    renderDiagnostics: { 1: diagnostics({ maxStretch: 1.05 }) },
  });
  const result = await AniBuddyCritiqueLoop.run(deps, {
    document: document('rev-0', diagnostics({ maxStretch: 3.0 })),
  });
  assert.equal(result.best.passIndex, 1);
  assert.equal(result.best.document.id, 'rev-render-1');
});

test('best revision: the selection is explained in a warning', () => {
  const best = AniBuddyBestRevisionSelector.select([
    {
      passIndex: 2,
      document: document('rev-2'),
      diagnostics: diagnostics({ maxStretch: 1.3 }),
      origin: 'render',
    },
  ]);
  const sentence = AniBuddyBestRevisionSelector.describe(best, 'pass-cap');
  assert.match(sentence, /pass 2/);
  assert.match(sentence, /1\.30/);
});

test('best revision: an unmeasured correction revision cannot win', () => {
  // A correction revision's diagnostics are INHERITED, not measured — the applier
  // carries them forward rather than authoring a 1.0 for frames nobody has drawn.
  // Letting one compete would mean a correction winning on numbers that describe
  // the render before it.
  const revisions: AniBuddyLoopRevision[] = [
    {
      passIndex: 0,
      document: document('rev-0'),
      diagnostics: diagnostics({ maxStretch: 1.4 }),
      origin: 'render',
    },
    {
      passIndex: 1,
      document: document('rev-apply-1'),
      diagnostics: diagnostics({ maxStretch: 1.0 }),
      origin: 'correction',
    },
  ];
  const best = AniBuddyBestRevisionSelector.select(revisions);
  assert.equal(best.revision.origin, 'render');
  assert.equal(best.revision.passIndex, 0);
});

test('best revision: an empty revision list is a programming error, not a silent null', () => {
  assert.throws(() => AniBuddyBestRevisionSelector.select([]));
  assert.throws(() =>
    AniBuddyBestRevisionSelector.select([
      {
        passIndex: 1,
        document: document('rev-apply-1'),
        diagnostics: diagnostics(),
        origin: 'correction',
      },
    ]),
  );
});

test('best revision: the winner is a document the gateway can actually store', async () => {
  // The loop hands its winner straight to `project.currentDocument`, so it has to
  // survive the same zod boundary every stage result does.
  const { deps } = fakeDeps({ verdicts: { 1: 'accept' } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });
  assert.equal(
    AniBuddyRigDocumentDto.rigDocument.safeParse(result.best.document).success,
    true,
  );
});

// --- Bookkeeping ------------------------------------------------------------

test('loop: deformer swaps accumulate across passes for the next rig run', async () => {
  // R3/R5: a deformer swap is a request to REBUILD geometry, which is the rig
  // stage's job. The loop carries the request forward instead of editing a
  // deformer payload from a model response.
  const { deps } = fakeDeps();
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });
  assert.deepEqual(result.deformerOverrides, { torso: 'mesh' });
});

test('loop: every pass is recorded with its verdict and its ledger', async () => {
  const { deps } = fakeDeps({ verdicts: { 1: 'revise', 2: 'accept' } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.equal(result.passes.length, 2);
  assert.equal(result.passes[0]!.verdict, 'revise');
  assert.equal(result.passes[1]!.verdict, 'accept');
  for (const pass of result.passes) {
    assert.equal(pass.creditsCharged, AniBuddyCritiqueLoop.projectedPassCost());
    assert.equal(pass.servedModel, 'google/gemini-2.5-flash-served');
  }
});

test('loop: the revision chain is kept so the editor can diff the passes', async () => {
  // §11.6: the unaccepted chain is kept so the user can step through what was
  // tried. A loop that returned only the winner would make a correction
  // irreversible in practice however immutable it is on paper (R9).
  const { deps } = fakeDeps({ verdicts: { 1: 'revise', 2: 'accept' } });
  const result = await AniBuddyCritiqueLoop.run(deps, { document: document('rev-0') });

  assert.deepEqual(
    result.revisions.map((revision) => revision.document.id),
    ['rev-0', 'rev-render-1', 'rev-apply-1', 'rev-render-2'],
  );
  assert.deepEqual(
    result.revisions.map((revision) => revision.origin),
    ['render', 'render', 'correction', 'render'],
  );
});

test('loop: a resumed run starts at the pass it is told to', async () => {
  const { deps, log } = fakeDeps({ verdicts: { 3: 'accept' } });
  const result = await AniBuddyCritiqueLoop.run(deps, {
    document: document('rev-0'),
    startPassIndex: 3,
  });
  assert.deepEqual(log.renders, [3]);
  assert.equal(result.stopReason, 'accepted');
});
