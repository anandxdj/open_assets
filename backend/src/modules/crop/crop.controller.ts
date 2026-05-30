import type { Response } from 'express';
import { cropQueue } from '../../common/config/bullmq';
import { getJob, updateJob } from '../jobs/job.store';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import type { AuthRequest } from '../auth/auth.middleware';
import type { BoundingBox } from '../jobs/job.types';

export async function startCrop(req: AuthRequest, res: Response): Promise<void> {
  const { jobId, boxes, isRaw } = req.body as { jobId: string; boxes: BoundingBox[]; isRaw?: boolean };

  if (!jobId) throw ApiError.badRequest('jobId required');
  if (!Array.isArray(boxes) || boxes.length === 0) throw ApiError.badRequest('boxes required');

  const jobData = await getJob(jobId);
  if (!jobData) throw ApiError.notFound('Job not found');
  assertOwner(jobData.userId, req.user?.id, 'Not your job');
  if (jobData.status !== 'detected') {
    throw ApiError.badRequest(`Job not ready for crop (status: ${jobData.status})`);
  }

  // Persist the user's confirmed (possibly edited) boxes.
  await updateJob(jobId, { boxes: JSON.stringify(boxes) });

  await cropQueue.add('crop', { jobId, isRaw });

  ApiResponse.created(res, 'Crop started', { jobId });
}
