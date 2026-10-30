import type { Response } from 'express';
import { finalizeQueue } from '../../common/config/bullmq';
import { getJob, updateJob, parseAssets } from '../jobs/job.store';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import type { AuthRequest } from '../auth/auth.middleware';
import { assertWithinLimit } from '../plans/entitlements';
import { UPSCALE_SCALES } from '../plans/upscale';
import { resolveNamingPattern } from '../naming/naming.service';

export async function startFinalize(req: AuthRequest, res: Response): Promise<void> {
  const { jobId, selectedIds, updatedNames, skipUpscale, scale, namingPattern } = req.body as {
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
  };

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
  if (!skipUpscale && req.user) assertWithinLimit(req.user, 'maxUpscale', upscaleScale);
  // Plan gate for custom naming patterns: 403 PLAN_REQUIRED, 400 INVALID_PATTERN.
  const pattern = await resolveNamingPattern(req.user, namingPattern);

  const jobData = await getJob(jobId);
  if (!jobData) throw ApiError.notFound('Job not found');
  assertOwner(jobData.userId, req.user?.id, 'Not your job');
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

  ApiResponse.created(res, 'Finalize started', { jobId });
}
