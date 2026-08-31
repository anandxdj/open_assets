import { Worker } from 'bullmq';
import { redis } from '../../common/config/redis';
import { Config } from '../../common/config/config';
import { extractError } from '../../common/utils/extractError';
import { AniBuddyConstants } from '../anibuddy/anibuddy.constants';
import type { AniBuddyQueuedStage } from '../anibuddy/anibuddy.constants';
import { AniBuddyService } from '../anibuddy/anibuddy.service';
import type { AniBuddyJobData } from '../anibuddy/anibuddy.service';
import { AniBuddyCritiqueService } from '../anibuddy/anibuddy.critique.service';
import type { AniBuddyCritiqueJobData } from '../anibuddy/anibuddy.critique.service';
import { AniBuddyProjectModel } from '../anibuddy/anibuddy.project.model';

/**
 * Internal method — mark the project failed so the poller sees a reason.
 *
 * Shared by both workers because the failure contract is the same one in both
 * cases: a job that dies without writing this leaves `stageProgress` on `running`
 * forever, and the editor shows a spinner with no explanation.
 */
function _markProjectFailed(projectId: string | undefined, message: string): void {
  if (!projectId) return;
  AniBuddyProjectModel.findByIdAndUpdate(projectId, {
    status: 'failed',
    lastError: message.slice(0, 2000),
    'stageProgress.status': 'failed',
    'stageProgress.error': message.slice(0, 2000),
    'stageProgress.message': message.slice(0, 2000),
    'stageProgress.finishedAt': new Date(),
  }).catch((e) => console.error(`[anibuddy.worker] mark-failed write error:`, e));
}

function _startStageWorker(stage: AniBuddyQueuedStage): void {
  const queueName = AniBuddyConstants.queueByStage[stage];
  const worker = new Worker<AniBuddyJobData>(
    queueName,
    async (job) => {
      await AniBuddyService.processStageJob(job.data);
      // The transport is logged rather than assumed: which surface a stage ran
      // against is a constants-table entry that changes as stages go real, and a
      // log line that says "done" without saying over what is unreadable later.
      const transport = AniBuddyConstants.transportByStage[stage];
      console.log(
        `[anibuddy.worker] ${stage} (${transport} → ` +
          `${AniBuddyConstants.serviceByTransport[transport]}) ` +
          `project=${job.data.projectId} hash=${job.data.inputHash.slice(0, 8)}… done`,
      );
    },
    { connection: redis, concurrency: Config.anibuddy.workerConcurrency },
  );

  worker.on('failed', (job, err) => {
    const msg = extractError(err);
    _markProjectFailed(job?.data.projectId, msg);
    console.error(`[anibuddy.worker] ${queueName} job ${job?.data.projectId ?? '?'} failed: ${msg}`);
  });

  worker.on('error', (err) =>
    console.error(`[anibuddy.worker] ${queueName} worker error:`, extractError(err)),
  );
  console.log(`[anibuddy.worker] Started ${queueName}`);
}

/**
 * The closed critique loop's worker (F9 §11).
 *
 * Its own worker rather than a fifth stage worker, and its own concurrency, because
 * one job is not one call: it is up to three contact-sheet renders and up to three
 * vision calls under a single wall-clock budget, and it charges and refunds per
 * pass. Running it at the stage concurrency would make its budget a function of how
 * many unrelated jobs happened to start alongside it.
 *
 * The loop itself is not here and is not duplicated anywhere: this hands the job to
 * `AniBuddyCritiqueService`, which supplies the four injected functions the one
 * implementation in `anibuddy.critique.loop.ts` runs on.
 *
 * A non-converging loop is a SUCCESS as far as BullMQ is concerned. That is the
 * §11.6 contract: the pass cap, the credit ceiling and the time budget are defined
 * endings with a best revision selected, not failures, and letting BullMQ retry one
 * would spend the ceiling again on a rig that already got its answer.
 */
function _startCritiqueWorker(): void {
  const queueName = AniBuddyConstants.critique.queueName;
  const worker = new Worker<AniBuddyCritiqueJobData>(
    queueName,
    async (job) => {
      const result = await AniBuddyCritiqueService.processJob(job.data);
      console.log(
        `[anibuddy.worker] critique project=${job.data.projectId} ` +
          `stop=${result.stopReason} passes=${result.passes.length} ` +
          `best=pass${result.best.passIndex} (${result.bestSelection}) ` +
          `charged=${result.creditsCharged} refunded=${result.creditsRefunded}`,
      );
      return {
        stopReason: result.stopReason,
        bestPassIndex: result.best.passIndex,
        bestSelection: result.bestSelection,
        // The unaccepted chain, so the editor can step through what was tried and
        // diff pass N against pass N-1 (§11.6). The winner is on the project;
        // these are the ones that lost, and they are kept deliberately.
        revisions: result.revisions.map((revision) => ({
          passIndex: revision.passIndex,
          id: revision.document.id,
          origin: revision.origin,
          maxStretch: revision.diagnostics.maxStretch,
          flippedTriangles: revision.diagnostics.flippedTriangles,
          blockingReason: revision.diagnostics.blockingReason,
        })),
        passes: result.passes,
        deformerOverrides: result.deformerOverrides,
        requiresRerig: Object.keys(result.deformerOverrides).length > 0,
        creditsCharged: result.creditsCharged,
        creditsRefunded: result.creditsRefunded,
        warnings: result.warnings,
      };
    },
    { connection: redis, concurrency: Config.anibuddy.critiqueConcurrency },
  );

  worker.on('failed', (job, err) => {
    const msg = extractError(err);
    _markProjectFailed(job?.data.projectId, msg);
    console.error(`[anibuddy.worker] ${queueName} job ${job?.data.projectId ?? '?'} failed: ${msg}`);
  });

  worker.on('error', (err) =>
    console.error(`[anibuddy.worker] ${queueName} worker error:`, extractError(err)),
  );
  console.log(`[anibuddy.worker] Started ${queueName}`);
}

/**
 * Start the four stage workers and the critique loop worker.
 *
 * None of the stage workers names a remote endpoint. Each job asks
 * `AniBuddyConstants.transportByStage` which transport its stage runs, and
 * `serviceByTransport` which service that transport lives on — so `decompose`, `rig`
 * and `render` reaching py_backend while `animate` reaches the one provider chain in
 * the Next app is two tables, not two code paths.
 */
export function startAniBuddyWorkers(): void {
  for (const stage of AniBuddyConstants.queuedStages) {
    _startStageWorker(stage);
  }
  _startCritiqueWorker();
}
