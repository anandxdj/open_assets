import type { Response } from 'express';
import { cropQueue } from '../../common/config/bullmq';
import { getJob, updateJob } from '../jobs/job.store';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import { BACKGROUND_REMOVAL_MODES, parseBackgroundMode } from '../../lib/background';
import type { AuthRequest } from '../auth/auth.middleware';
import type { BoundingBox } from '../jobs/job.types';

export async function startCrop(req: AuthRequest, res: Response): Promise<void> {
  const { jobId, boxes, isRaw, removeEnclosedBackground, backgroundRemoval } = req.body as {
    jobId: string;
    boxes: BoundingBox[];
    isRaw?: boolean;
    /** Also remove background pockets the sheet border cannot reach. Default false. Applies whenever the server keys the background. */
    removeEnclosedBackground?: unknown;
    /** 'auto' (default), 'flat', 'ai' or 'none'. */
    backgroundRemoval?: unknown;
  };

  if (!jobId) throw ApiError.badRequest('jobId required');
  if (!Array.isArray(boxes) || boxes.length === 0) throw ApiError.badRequest('boxes required');
  // Optional, so a request from before this field existed keeps working. When sent it must be a real boolean.
  if (removeEnclosedBackground !== undefined && typeof removeEnclosedBackground !== 'boolean') {
    throw ApiError.badRequest('removeEnclosedBackground must be true or false');
  }
  // Optional too: absent means auto, so old clients and jobs queued before this field existed behave as before.
  const mode = parseBackgroundMode(backgroundRemoval);
  if (mode === null) {
    throw ApiError.badRequest(`backgroundRemoval must be one of ${BACKGROUND_REMOVAL_MODES.join(', ')}`);
  }

  const jobData = await getJob(jobId);
  if (!jobData) throw ApiError.notFound('Job not found');
  assertOwner(jobData.userId, req.user?.id, 'Not your job');
  if (jobData.status !== 'detected') {
    throw ApiError.badRequest(`Job not ready for crop (status: ${jobData.status})`);
  }

  // Persist the user's confirmed (possibly edited) boxes, and the background choice so the job shows it.
  await updateJob(jobId, { boxes: JSON.stringify(boxes), backgroundRemoval: mode ?? 'auto' });

  await cropQueue.add('crop', {
    jobId,
    isRaw,
    ...(removeEnclosedBackground ? { removeEnclosedBackground: true } : {}),
    ...(mode ? { backgroundRemoval: mode } : {}),
  });

  ApiResponse.created(res, 'Crop started', { jobId });
}
