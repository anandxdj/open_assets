import type { Response } from 'express';
import { finalizeQueue } from '../../common/config/bullmq';
import { getJob, updateJob, parseAssets } from '../jobs/job.store';
import type { Asset, JobHash } from '../jobs/job.types';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import type { AuthRequest } from '../auth/auth.middleware';
import { assertWithinLimit } from '../plans/entitlements';
import { UPSCALE_SCALES } from '../plans/upscale';
import { resolveNamingPattern } from '../naming/naming.service';

export interface FinalizeRequestBody {
  jobId: string;
  selectedIds: string[];
  updatedNames?: Record<string, string>;
  skipUpscale?: boolean;
  /** Upscale factor, 2 (default) or 4. 4 needs the Pro plan. */
  scale?: number;
  /**
   * Naming pattern for the export's file names. A custom one needs Pro (403 PLAN_REQUIRED);
   * omitted, a Pro account's saved default applies, otherwise the default pattern.
   */
  namingPattern?: string;
}

/** What a started export decided, for callers (the public API) that report more than the job id. */
export interface StartedFinalize {
  jobId: string;
  /** The job as it was when the export started (status `cropped`). */
  job: JobHash & { id: string };
  /** Every asset of the job, with the names from `updatedNames` applied. */
  assets: Asset[];
  /** The selected ids that matched an asset, in the order given. */
  selectedIds: string[];
  scale: number;
  skipUpscale: boolean;
  /** The naming pattern the export's file names follow. */
  pattern: string;
}

/**
 * Validates an export request, applies the plan gates (maxUpscale, custom naming
 * patterns), stores the choices on the job and queues the finalize worker.
 * Shared by the web route and the public API.
 */
export async function beginFinalize(user: AuthRequest['user'], body: FinalizeRequestBody): Promise<StartedFinalize> {
  const { jobId, selectedIds, updatedNames, skipUpscale, scale, namingPattern } = body;

  if (!jobId) throw ApiError.badRequest('jobId required');
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw ApiError.badRequest('selectedIds required');
  }
  const upscaleScale = scale ?? UPSCALE_SCALES[0];
  if (!UPSCALE_SCALES.includes(upscaleScale as (typeof UPSCALE_SCALES)[number])) {
    throw ApiError.badRequest(`scale must be one of ${UPSCALE_SCALES.join(', ')}`);
  }
  // Plan gate: 403 PLAN_LIMIT when the factor is above the plan's maxUpscale.
  // Skipped exports do not upscale, so they have nothing to gate.
  if (!skipUpscale && user) assertWithinLimit(user, 'maxUpscale', upscaleScale);
  // Plan gate for custom naming patterns: 403 PLAN_REQUIRED, 400 INVALID_PATTERN.
  const pattern = await resolveNamingPattern(user, namingPattern);

  const jobData = await getJob(jobId);
  if (!jobData) throw ApiError.notFound('Job not found');
  assertOwner(jobData.userId, user?.id, 'Not your job');
  if (jobData.status !== 'cropped') {
    throw ApiError.badRequest(`Job not ready for finalize (status: ${jobData.status})`);
  }

  let assets = parseAssets(jobData.assets);
  if (updatedNames) {
    assets = assets.map((a) => ({
      ...a,
      name: updatedNames[a.id] || a.name,
    }));
  }

  const assetIds = new Set(assets.map((a) => a.id));
  const valid = selectedIds.filter((id) => assetIds.has(id));
  if (valid.length === 0) throw ApiError.badRequest('No valid selectedIds match cropped assets');

  await updateJob(jobId, {
    assets: JSON.stringify(assets),
    selectedIds: JSON.stringify(valid),
    skipUpscale: skipUpscale ? 'true' : 'false',
    upscaleScale: String(upscaleScale),
    namingPattern: pattern,
  });
  await finalizeQueue.add('finalize', { jobId });

  return { jobId, job: jobData, assets, selectedIds: valid, scale: upscaleScale, skipUpscale: Boolean(skipUpscale), pattern };
}

export async function startFinalize(req: AuthRequest, res: Response): Promise<void> {
  const { jobId } = await beginFinalize(req.user, req.body as FinalizeRequestBody);
  ApiResponse.created(res, 'Finalize started', { jobId });
}
