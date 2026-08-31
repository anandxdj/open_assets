// The critique loop's driver: enqueue, then supply the loop's four functions.
//
// This module is the ONLY thing that changed when the closed critique loop moved
// out of a Next route handler and into this gateway. The loop itself
// (`anibuddy.critique.loop.ts`) is dependency-injected precisely so that this
// migration would be a swap of implementations rather than a rewrite: the pass cap,
// the credit ceiling, the wall-clock budget, the per-pass billing, the refund
// classification and the best-revision selection are all in the loop, unchanged,
// and none of them is restated here.
//
// The call path, and why it is shaped this way
// -------------------------------------------
// One pass needs two things that live in two different processes — frames that were
// really rendered, and a model that looks at them:
//
//   BullMQ worker (here)
//     ├─ X-Internal-Token ─▶ py_backend /anibuddy/critique/contact-sheet   (frames)
//     ├─ x-service-token  ─▶ Next /api/enhance/anibuddy/critique           (model)
//     ├─ X-Internal-Token ─▶ py_backend /anibuddy/critique/apply           (corrections)
//     └─ in process ──────▶ UsageService                                   (credits)
//
// Three placements were possible and this is the only one that keeps both single
// implementations:
//
// 1. Loop in the gateway, provider chain copied into Node. Rejected: two fallback
//    chains is two behaviours, and the whole AI layer was consolidated to have one.
// 2. Loop in Next, calling py_backend directly with the Node→Python shared secret.
//    What shipped first, as a documented compromise. It works, and the cost is that
//    the browser-adjacent app holds a credential that authorizes every py_backend
//    endpoint — including render — for as long as it holds it.
// 3. Loop in the gateway, frames from py_backend, the model call delegated to the
//    one chain in Next over the service-token edge that already exists in the other
//    direction. Taken. `INTERNAL_API_TOKEN` now exists in exactly one process, the
//    one that owns the StorageAdapter and the queues.
//
// Billing is in-process, and that is the point of the move
// -------------------------------------------------------
// `resolveKeyAndCredits` needs a JWT to forward, and a queued job has none. Rather
// than mint one, the loop charges through `UsageService` directly against a userId
// the job already carries — the same service the HTTP `consume` route calls, no new
// rates, no new ops. The Next vision route is therefore unmetered: it is reachable
// only with the service token, and the credits for that call were already taken by
// whoever asked for it.

import mongoose from 'mongoose';
import { Config } from '../../common/config/config';
import { ApiError } from '../../common/utils/ApiError';
import { anibuddyCritiqueQueue } from '../../common/config/bullmq';
import { UsageService } from '../usage/usage.service';
import { AniBuddyConstants } from './anibuddy.constants';
import { AniBuddyCritiqueLoop } from './anibuddy.critique.loop';
import type {
  AniBuddyChargeResult,
  AniBuddyCritiqueLoopDeps,
  AniBuddyCritiqueLoopOp,
} from './anibuddy.critique.loop';
import type { AniBuddyCritiqueLoopResult } from './anibuddy.critique.types';
import { AniBuddyProjectModel } from './anibuddy.project.model';
import type { IAniBuddyProject } from './anibuddy.project.model';
import { AniBuddyPyClient } from './anibuddy.py.client';
import type { AniBuddyResolvedBuffer, AniBuddyStageSheet } from './anibuddy.py.client';
import { AniBuddyService } from './anibuddy.service';
import { AniBuddyVisionClient } from './anibuddy.vision.client';
import { AniBuddyRigDocumentDto } from './dto/rig-document.generated';
import type { RigDocument } from './dto/rig-document.generated';
import type { EnqueueAniBuddyCritiqueInput } from './dto/project.schema';

export interface AniBuddyCritiqueJobData {
  projectId: string;
  userId: string;
  inputHash: string;
  /** Null is "the rig at rest", which is a legitimate thing to critique. */
  clipId: string | null;
  creditsAlreadySpent: number;
  startPassIndex: number;
}

export const AniBuddyCritiqueService = {
  // Internal method — the hash the progress record and the log line agree on.
  //
  // The clip is part of it: critiquing a walk cycle and critiquing the rig at rest
  // are different work on the same revision, and a hash that ignored the clip would
  // report the second as a re-run of the first.
  _buildInputHash(project: IAniBuddyProject, input: EnqueueAniBuddyCritiqueInput): string {
    return AniBuddyPyClient.hashStageInput({
      stage: AniBuddyConstants.critique.stage,
      projectId: (project._id as { toString(): string }).toString(),
      assetContentHash: project.asset.contentHash,
      currentRevision: project.currentRevision,
      clipId: input.clipId ?? null,
      startPassIndex: input.startPassIndex ?? 1,
      pipelineVersion: Config.anibuddy.pipelineVersion,
      kernelVersion: Config.anibuddy.kernelVersion,
    });
  },

  /**
   * Queue a critique loop for this project.
   *
   * Nothing is charged here, which is the one structural difference from
   * `enqueueStage`. The loop bills per pass and refunds by failure class, so a
   * pre-authorization at enqueue time would be a charge for passes that the ceiling
   * or the budget may never let start — and it would have to be reconciled against
   * whatever the loop really spent, which is the accounting nobody can explain.
   *
   * The refusals below are all things that would otherwise be discovered after the
   * first render charge: an unrenderable rig, a sheet with no vision consent, or a
   * deployment that cannot reach the provider chain at all.
   */
  async enqueue(userId: string, projectId: string, input: EnqueueAniBuddyCritiqueInput) {
    const project = await AniBuddyService.loadOwned(projectId, userId);

    if (
      project.stageProgress.status === 'queued' ||
      project.stageProgress.status === 'running'
    ) {
      throw ApiError.conflict(
        `Stage ${project.stageProgress.stage ?? 'unknown'} is already ${project.stageProgress.status}`,
      );
    }

    const document = AniBuddyService.requireDocument(project);
    if (document.diagnostics.blockingReason !== null) {
      // Refused before a frame is spent, matching the render stage's own gate
      // (F9 §8.5). A loop over an unrenderable rig would charge for nine frames
      // that cannot be drawn, three times over.
      throw ApiError.conflict(document.diagnostics.blockingReason);
    }
    if (!document.asset.remoteVisionConsented) {
      throw ApiError.conflict(
        'This sheet has not been cleared for remote vision, so it cannot be critiqued. ' +
          'The rig and render stages are unaffected.',
      );
    }
    if (!AniBuddyVisionClient.isConfigured()) {
      throw ApiError.internal(
        'The AI layer is not reachable from this server, so a critique loop cannot run.',
      );
    }

    const inputHash = this._buildInputHash(project, input);
    const jobData: AniBuddyCritiqueJobData = {
      projectId,
      userId,
      inputHash,
      clipId: input.clipId === undefined ? (document.clips[0]?.id ?? null) : input.clipId,
      creditsAlreadySpent: input.creditsAlreadySpent ?? 0,
      startPassIndex: input.startPassIndex ?? 1,
    };

    const job = await anibuddyCritiqueQueue.add(AniBuddyConstants.critique.jobName, jobData);

    project.status = 'queued';
    project.lastError = null;
    project.stageProgress = {
      stage: AniBuddyConstants.critique.stage,
      status: 'queued',
      percent: 0,
      message: `Queued ${AniBuddyConstants.critique.stage}`,
      startedAt: null,
      finishedAt: null,
      error: null,
      inputHash,
      bullJobId: job.id ?? null,
    };
    await project.save();

    return {
      ...AniBuddyService.toPublic(project),
      critique: {
        jobId: job.id ?? null,
        clipId: jobData.clipId,
        inputHash,
        startPassIndex: jobData.startPassIndex,
        maxPasses: AniBuddyConstants.critique.maxPasses,
        creditCeiling: AniBuddyConstants.critique.creditCeiling,
        creditsAlreadySpent: jobData.creditsAlreadySpent,
      },
    };
  },

  /**
   * Build the four real implementations the loop runs on.
   *
   * Separated from `processJob` so the wiring is readable as a unit and so a test
   * can assert what each dependency does to the outside world without running a
   * loop. Everything stateful the pass-to-pass flow needs is in this closure:
   * the sheet's bytes, the resolved geometry, the clip under review, and the two
   * things the audit trail needs afterwards — every usage event the loop opened, and
   * which provider actually served the last vision call.
   */
  _buildDeps(context: {
    data: AniBuddyCritiqueJobData;
    sheet: AniBuddyStageSheet;
    buffers: readonly AniBuddyResolvedBuffer[];
    eventIds: string[];
  }): AniBuddyCritiqueLoopDeps {
    const { data, sheet, buffers, eventIds } = context;

    // Which provider served the most recent vision call.
    //
    // Carried in the closure rather than passed through the loop because the loop's
    // `reconcile(eventId, model)` signature is deliberately narrow — it is the same
    // signature the Next route drove it with — and `_runPass` calls `reconcile`
    // immediately after the `critique` that set this, in the same pass, on a loop
    // that owns this closure. There is no interleaving in which it can be stale.
    let servedProvider: string = AniBuddyConstants.critique.stage;

    return {
      async renderContactSheet({ document, passIndex, usageEventId }) {
        try {
          // Call to py_backend
          const rendered = await AniBuddyPyClient.contactSheet({
            document,
            sheet,
            buffers,
            projectId: document.projectId,
            revisionId: AniBuddyService.revisionId(
              data.projectId,
              document.revision.index + 1,
            ),
            parentRevisionId: document.id,
            revisionIndex: document.revision.index + 1,
            passIndex,
            usageEventId,
            clipId: data.clipId,
          });
          return {
            ok: true,
            value: {
              imageDataUrl: rendered.imageDataUrl,
              document: rendered.document,
              columns: rendered.columns,
              rows: rendered.rows,
              frameTimes: rendered.frameTimes,
              warnings: rendered.warnings,
            },
          };
        } catch (error) {
          return {
            ok: false,
            ...AniBuddyPyClient.classifyError(error, 'The contact sheet could not be rendered.'),
          };
        }
      },

      async critique({ imageDataUrl, document, passIndex, columns, rows, frameTimes }) {
        // Call to the single provider chain, via the Next vision route.
        const result = await AniBuddyVisionClient.critique({
          imageDataUrl,
          passIndex,
          columns,
          rows,
          frameTimes,
          partIds: document.parts.map((part) => part.id),
          jointIds: document.skeleton.joints.map((joint) => joint.id),
          clipIds: document.clips.map((clip) => clip.id),
          maxStretch: document.diagnostics.maxStretch,
          flippedTriangles: document.diagnostics.flippedTriangles,
        });
        if (!result.ok) return result;
        servedProvider = result.servedModel;
        return {
          ok: true,
          report: result.report,
          servedModel: result.servedModel,
          warnings: result.warnings,
        };
      },

      async applyCorrections({
        document,
        report,
        passIndex,
        servedModel,
        usageEventId,
        creditsSpent,
      }) {
        try {
          // Call to py_backend
          const applied = await AniBuddyPyClient.applyCritique({
            document,
            report,
            revisionId: AniBuddyService.revisionId(
              data.projectId,
              document.revision.index + 1,
            ),
            projectId: document.projectId,
            parentRevisionId: document.id,
            revisionIndex: document.revision.index + 1,
            passIndex,
            modelId: servedModel,
            usageEventId,
            creditsSpent,
          });
          return {
            ok: true,
            document: applied.document,
            deformerOverrides: applied.deformerOverrides,
            warnings: [
              ...applied.warnings,
              ...applied.applied.map((item) => `${item.kind}: ${item.effect}`),
            ],
          };
        } catch (error) {
          return {
            ok: false,
            ...AniBuddyPyClient.classifyError(error, 'The corrections could not be applied.'),
          };
        }
      },

      async charge(op: AniBuddyCritiqueLoopOp, units: number): Promise<AniBuddyChargeResult> {
        try {
          // Call to usage service. The rate comes from the landed cost table and
          // `units` is clamped there, so the loop cannot inflate a charge by asking
          // for more units than the table allows.
          const consumed = await UsageService.consume(
            data.userId,
            op,
            Config.anibuddy.visionModel,
            units,
          );
          eventIds.push(consumed.eventId);
          // The REAL cost, not the projection. The loop's own estimate exists only
          // to check the ceiling before a pass starts; what the ledger records has to
          // be what the user was charged.
          return { ok: true, eventId: consumed.eventId, credits: consumed.cost };
        } catch (error) {
          const status = error instanceof ApiError ? error.statusCode : 500;
          return {
            ok: false,
            status,
            error:
              error instanceof Error
                ? error.message
                : `Credits for ${op} could not be reserved.`,
          };
        }
      },

      async refund(eventId: string): Promise<void> {
        try {
          // Call to usage service. Idempotent by design, so a retried job cannot
          // return the same credits twice.
          await UsageService.refund(eventId);
        } catch (error) {
          // Best-effort, matching the studio refund path: a failed refund is logged
          // and never thrown, because throwing here would abandon the loop's result
          // and leave the user with neither their credits nor their rig.
          console.error('[anibuddy.critique] refund failed', { eventId, error });
        }
      },

      async reconcile(eventId: string, model: string): Promise<void> {
        try {
          // Call to usage service
          await UsageService.reconcile(eventId, model, servedProvider);
        } catch (error) {
          console.error('[anibuddy.critique] reconcile failed', { eventId, model, error });
        }
      },
    };
  },

  /**
   * Internal method — the progress line for a finished loop.
   *
   * The stop condition and the best-revision explanation are the two sentences the
   * user actually needs, and they are the last two entries the loop pushes. They go
   * on `stageProgress.message` rather than into `document.diagnostics.warnings`
   * deliberately: diagnostics are measured by the Python validator and carried
   * verbatim, and a gateway that appended its own narrative to them would make
   * "diagnostics are server-measured" a claim rather than a property.
   */
  _describe(result: AniBuddyCritiqueLoopResult): string {
    return (
      `critique stopped (${result.stopReason}) after ${result.passes.length} pass(es); ` +
      `kept pass ${result.best.passIndex} — ${result.warnings.slice(-1).join(' ')} ` +
      `Charged ${result.creditsCharged}, refunded ${result.creditsRefunded}.`
    ).slice(0, 2000);
  },

  /**
   * Worker entry: run one critique loop and persist the revision it selected.
   *
   * The BEST revision is persisted, not the last (F9 §11.6), and it is persisted
   * exactly as py_backend authored it — `diagnostics.blockingReason` included. The
   * unaccepted chain is not thrown away either: every revision the loop produced is
   * reported back on the job's return value so the editor can step through what was
   * tried, while `currentDocument` holds the one that won.
   */
  async processJob(data: AniBuddyCritiqueJobData): Promise<AniBuddyCritiqueLoopResult> {
    const project = await AniBuddyProjectModel.findById(data.projectId);
    if (!project) throw new Error(`AniBuddy project ${data.projectId} not found`);

    project.status = 'processing';
    project.stageProgress = {
      ...project.stageProgress,
      stage: AniBuddyConstants.critique.stage,
      status: 'running',
      percent: 10,
      message: `Running ${AniBuddyConstants.critique.stage} from pass ${data.startPassIndex}`,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      inputHash: data.inputHash,
      bullJobId: project.stageProgress.bullJobId,
    };
    await project.save();

    const eventIds: string[] = [];
    let result: AniBuddyCritiqueLoopResult;
    try {
      const document = AniBuddyService.requireDocument(project);
      // Both halves of the storage handoff, for the same reasons a render needs
      // them: py_backend holds no storage credentials, so the sheet's bytes and any
      // geometry that left as a `StorageAdapter` key both have to be carried in.
      // Every payload is verified against its own sha256 on the way (R7).
      const sheet = await AniBuddyService.readSheet(project);
      const buffers = await AniBuddyService.resolveGeometry(document);

      result = await AniBuddyCritiqueLoop.run(
        this._buildDeps({ data, sheet, buffers, eventIds }),
        {
          document,
          creditsAlreadySpent: data.creditsAlreadySpent,
          startPassIndex: data.startPassIndex,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await AniBuddyService.markFailed(project, AniBuddyConstants.critique.stage, message);
      throw error;
    }

    const parsed = AniBuddyRigDocumentDto.rigDocument.safeParse(result.best.document);
    if (!parsed.success) {
      const message = `The critique loop selected an invalid RigDocument: ${parsed.error.message}`;
      await AniBuddyService.markFailed(project, AniBuddyConstants.critique.stage, message);
      throw new Error(message);
    }
    const best: RigDocument = parsed.data;

    project.currentDocument = best as unknown as Record<string, unknown>;
    project.currentRevision = best.revision.index;
    // currentDocument is Mixed, so mongoose cannot see inside it; the whole-path
    // assignment above is what it tracks, and this states that explicitly.
    project.markModified('currentDocument');
    project.status = 'ready';
    project.lastError = null;
    for (const eventId of eventIds) {
      project.usageEventIds.push(new mongoose.Types.ObjectId(eventId));
    }
    project.stageProgress = {
      stage: AniBuddyConstants.critique.stage,
      status: 'succeeded',
      percent: 100,
      message: this._describe(result),
      startedAt: project.stageProgress.startedAt ?? new Date(),
      finishedAt: new Date(),
      error: null,
      inputHash: data.inputHash,
      bullJobId: project.stageProgress.bullJobId,
    };
    await project.save();

    return result;
  },
};
