import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { buildZipBuffer } from '../../lib/zip.builder';
import type { ZipItem } from '../../lib/zip.builder';
import { enforceSheetLimit } from '../plans/plans.middleware';
import { getPlanStatus } from '../plans/plans.service';
import { startCrop } from '../crop/crop.controller';
import { beginFinalize } from '../finalize/finalize.controller';
import { nameExportAssets } from '../naming/exportNames';
import { getJob, listUserJobs, parseAssets, parseBoxes } from '../jobs/job.store';
import { parseListQuery } from '../jobs/job.list';
import type { JobHash } from '../jobs/job.types';
import { createJobFromUpload } from '../upload/upload.controller';
import { upload } from '../upload/upload.routes';
import { authenticateApiKey } from './v1.auth';
import type { ApiKeyRequest } from './v1.auth';
import { v1Error } from './v1.errors';
import { V1_LIMITS, failedAuthLimiter, requestLimiter, startLimiter } from './v1.limits';
import { cropBodySchema, exportBodySchema, validateBody } from './v1.schemas';
import type { CropBody, ExportBody } from './v1.schemas';
import { serializeJob, serializeJobSummary } from './v1.serializers';
import type { V1JobPage } from './v1.serializers';

/**
 * The public API, mounted at /api/v1. Authenticated with an API key only (see
 * v1.auth.ts). It adds no pipeline logic of its own: uploads, crops and exports
 * go through the same controllers and queues as the web app, so plan limits,
 * the monthly sheet counter and the maxUpscale gate apply identically.
 *
 * The web flow is: upload -> (detected) -> crop -> (cropped) -> export -> (ready) -> ZIP.
 */
const router = Router();

// Order matters: count bad keys per IP, authenticate, then count requests per key.
router.use(failedAuthLimiter, authenticateApiKey, requestLimiter);

/**
 * The job named in the URL, if it belongs to the key's owner. Someone else's job
 * and a job that does not exist are the same 404, so ids cannot be probed.
 */
async function loadOwnedJob(req: ApiKeyRequest): Promise<JobHash & { id: string }> {
  const job = await getJob(req.params['jobId'] ?? '');
  if (!job || !req.user || job.userId !== req.user.id) {
    throw v1Error(404, 'JOB_NOT_FOUND', 'Job not found.');
  }
  return job;
}

function wrongState(job: JobHash & { id: string }, expected: JobHash['status']): ApiError {
  return v1Error(409, 'INVALID_JOB_STATE', `This call needs a job with status "${expected}", but the job is "${job.status}".`, {
    status: job.status,
    expected,
  });
}

/** Who the key belongs to, the plan behind it, this month's sheets and the limits that apply. */
router.get(
  '/me',
  asyncHandler(async (req: ApiKeyRequest, res: Response) => {
    const plan = await getPlanStatus(req.user!.id);
    ApiResponse.ok(res, 'Account', {
      key: req.apiKey,
      plan: plan.effectivePlan,
      sheets: plan.sheets,
      maxUpscale: plan.entitlements.maxUpscale,
      rateLimits: V1_LIMITS,
    });
  }),
);

/** Upload a sheet (multipart, field `image`). Counts against the monthly sheet allowance. */
router.post(
  '/jobs',
  startLimiter,
  enforceSheetLimit,
  upload.single('image'),
  (req: Request, _res: Response, next: NextFunction) =>
    next(req.file ? undefined : v1Error(400, 'IMAGE_REQUIRED', 'Send the sheet as multipart/form-data in the "image" field.')),
  asyncHandler(async (req: ApiKeyRequest, res: Response) => {
    const sheet = await createJobFromUpload(req, res);
    ApiResponse.created(res, 'Sheet uploaded. Detection has started.', {
      jobId: sheet.jobId,
      status: sheet.status,
      imageUrl: sheet.cloudinaryUrl,
    });
  }),
);

/** Recent jobs, newest first. `?limit=1..100` (default 50) and `?cursor=` from the previous page. */
router.get(
  '/jobs',
  asyncHandler(async (req: ApiKeyRequest, res: Response) => {
    const { jobs, nextCursor } = await listUserJobs(req.user!.id, parseListQuery(req.query));
    const page: V1JobPage = { jobs: jobs.map(serializeJobSummary), nextCursor };
    ApiResponse.ok(res, 'Jobs', page);
  }),
);

/** Status, detected boxes and, once cropped, the assets with their names. */
router.get(
  '/jobs/:jobId',
  asyncHandler(async (req: ApiKeyRequest, res: Response) => {
    ApiResponse.ok(res, 'Job', serializeJob(await loadOwnedJob(req)));
  }),
);

/**
 * Cut the assets out and name them (background removal and AI naming).
 * Needs status `detected`. Send `boxes` to correct what detection found,
 * or nothing to use the detected boxes as they are.
 */
router.post(
  '/jobs/:jobId/crop',
  startLimiter,
  validateBody(cropBodySchema),
  asyncHandler(async (req: ApiKeyRequest, res: Response) => {
    const job = await loadOwnedJob(req);
    if (job.status !== 'detected') throw wrongState(job, 'detected');

    const { boxes: sentBoxes, removeEnclosedBackground, backgroundRemoval } = req.body as CropBody;
    const boxes = sentBoxes ?? parseBoxes(job.boxes);
    if (boxes.length === 0) throw v1Error(409, 'INVALID_JOB_STATE', 'No assets were detected on this sheet, so there is nothing to crop.', { status: job.status });

    req.body = {
      jobId: job.id,
      boxes,
      ...(removeEnclosedBackground !== undefined ? { removeEnclosedBackground } : {}),
      ...(backgroundRemoval !== undefined ? { backgroundRemoval } : {}),
    };
    await startCrop(req, res);
  }),
);

/**
 * Start the export: optional rename, upscale, naming pattern and the ZIP. Needs
 * status `cropped`. `scale` 4 is checked against the plan's maxUpscale and a
 * custom `namingPattern` against the customNamingPatterns entitlement, both by
 * the same code the web export runs (beginFinalize). The response lists the file
 * names the export will use, worked out by the same naming function the finalize
 * worker uses.
 */
router.post(
  '/jobs/:jobId/export',
  startLimiter,
  validateBody(exportBodySchema),
  asyncHandler(async (req: ApiKeyRequest, res: Response) => {
    const job = await loadOwnedJob(req);
    if (job.status !== 'cropped') throw wrongState(job, 'cropped');

    const { selectedIds, names, scale, upscale, namingPattern } = req.body as ExportBody;
    const started = await beginFinalize(req.user, {
      jobId: job.id,
      selectedIds: selectedIds ?? parseAssets(job.assets).map((a) => a.id),
      ...(names ? { updatedNames: names } : {}),
      skipUpscale: upscale === false,
      ...(scale ? { scale } : {}),
      ...(namingPattern !== undefined ? { namingPattern } : {}),
    });

    const chosen = new Set(started.selectedIds);
    const exportScale = started.skipUpscale ? 1 : started.scale;
    const files = nameExportAssets({
      assets: started.assets.filter((a) => chosen.has(a.id)),
      boxes: parseBoxes(job.boxes),
      sheetWidth: Number(job.imageWidth) || 0,
      sheetHeight: Number(job.imageHeight) || 0,
      sheetFileName: job.fileName,
      pattern: started.pattern,
      scale: exportScale,
    }).map(({ id, name, fileName }) => ({ id, name, fileName }));

    ApiResponse.created(res, 'Export started', {
      jobId: job.id,
      namingPattern: started.pattern,
      scale: exportScale,
      files,
    });
  }),
);

function selectedAssetIds(job: JobHash): Set<string> {
  try {
    const parsed: unknown = JSON.parse(job.selectedIds || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The ZIP of the exported PNGs, named by the export's pattern. Needs status `ready`. Built on request, like collection downloads. */
router.get(
  '/jobs/:jobId/download',
  asyncHandler(async (req: ApiKeyRequest, res: Response) => {
    const job = await loadOwnedJob(req);
    if (job.status !== 'ready') {
      throw v1Error(409, 'JOB_NOT_READY', `The export is not ready (status "${job.status}").`, { status: job.status });
    }

    const selected = selectedAssetIds(job);
    const items: ZipItem[] = parseAssets(job.assets)
      .filter((asset) => selected.has(asset.id))
      .map((asset) => ({
        name: asset.name,
        // The names the export's naming pattern chose, exactly as the web app's ZIP uses them.
        ...(asset.file_name ? { stem: asset.file_name.replace(/\.png$/i, '') } : {}),
        url: asset.upscaled_url ?? asset.cropped_url,
      }));

    let zip: Buffer;
    try {
      zip = await buildZipBuffer(items, job.fileName || job.id);
    } catch (err) {
      console.error(`[v1] could not build the ZIP for job ${job.id}:`, err instanceof Error ? err.message : err);
      throw v1Error(502, 'EXPORT_FETCH_FAILED', 'The exported assets could not be fetched from storage. Try again.');
    }

    res.status(200);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="openassets-${job.id}.zip"`,
      'Content-Length': String(zip.length),
      'Cache-Control': 'private, no-store',
    });
    res.send(zip);
  }),
);

router.use((_req: Request, _res: Response, next: NextFunction) => next(v1Error(404, 'NOT_FOUND', 'No such endpoint.')));

export { router as v1Router };
