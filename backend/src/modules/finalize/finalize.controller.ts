import type { Response } from 'express';
import { finalizeQueue } from '../../common/config/bullmq';
import { getJob, updateJob, parseAssets } from '../jobs/job.store';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import type { AuthRequest } from '../auth/auth.middleware';

export async function startFinalize(req: AuthRequest, res: Response): Promise<void> {
  const { jobId, selectedIds, updatedNames, skipUpscale } = req.body as {
    jobId: string;
    selectedIds: string[];
    updatedNames?: Record<string, string>;
    skipUpscale?: boolean;
  };

  if (!jobId) throw ApiError.badRequest('jobId required');
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw ApiError.badRequest('selectedIds required');
  }

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
  });
  await finalizeQueue.add('finalize', { jobId });

  ApiResponse.created(res, 'Finalize started', { jobId });
}
