import { Router } from 'express';
import type { Response } from 'express';
import { authenticate } from '../auth/auth.middleware';
import type { AuthRequest } from '../auth/auth.middleware';
import { clearUserJobs, getJob, listUserJobs, parseBoxes, parseAssets, removeUserJob, updateJob } from './job.store';
import { parseListQuery } from './job.list';
import { detectAssets, type DetectionOptions } from '../../lib/py.client';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { assertOwner } from '../../common/utils/authz';
import type { JobListPage, JobResponse } from './job.types';

const router = Router();

/**
 * The signed-in user's jobs, newest first, one page at a time. Only jobs made
 * by the upload flow are listed, and a job drops out when it expires.
 *   ?limit=1..100 (default 50)   ?cursor=<nextCursor of the previous page>
 */
router.get('/jobs', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized('Not authenticated');
  const query = parseListQuery(req.query);

  const { jobs, nextCursor } = await listUserJobs(userId, query);
  const page: JobListPage = {
    jobs: jobs.map((job) => ({
      jobId: job.id,
      status: job.status,
      fileName: job.fileName || undefined,
      assetCount: Number(job.assetCount) || Number(job.boxCount) || 0,
      createdAt: job.createdAt,
      imageUrl: job.cloudinaryUrl,
      error: job.error || undefined,
    })),
    nextCursor,
  };

  ApiResponse.ok(res, 'Jobs fetched', page);
}));

// Clears the requester's whole list. Like the single-job removal below, it only
// touches the list: the jobs stay until they expire.
router.delete('/jobs/history', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized('Not authenticated');
  const removed = await clearUserJobs(userId);
  ApiResponse.ok(res, 'History cleared', { removed });
}));

router.get('/jobs/:jobId', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await getJob(req.params['jobId'] ?? '');
  if (!job) throw ApiError.notFound('Job not found');
  assertOwner(job.userId, req.user?.id, 'Not your job');

  const response: JobResponse = {
    jobId: job.id,
    status: job.status,
    fileName: job.fileName || undefined,
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

// Removes one job from the requester's list. Idempotent. Only the requester's
// own index is touched, so no ownership lookup is needed and another user's job
// id can neither be removed nor probed; the job stays until it expires.
router.delete('/jobs/:jobId/history', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized('Not authenticated');
  const removed = await removeUserJob(userId, req.params['jobId'] ?? '');
  ApiResponse.ok(res, 'Job removed from history', { removed: removed ? 1 : 0 });
}));

export { router as jobRouter };
