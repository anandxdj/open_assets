import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../../lib/storage';
import { detectionQueue } from '../../common/config/bullmq';
import { createJob, updateJob } from '../jobs/job.store';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { AuthRequest } from '../auth/auth.middleware';

const ALLOWED_FORMATS = ['png', 'jpg', 'jpeg', 'webp'];
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 12000;

export async function uploadImage(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthRequest;

  if (!req.file) {
    throw ApiError.badRequest('No image file provided');
  }

  const jobId = uuidv4();
  const userId = authReq.user?.id ?? 'anonymous';

  const uploadResult = await storage.upload(req.file.buffer, {
    folder: 'originals',
    publicId: jobId,
    resourceType: 'image',
  });

  const { format, width, height, publicId } = uploadResult;
  const invalid =
    !format ||
    !ALLOWED_FORMATS.includes(format.toLowerCase()) ||
    !width ||
    !height ||
    width < MIN_DIMENSION ||
    height < MIN_DIMENSION ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION;

  if (invalid) {
    await storage.delete(publicId).catch(() => undefined);
    throw ApiError.badRequest(
      `Invalid image (format=${format ?? 'unknown'}, size=${width ?? 0}x${height ?? 0}). ` +
        `Allowed formats: ${ALLOWED_FORMATS.join(', ')}. Min ${MIN_DIMENSION}px, max ${MAX_DIMENSION}px per side.`,
    );
  }

  await createJob(jobId, {
    cloudinaryUrl: uploadResult.url,
    publicId: uploadResult.publicId,
    userId,
  });

  await updateJob(jobId, {
    imageWidth: String(width),
    imageHeight: String(height),
  });

  await detectionQueue.add('detect', {
    jobId,
    cloudinaryUrl: uploadResult.url,
    publicId: uploadResult.publicId,
  });

  await updateJob(jobId, { status: 'queued' });

  ApiResponse.created(res, 'Upload successful', {
    jobId,
    cloudinaryUrl: uploadResult.url,
    status: 'queued',
  });
}
