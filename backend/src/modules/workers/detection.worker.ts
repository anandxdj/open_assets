import { Worker } from 'bullmq';
import { redis } from '../../common/config/redis';
import { updateJob } from '../jobs/job.store';
import { checkTransparency, detectAssets } from '../../lib/py.client';
import { extractError } from '../../common/utils/extractError';
import type { BoundingBox } from '../jobs/job.types';

interface DetectionJobData {
  jobId: string;
  cloudinaryUrl: string;
  publicId: string;
}

export function startDetectionWorker(): void {
  const worker = new Worker<DetectionJobData>(
    'detection',
    async (job) => {
      const { jobId, cloudinaryUrl } = job.data;

      await updateJob(jobId, { status: 'detecting' });

      // 1. Transparency check (recorded for later; background removal is deferred
      //    to AI export so the editor opens fast and detection has no add-on dependency).
      let transparent: boolean;
      try {
        ({ transparent } = await checkTransparency(cloudinaryUrl));
      } catch (err) {
        throw new Error(`Transparency check failed: ${extractError(err)}`);
      }

      await updateJob(jobId, { workingUrl: cloudinaryUrl, isTransparent: String(transparent) });

      // 2. Bounding-box detection on the original sheet (alpha mask if transparent,
      //    else white-background threshold).
      let result: Awaited<ReturnType<typeof detectAssets>>;
      try {
        result = await detectAssets(cloudinaryUrl);
      } catch (err) {
        throw new Error(`Asset detection failed: ${extractError(err)}`);
      }

      if (result.boxes.length === 0) {
        throw new Error('No assets detected — image may be blank or detection thresholds too strict');
      }

      const boxes: BoundingBox[] = result.boxes.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        label: b.name,
      }));

      await updateJob(jobId, {
        status: 'detected',
        boxes: JSON.stringify(boxes),
        imageWidth: String(result.image_width),
        imageHeight: String(result.image_height),
      });

      console.log(`[detection.worker] Job ${jobId}: ${boxes.length} assets detected`);
    },
    { connection: redis, concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    const msg = extractError(err);
    if (job) {
      updateJob(job.data.jobId, { status: 'failed', error: msg }).catch((e) =>
        console.error('[detection.worker] updateJob failed:', e),
      );
    }
    console.error(`[detection.worker] Job ${job?.data.jobId ?? '?'} failed: ${msg}`);
  });

  worker.on('error', (err) => console.error('[detection.worker] Worker error:', extractError(err)));
  console.log('[detection.worker] Started');
}
