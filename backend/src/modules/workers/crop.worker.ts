import { Worker } from 'bullmq';
import { redis } from '../../common/config/redis';
import { getJob, updateJob, parseBoxes } from '../jobs/job.store';
import { nameAssets } from '../../lib/py.client';
import type { AssetResult } from '../../lib/py.client';
import { cropIntoStorage } from '../../lib/cropStore';
import type { NameAssetsResult } from '../../lib/py.client';
import { storage } from '../../lib/storage';
import { getStorageStatus } from '../../lib/storage/status';
import { parseBackground, serializeBackground } from '../../lib/background';
import type { BackgroundRemovalMode } from '../../lib/background';
import { describeBackground, fetchIsTransparent, removeSheetBackground } from './cropBackground';
import { extractError } from '../../common/utils/extractError';
import { scaffoldCollectionFromJob } from '../collections/collection.service';
import type { ScaffoldImage } from '../collections/collection.service';

interface CropJobData {
  jobId: string;
  isRaw?: boolean;
  /** Also remove background pockets the sheet border cannot reach. Absent on jobs queued before the option existed. */
  removeEnclosedBackground?: boolean;
  /** How the background is removed. Absent on jobs queued before the option existed, which means `auto`. */
  backgroundRemoval?: BackgroundRemovalMode;
}

/**
 * Auto-scaffold a draft collection from a finished AI crop using the same Gemini
 * naming result (collection name + folder groupings + per-asset tags). Maps each
 * still-systematic-named crop to its enrichment, then persists via the service.
 * Fully non-fatal — any failure is logged and swallowed so the crop still
 * succeeds.
 */
async function scaffoldCollection(
  jobId: string,
  userId: string | undefined,
  naming: NameAssetsResult,
  cropped: { id: string; name: string; cropped_url: string; public_id: string }[],
): Promise<void> {
  if (!userId || userId === 'anonymous') return; // no owner → nothing to attach
  try {
    const enrichBySys = new Map((naming.assets ?? []).map((a) => [a.systematic, a]));
    const images: ScaffoldImage[] = cropped.map((a) => {
      const sys = a.name; // still the systematic id at this point
      const e = enrichBySys.get(sys);
      return {
        name: naming.names?.[sys] || sys,
        folder: e?.folder ?? undefined,
        tags: e?.tags ?? [],
        description: e?.description ?? undefined,
        dominantColors: e?.dominant_colors ?? [],
        cloudinaryUrl: a.cropped_url,
        cloudinaryPublicId: a.public_id,
        sourceAssetName: sys,
      };
    });
    await scaffoldCollectionFromJob({
      userId,
      jobId,
      collectionName: naming.collection?.name ?? undefined,
      collectionTags: naming.collection?.tags ?? [],
      folders: naming.folders ?? [],
      images,
    });
    console.log(`[crop.worker] Job ${jobId}: scaffolded draft collection (${images.length} images)`);
  } catch (err) {
    console.warn(`[crop.worker] collection scaffold failed (non-fatal): ${extractError(err)}`);
  }
}

/** Starts the worker and returns it so the caller can close it on shutdown. */
export function startCropWorker(): Worker<CropJobData> {
  const worker = new Worker<CropJobData>(
    'crop',
    async (job) => {
      const { jobId, isRaw, removeEnclosedBackground, backgroundRemoval } = job.data;

      const jobData = await getJob(jobId);
      if (!jobData) throw new Error(`Job ${jobId} not found in Redis`);

      const boxes = parseBoxes(jobData.boxes);
      if (boxes.length === 0) throw new Error(`Job ${jobId} has no boxes — was detection completed?`);

      let workingUrl = jobData.cloudinaryUrl;
      let nameMap: Record<string, string> = {};
      let assets: AssetResult[] = [];

      if (isRaw) {
        // Legacy server-side raw path (the frontend now crops raw locally).
        // Cut the original sheet as-is — no background removal, no naming.
        await updateJob(jobId, {
          status: 'cropping',
          workingUrl,
          backgroundMethod: 'none',
          backgroundReason: 'The sheet was cut as it is (raw crop).',
        });
        try {
          assets = await cropIntoStorage(workingUrl, boxes, jobId);
        } catch (err) {
          throw new Error(`Cropping failed: ${extractError(err)}`);
        }
      } else {
        // AI pipeline: kick off background removal AND Gemini naming together.
        await updateJob(jobId, { status: 'removing_bg' });
        const namingPromise: Promise<NameAssetsResult> = nameAssets(jobData.cloudinaryUrl, boxes).catch((err) => {
          console.warn(`[crop.worker] Gemini naming failed — keeping systematic names: ${extractError(err)}`);
          return { names: {} } as NameAssetsResult;
        });

        // 1. Make the whole image transparent, the cheapest way that works: our own keyer for a flat or
        //    chroma-key sheet (free, any provider), the provider's AI only for a gradient or texture.
        //    Cut as soon as it's ready; don't block on Gemini, which keeps running in the background.
        const request = {
          jobId,
          publicId: jobData.publicId,
          originalUrl: jobData.cloudinaryUrl,
          mode: backgroundRemoval,
          removeEnclosed: removeEnclosedBackground === true,
          background: parseBackground(jobData.background),
        };
        let outcome: Awaited<ReturnType<typeof removeSheetBackground>>;
        try {
          outcome = await removeSheetBackground(request, { storage, supportsAi: getStorageStatus().supportsAi, checkTransparent: fetchIsTransparent });
        } catch (err) {
          throw new Error(`Background removal failed: ${extractError(err)}`);
        }
        console.log(describeBackground(jobId, request, outcome));
        workingUrl = outcome.workingUrl;
        await updateJob(jobId, {
          workingUrl,
          status: 'cropping',
          backgroundMethod: outcome.method,
          backgroundReason: outcome.reason ?? '',
          ...(outcome.workingPublicId ? { workingPublicId: outcome.workingPublicId } : {}),
          // A job queued before detection stored its classification gets the one made here.
          ...(!request.background && outcome.background ? { background: serializeBackground(outcome.background) } : {}),
        });

        // 2. Cut each box out of the transparent image (systematic names for now).
        try {
          assets = await cropIntoStorage(workingUrl, boxes, jobId);
        } catch (err) {
          throw new Error(`Cropping failed: ${extractError(err)}`);
        }
        if (assets.length === 0) {
          throw new Error('Crop produced no assets — all boxes may have been out of image bounds');
        }

        // 3. Now wait for Gemini, then rename every cut asset.
        await updateJob(jobId, { status: 'naming' });
        const naming = await namingPromise;
        nameMap = naming.names ?? {};

        // Keep the systematic-named crops so we can map each one to its Gemini
        // enrichment (folder/tags/description) before the rename loses the id.
        const preRename = assets;
        assets = assets.map((a) => ({ ...a, name: nameMap[a.name] || a.name }));

        // 4. Auto-scaffold a DRAFT collection from the same Gemini result.
        //    Non-fatal: a scaffold failure must never fail the crop job.
        await scaffoldCollection(jobId, jobData.userId, naming, preRename);
      }

      if (assets.length === 0) {
        throw new Error('Crop produced no assets — all boxes may have been out of image bounds');
      }

      await updateJob(jobId, {
        status: 'cropped',
        nameMap: JSON.stringify(nameMap),
        assets: JSON.stringify(assets),
      });

      console.log(`[crop.worker] Job ${jobId}: ${assets.length} assets cropped`);
    },
    { connection: redis, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    const msg = extractError(err);
    if (job) {
      updateJob(job.data.jobId, { status: 'failed', error: msg }).catch((e) =>
        console.error('[crop.worker] updateJob failed:', e),
      );
    }
    console.error(`[crop.worker] Job ${job?.data.jobId ?? '?'} failed: ${msg}`);
  });

  worker.on('error', (err) => console.error('[crop.worker] Worker error:', extractError(err)));
  console.log('[crop.worker] Started');
  return worker;
}
