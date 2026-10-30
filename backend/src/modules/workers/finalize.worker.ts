import { Worker } from 'bullmq';
import { redis } from '../../common/config/redis';
import { getJob, updateJob, parseAssets, parseBoxes } from '../jobs/job.store';
import { storage } from '../../lib/storage';
import { extractError } from '../../common/utils/extractError';
import { mapLimit } from '../../common/utils/mapLimit';
import { replaceImageWithUpscaled } from '../collections/collection.service';
import { croppedWidth, UPSCALE_SCALES } from '../plans/upscale';
import type { UpscaleScale } from '../plans/upscale';
import { nameExportAssets } from '../naming/exportNames';
import { DEFAULT_PATTERN } from '../naming/pattern';

const UPSCALE_CONCURRENCY = 4;

interface FinalizeJobData {
  jobId: string;
}

/**
 * One finalize job: gives every selected asset its export file name from the
 * job's naming pattern, upscales each one (unless skipped) and marks the job
 * ready. Exported so tests can run it without a queue.
 */
export async function processFinalize(jobId: string): Promise<void> {
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
  // Validated and plan-gated in finalize.controller; anything unexpected falls back to 2x.
  const requested = Number(jobData.upscaleScale);
  const scale: UpscaleScale = (UPSCALE_SCALES as readonly number[]).includes(requested) ? (requested as UpscaleScale) : 2;

  // Upscale each selected asset (bounded concurrency) and write its upscaled_url
  // back onto the asset AS IT COMPLETES, so the client can show per-asset progress
  // and then zip the upscaled URLs locally. No server-side zip / Cloudinary upload.
  console.log(`[finalize.worker] Job ${jobId}: upscaling ${selected.length} assets (${scale}x)…`);
  const byId = new Map(assets.map((a) => [a.id, { ...a }]));
  // Asset ids are box ids: the box gives the source width the factor applies to.
  const sheetWidth = Number(jobData.imageWidth) || 0;
  const sheetHeight = Number(jobData.imageHeight) || 0;
  const boxes = parseBoxes(jobData.boxes);
  const boxById = new Map(boxes.map((b) => [b.id, b]));

  // File names come from the job's naming pattern (checked and plan-gated when the export was
  // requested), set on every selected asset up front so each incremental write below carries them.
  // The ZIP the client builds uses `file_name`. A pattern that somehow fails falls back to the
  // default one: naming must never fail the export.
  const nameInput = {
    assets: selected,
    boxes,
    sheetWidth,
    sheetHeight,
    sheetFileName: jobData.fileName,
    scale: skipUpscale ? 1 : scale,
  };
  let named: ReturnType<typeof nameExportAssets>;
  try {
    named = nameExportAssets({ ...nameInput, pattern: jobData.namingPattern || DEFAULT_PATTERN });
  } catch (err) {
    console.warn(`[finalize.worker] Job ${jobId}: naming pattern failed, using the default: ${extractError(err)}`);
    named = nameExportAssets({ ...nameInput, pattern: DEFAULT_PATTERN });
  }
  for (const n of named) {
    const a = byId.get(n.id);
    if (a) a.file_name = n.fileName;
  }

  await mapLimit(selected, UPSCALE_CONCURRENCY, async (asset) => {
    let url: string;
    if (skipUpscale) {
      url = asset.cropped_url;
    } else {
      try {
        const box = boxById.get(asset.id);
        url = await storage.applyUpscale(asset.public_id, scale, box ? croppedWidth(box, sheetWidth) : undefined);
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
}

/** Starts the worker and returns it so the caller can close it on shutdown. */
export function startFinalizeWorker(): Worker<FinalizeJobData> {
  const worker = new Worker<FinalizeJobData>(
    'finalize',
    async (job) => processFinalize(job.data.jobId),
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
  return worker;
}
