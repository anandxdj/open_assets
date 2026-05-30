import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { cloudinary } from '../../common/config/cloudinary';
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

  const uploadResult = await new Promise<{
    secure_url: string;
    public_id: string;
    format?: string;
    width?: number;
    height?: number;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'open_assets/originals',
        resource_type: 'image',
        public_id: jobId,
      },
      (err, result) => {
        if (err ?? !result) return reject(err ?? new Error('Cloudinary upload failed'));
        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
        });
      },
    );
    stream.end(req.file!.buffer);
  });

  const { format, width, height, public_id } = uploadResult;
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
    await cloudinary.uploader.destroy(public_id).catch(() => undefined);
    throw ApiError.badRequest(
      `Invalid image (format=${format ?? 'unknown'}, size=${width ?? 0}x${height ?? 0}). ` +
        `Allowed formats: ${ALLOWED_FORMATS.join(', ')}. Min ${MIN_DIMENSION}px, max ${MAX_DIMENSION}px per side.`,
    );
  }

  await createJob(jobId, {
    cloudinaryUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    userId,
  });

  await updateJob(jobId, {
    imageWidth: String(width),
    imageHeight: String(height),
  });

  await detectionQueue.add('detect', {
    jobId,
    cloudinaryUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
  });

  await updateJob(jobId, { status: 'queued' });

  ApiResponse.created(res, 'Upload successful', {
    jobId,
    cloudinaryUrl: uploadResult.secure_url,
    status: 'queued',
  });
}
