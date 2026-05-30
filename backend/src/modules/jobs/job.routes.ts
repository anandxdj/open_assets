import { Router } from 'express';
import type { Response } from 'express';
import { authenticate } from '../auth/auth.middleware';
import type { AuthRequest } from '../auth/auth.middleware';
import { getJob, parseBoxes, parseAssets } from './job.store';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { assertOwner } from '../../common/utils/authz';
import type { JobResponse } from './job.types';

const router = Router();

router.get('/jobs/:jobId', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await getJob(req.params['jobId'] ?? '');
  if (!job) throw ApiError.notFound('Job not found');
  assertOwner(job.userId, req.user?.id, 'Not your job');

  const response: JobResponse = {
    jobId: job.id,
    status: job.status,
    cloudinaryUrl: job.cloudinaryUrl,
    workingUrl: job.workingUrl || undefined,
    isTransparent: job.isTransparent ? job.isTransparent === 'true' : undefined,
    imageWidth: Number(job.imageWidth) || 0,
    imageHeight: Number(job.imageHeight) || 0,
    boxes: parseBoxes(job.boxes),
    assets: parseAssets(job.assets),
    downloadUrl: job.downloadUrl || undefined,
    error: job.error || undefined,
  };

  ApiResponse.ok(res, 'Job fetched', response);
}));

router.get('/jobs/:jobId/download', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await getJob(req.params['jobId'] ?? '');
  if (!job) throw ApiError.notFound('Job not found');
  assertOwner(job.userId, req.user?.id, 'Not your job');
  if (job.status !== 'ready' || !job.downloadUrl) {
    throw ApiError.badRequest(`Export not ready (status: ${job.status})`);
  }
  res.redirect(job.downloadUrl);
}));

export { router as jobRouter };
