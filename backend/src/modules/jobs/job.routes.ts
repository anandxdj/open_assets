import { Router } from 'express';
import type { Response } from 'express';
import { authenticate } from '../auth/auth.middleware';
import type { AuthRequest } from '../auth/auth.middleware';
import { getJob, parseBoxes, parseAssets, updateJob } from './job.store';
import { detectAssets, type DetectionOptions } from '../../lib/py.client';
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
    detectionMode: job.detectionMode || undefined,
    detectionConfidence: job.detectionConfidence ? Number(job.detectionConfidence) : undefined,
    detectionWarning: job.detectionWarning || undefined,
    boxes: parseBoxes(job.boxes),
    assets: parseAssets(job.assets),
    downloadUrl: job.downloadUrl || undefined,
    error: job.error || undefined,
  };

  ApiResponse.ok(res, 'Job fetched', response);
}));

router.post('/jobs/:jobId/redetect', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await getJob(req.params['jobId'] ?? '');
  if (!job) throw ApiError.notFound('Job not found');
  assertOwner(job.userId, req.user?.id, 'Not your job');
  if (job.status !== 'detected') {
    throw ApiError.badRequest(`Cannot re-detect a job with status: ${job.status}`);
  }

  const body = (req.body ?? {}) as { mode?: DetectionOptions['mode']; backgroundColor?: string };
  if (body.mode && !['auto', 'light', 'dark', 'sampled'].includes(body.mode)) {
    throw ApiError.badRequest('Invalid detection mode');
  }
  if (body.backgroundColor && !/^#[0-9a-fA-F]{6}$/.test(body.backgroundColor)) {
    throw ApiError.badRequest('backgroundColor must be a #RRGGBB value');
  }

  const result = await detectAssets(job.cloudinaryUrl, {
    mode: body.mode ?? 'auto',
    backgroundColor: body.backgroundColor,
  });
  const boxes = result.boxes.map((box) => ({
    id: box.id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    label: box.name,
  }));

  await updateJob(job.id, {
    boxes: JSON.stringify(boxes),
    imageWidth: String(result.image_width),
    imageHeight: String(result.image_height),
    detectionMode: result.detection_mode,
    detectionConfidence: String(result.detection_confidence),
    detectionWarning: result.detection_warning ?? '',
  });

  ApiResponse.ok(res, 'Assets re-detected', {
    boxes,
    detectionMode: result.detection_mode,
    detectionConfidence: result.detection_confidence,
    detectionWarning: result.detection_warning ?? undefined,
  });
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
