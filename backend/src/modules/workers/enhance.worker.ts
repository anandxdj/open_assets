import { Worker } from 'bullmq';
import { redis } from '../../common/config/redis';
import { extractError } from '../../common/utils/extractError';
import { defaultAiEnhanceDeps } from '../enhance/enhance.deps';
import { runAiEnhanceJob } from '../enhance/aiEnhance.service';

interface EnhanceJobData {
  jobId: string;
}

export function startEnhanceWorker(): void {
  const worker = new Worker<EnhanceJobData>(
    'enhance',
    // Provider failures are recorded on the job and never thrown, so BullMQ
    // doesn't retry a transform that has already been billed.
    async (job) => runAiEnhanceJob(defaultAiEnhanceDeps, job.data.jobId),
    { connection: redis, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[enhance.worker] Job ${job?.data.jobId ?? '?'} failed: ${extractError(err)}`);
  });
  worker.on('error', (err) => console.error('[enhance.worker] Worker error:', extractError(err)));
  console.log('[enhance.worker] Started');
}
