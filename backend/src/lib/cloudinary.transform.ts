import axios from 'axios';
import { cloudinary } from '../common/config/cloudinary';

const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

// Cloudinary returns these status codes while an AI add-on is still processing.
const PROCESSING_STATUSES = new Set([202, 420, 423, 425]);

/**
 * Poll a Cloudinary derived URL until it returns 200 (ready) or we time out.
 * Non-transient errors (e.g. 404, 403, 500) are thrown immediately rather than retried —
 * this surfaces add-on misconfiguration or invalid publicIds promptly.
 */
export async function pollUntilReady(url: string, timeoutMs = POLL_TIMEOUT_MS): Promise<void> {
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
    } catch (networkErr: any) {
      // Transient network error — retry until deadline.
      if (Date.now() >= deadline) {
        throw new Error(`Cloudinary transform timed out (network): ${networkErr.message} — URL: ${url}`);
      }
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    if (status === 200) return;

    if (PROCESSING_STATUSES.has(status)) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Cloudinary transform timed out after ${timeoutMs / 1000}s (HTTP ${status}). ` +
          `Check that the AI Background Removal / Upscale add-on is enabled on your account. URL: ${url}`,
        );
      }
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    // Non-transient failure — throw immediately with clear diagnosis.
    throw new Error(
      `Cloudinary transform failed (HTTP ${status}). ` +
      `Ensure the AI add-on (background_removal / upscale) is enabled. URL: ${url}`,
    );
  }
}

/** Background removal → transparent PNG derived URL. Blocks until Cloudinary is done. */
export async function applyBackgroundRemoval(publicId: string): Promise<string> {
  const url = cloudinary.url(publicId, {
    resource_type: 'image',
    effect: 'background_removal',
    fetch_format: 'png',
    secure: true,
  });
  await pollUntilReady(url);
  return url;
}

/**
 * Build Cloudinary upscale derived URL (no poll — caller polls via pollUntilReady).
 *
 * e_upscale flattens the alpha channel — its output is opaque RGB — so we chain
 * e_background_removal after it to re-cut the transparent background on the
 * upscaled sprite. Without this, upscaled crops download with a solid background.
 * Both are async add-ons; pollUntilReady handles the 202/processing statuses.
 */
export function buildUpscaleUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    resource_type: 'image',
    transformation: [
      { effect: 'upscale' },
      { effect: 'background_removal' },
    ],
    fetch_format: 'png',
    secure: true,
  });
}
