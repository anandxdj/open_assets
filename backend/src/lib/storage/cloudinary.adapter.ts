import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import type { StorageAdapter, UploadOptions, UploadResult, ResourceType, EnhanceTransform } from './interface';
import type { UpscaleScale } from '../../modules/plans/upscale';

const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
// Cloudinary returns these while an AI add-on is still processing.
const PROCESSING_STATUSES = new Set([202, 420, 423, 425]);

const FOLDER: Record<string, string> = {
  originals: 'open_assets/originals',
  collections: 'open_assets/collections',
  exports: 'open_assets/exports',
  enhance: 'open_assets/enhance',
};

export class CloudinaryAdapter implements StorageAdapter {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: FOLDER[options.folder],
            resource_type: options.resourceType ?? 'image',
            public_id: options.publicId,
          },
          (err, result) => {
            if (err || !result) return reject(err ?? new Error('Cloudinary upload failed'));
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              format: result.format,
              width: result.width,
              height: result.height,
              bytes: result.bytes,
            });
          },
        )
        .end(buffer);
    });
  }

  async delete(publicId: string, resourceType: ResourceType = 'image'): Promise<void> {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  }

  async applyBackgroundRemoval(publicId: string): Promise<string> {
    const url = cloudinary.url(publicId, {
      resource_type: 'image',
      effect: 'background_removal',
      fetch_format: 'png',
      secure: true,
    });
    await this.pollUntilReady(url);
    return url;
  }

  async applyUpscale(publicId: string, scale: UpscaleScale = 2, sourceWidth?: number): Promise<string> {
    // e_upscale flattens alpha → chain e_background_removal to re-cut transparency.
    // e_upscale is a fixed 4x: 2x resizes the 4x result back down (needs the source width).
    const transformation: Record<string, unknown>[] = [{ effect: 'upscale' }];
    if (scale === 2 && sourceWidth) transformation.push({ width: sourceWidth * 2, crop: 'scale' });
    transformation.push({ effect: 'background_removal' });
    const url = cloudinary.url(publicId, {
      resource_type: 'image',
      transformation,
      fetch_format: 'png',
      secure: true,
    });
    await this.pollUntilReady(url);
    return url;
  }

  async applyEnhance(publicId: string, transform: EnhanceTransform): Promise<string> {
    const { upscale, removeBackground } = transform;
    if (!upscale && !removeBackground) {
      throw new Error('applyEnhance needs an upscale, a background removal, or both.');
    }
    // Order matters: e_upscale flattens alpha, so e_background_removal must come
    // after it. e_upscale is a fixed 4x; 2x resizes the 4x result back down.
    const transformation: Record<string, unknown>[] = [];
    if (upscale) {
      transformation.push({ effect: 'upscale' });
      if (upscale.scale === 2) transformation.push({ width: upscale.sourceWidth * 2, crop: 'scale' });
    }
    if (removeBackground) transformation.push({ effect: 'background_removal' });

    const url = cloudinary.url(publicId, {
      resource_type: 'image',
      transformation,
      fetch_format: 'png',
      secure: true,
    });
    await this.pollUntilReady(url);
    return url;
  }

  private async pollUntilReady(url: string, timeoutMs = POLL_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let status: number;
      try {
        const res = await axios.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          validateStatus: () => true,
          timeout: 15_000,
        });
        status = res.status;
      } catch (networkErr: unknown) {
        if (Date.now() >= deadline) {
          throw new Error(`Cloudinary transform timed out (network): ${String(networkErr)} — URL: ${url}`);
        }
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (status === 200) return;

      if (PROCESSING_STATUSES.has(status)) {
        if (Date.now() >= deadline) {
          throw new Error(
            `Cloudinary transform timed out after ${timeoutMs / 1000}s (HTTP ${status}). ` +
              `Check that the AI add-on is enabled. URL: ${url}`,
          );
        }
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      throw new Error(
        `Cloudinary transform failed (HTTP ${status}). ` +
          `Ensure the AI add-on (background_removal / upscale) is enabled. URL: ${url}`,
      );
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
