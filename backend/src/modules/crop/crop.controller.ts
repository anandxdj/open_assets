import type { Response } from 'express';
import { cropQueue } from '../../common/config/bullmq';
import { getJob, updateJob } from '../jobs/job.store';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import type { AuthRequest } from '../auth/auth.middleware';
import type { BoundingBox } from '../jobs/job.types';

export async function startCrop(req: AuthRequest, res: Response): Promise<void> {
  const { jobId, boxes, isRaw, removeEnclosedBackground } = req.body as {
    jobId: string;
    boxes: BoundingBox[];
    isRaw?: boolean;
    /** Also remove background pockets the sheet border cannot reach. Default false. */
    removeEnclosedBackground?: unknown;
  };

  if (!jobId) throw ApiError.badRequest('jobId required');
  if (!Array.isArray(boxes) || boxes.length === 0) throw ApiError.badRequest('boxes required');
  // Optional, so a request from before this field existed keeps working. When sent it must be a real boolean.
  if (removeEnclosedBackground !== undefined && typeof removeEnclosedBackground !== 'boolean') {
    throw ApiError.badRequest('removeEnclosedBackground must be true or false');
  }

  const jobData = await getJob(jobId);
  if (!jobData) throw ApiError.notFound('Job not found');
  assertOwner(jobData.userId, req.user?.id, 'Not your job');
  if (jobData.status !== 'detected') {
    throw ApiError.badRequest(`Job not ready for crop (status: ${jobData.status})`);
  }

  // Persist the user's confirmed (possibly edited) boxes.
  await updateJob(jobId, { boxes: JSON.stringify(boxes) });

  await cropQueue.add('crop', { jobId, isRaw, ...(removeEnclosedBackground ? { removeEnclosedBackground: true } : {}) });

  ApiResponse.created(res, 'Crop started', { jobId });
}
