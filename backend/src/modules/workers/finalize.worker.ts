import { Worker } from 'bullmq';
import { redis } from '../../common/config/redis';
import { getJob, updateJob, parseAssets } from '../jobs/job.store';
import { storage } from '../../lib/storage';
import { extractError } from '../../common/utils/extractError';
import { mapLimit } from '../../common/utils/mapLimit';
import { replaceImageWithUpscaled } from '../collections/collection.service';

const UPSCALE_CONCURRENCY = 4;

interface FinalizeJobData {
  jobId: string;
}

export function startFinalizeWorker(): void {
  const worker = new Worker<FinalizeJobData>(
    'finalize',
    async (job) => {
      const { jobId } = job.data;

      await updateJob(jobId, { status: 'finalizing' });

      const jobData = await getJob(jobId);
      if (!jobData) throw new Error(`Job ${jobId} not found in Redis`);

      const assets = parseAssets(jobData.assets);
      const selectedIds: string[] = JSON.parse(jobData.selectedIds || '[]');
      const selectedSet = new Set(selectedIds);
      const selected = assets.filter((a) => selectedSet.has(a.id));

      if (selected.length === 0) {
        throw new Error(`Job ${jobId}: no selected assets — were valid selectedIds provided?`);
      }

      const skipUpscale = jobData.skipUpscale === 'true';

      // Upscale each selected asset (bounded concurrency) and write its upscaled_url
      // back onto the asset AS IT COMPLETES, so the client can show per-asset progress
      // and then zip the upscaled URLs locally. No server-side zip / Cloudinary upload.
      console.log(`[finalize.worker] Job ${jobId}: upscaling ${selected.length} assets…`);
      const byId = new Map(assets.map((a) => [a.id, { ...a }]));

      await mapLimit(selected, UPSCALE_CONCURRENCY, async (asset) => {
        let url: string;
        if (skipUpscale) {
          url = asset.cropped_url;
        } else {
          try {
            url = await storage.applyUpscale(asset.public_id);
          } catch (err) {
            throw new Error(`Upscale failed for asset "${asset.name}" (${asset.public_id}): ${extractError(err)}`);
          }
        }
        const a = byId.get(asset.id);
        if (a) a.upscaled_url = url;
        // Persist incrementally (shared map → every write is a superset; no lost updates).
        await updateJob(jobId, { assets: JSON.stringify([...byId.values()]) });

        // P2: if this job auto-scaffolded a collection, swap its stored image for
        // the upscaled render. No-op when the upscale was skipped or no collection
        // exists. Non-fatal — collection sync must not fail the finalize job.
        if (!skipUpscale) {
          await replaceImageWithUpscaled(jobId, asset.public_id, url).catch((err) =>
            console.warn(`[finalize.worker] collection image swap failed (non-fatal): ${extractError(err)}`),
          );
        }
      });

      await updateJob(jobId, { status: 'ready', assets: JSON.stringify([...byId.values()]) });

      console.log(`[finalize.worker] Job ${jobId}: ${selected.length} assets upscaled`);
    },
    { connection: redis, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    const msg = extractError(err);
    if (job) {
      updateJob(job.data.jobId, { status: 'failed', error: msg }).catch((e) =>
        console.error('[finalize.worker] updateJob failed:', e),
      );
    }
    console.error(`[finalize.worker] Job ${job?.data.jobId ?? '?'} failed: ${msg}`);
  });

  worker.on('error', (err) => console.error('[finalize.worker] Worker error:', extractError(err)));
  console.log('[finalize.worker] Started');
}
