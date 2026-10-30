import { z } from 'zod';
import { ApiError } from '../../common/utils/ApiError';
import { resolveProviderName, type StorageProviderName } from '../../lib/storage/status';
import type { AiEnhanceOptions, AiEnhanceScale, Dimensions } from './enhance.types';
import type { ImageProbe } from './imageProbe';

const MB = 1024 * 1024;

/**
 * Per-provider input limits for AI enhance. Everything marked "documented" comes
 * from the provider's transformation reference; `minSide` and `maxSide` are our
 * own sanity bounds.
 */
export interface AiEnhanceLimits {
  provider: StorageProviderName;
  /** Our own floor: smaller than this is not worth sending to a provider. */
  minSide: number;
  /** Our own ceiling for any operation (matches the extract pipeline's 12,000 px). */
  maxSide: number;
  maxBytes: number;
  /** Highest pixel count the provider accepts as upscale input. */
  maxUpscaleInputPixels: number;
  /** Highest pixel count the provider is documented to return from an upscale. */
  maxUpscaleOutputPixels: number | null;
  /**
   * Longest side background removal accepts. Larger inputs are silently scaled
   * down, so the result would not be the size that was asked for.
   */
  maxBackgroundRemovalSide: number | null;
}

const LIMITS: Record<StorageProviderName, AiEnhanceLimits> = {
  cloudinary: {
    provider: 'cloudinary',
    minSide: 16,
    maxSide: 12_000,
    // Free Cloudinary plans cap image uploads at 10 MB.
    maxBytes: 10 * MB,
    // Documented: e_upscale input "must be smaller than 4.2 megapixels (the
    // equivalent of 2048 x 2048 pixels)", output is 4x per side.
    maxUpscaleInputPixels: 2048 * 2048,
    maxUpscaleOutputPixels: null,
    // Documented: background removal "imposes a limit of 6144 x 6144 pixels".
    maxBackgroundRemovalSide: 6144,
  },
  imagekit: {
    provider: 'imagekit',
    minSide: 16,
    maxSide: 12_000,
    maxBytes: 20 * MB,
    // Documented: e-upscale input "must be less than 16 MP"; output is 16 MP.
    maxUpscaleInputPixels: 15_999_999,
    maxUpscaleOutputPixels: 16_000_000,
    maxBackgroundRemovalSide: null,
  },
  // AI enhance is not offered on local storage (supportsAi is false), so nothing is validated against
  // these; they only keep the record complete and match the pipeline's own bounds.
  local: {
    provider: 'local',
    minSide: 16,
    maxSide: 12_000,
    maxBytes: 20 * MB,
    maxUpscaleInputPixels: 16_000_000,
    maxUpscaleOutputPixels: 64_000_000,
    maxBackgroundRemovalSide: null,
  },
};

const PROVIDER_LABEL: Record<StorageProviderName, string> = {
  cloudinary: 'Cloudinary',
  imagekit: 'ImageKit',
  local: 'Local storage',
};

export function getAiEnhanceLimits(provider: StorageProviderName = resolveProviderName()): AiEnhanceLimits {
  return LIMITS[provider];
}

export function providerLabel(provider: StorageProviderName): string {
  return PROVIDER_LABEL[provider];
}

// ── Request options ─────────────────────────────────────────────────────────

/**
 * Multipart text fields arrive as strings. `scale` is "2" or "4" (omit it, or
 * send "1", to keep the resolution) and `removeBackground` is "true" or "false".
 *
 * 4x is a Pro entitlement (`maxUpscale`). The schema only checks the shape; the
 * plan gate is in the submit handler, which knows the user.
 */
export const aiEnhanceOptionsSchema = z
  .object({
    scale: z.enum(['1', '2', '4'], { message: 'scale must be 2 or 4.' }).optional(),
    removeBackground: z
      .enum(['true', 'false'], { message: 'removeBackground must be true or false.' })
      .optional(),
  })
  .transform(
    (raw): AiEnhanceOptions => ({
      scale: raw.scale === '2' ? 2 : raw.scale === '4' ? 4 : null,
      removeBackground: raw.removeBackground === 'true',
    }),
  )
  .refine((options) => options.scale !== null || options.removeBackground, {
    message: 'Choose an upscale, remove the background, or both.',
  });

export function parseAiEnhanceOptions(body: unknown): AiEnhanceOptions {
  const result = aiEnhanceOptionsSchema.safeParse(body ?? {});
  if (!result.success) {
    throw ApiError.badRequest(result.error.issues[0]?.message ?? 'Invalid enhance options.');
  }
  return result.data;
}

// ── Sizes ───────────────────────────────────────────────────────────────────

export function outputSize(source: Dimensions, scale: AiEnhanceScale | null): Dimensions {
  const factor = scale ?? 1;
  return { width: source.width * factor, height: source.height * factor };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

function formatMegapixels(pixels: number): string {
  return `${(pixels / 1_000_000).toFixed(1)} megapixels`;
}

function formatSize(size: Dimensions): string {
  return `${size.width.toLocaleString('en-US')} × ${size.height.toLocaleString('en-US')}`;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Check a probed image against the provider's limits for the requested
 * operations. Throws a 400/413 `ApiError` whose message says what to change.
 */
export function validateAiEnhance(
  image: Pick<ImageProbe, 'width' | 'height' | 'animated'> & { bytes: number },
  options: AiEnhanceOptions,
  limits: AiEnhanceLimits,
): void {
  const label = PROVIDER_LABEL[limits.provider];

  if (options.scale === null && !options.removeBackground) {
    throw ApiError.badRequest('Choose an upscale, remove the background, or both.');
  }
  if (image.animated) {
    throw ApiError.badRequest("Animated images can't be enhanced. Use a still PNG, JPEG or WebP.");
  }
  if (image.bytes > limits.maxBytes) {
    throw ApiError.payloadTooLarge(
      `This file is ${formatBytes(image.bytes)}. The limit is ${formatBytes(limits.maxBytes)}.`,
    );
  }

  const size = { width: image.width, height: image.height };
  if (Math.min(size.width, size.height) < limits.minSide) {
    throw ApiError.badRequest(
      `This image is ${formatSize(size)}. Each side must be at least ${limits.minSide} px.`,
    );
  }
  if (Math.max(size.width, size.height) > limits.maxSide) {
    throw ApiError.badRequest(
      `This image is ${formatSize(size)}. Each side can be at most ${limits.maxSide.toLocaleString('en-US')} px.`,
    );
  }

  const pixels = size.width * size.height;
  if (options.scale !== null) {
    if (pixels > limits.maxUpscaleInputPixels) {
      throw ApiError.badRequest(
        `${label} upscales images under ${formatMegapixels(limits.maxUpscaleInputPixels)}. ` +
          `This one is ${formatSize(size)} (${formatMegapixels(pixels)}). Resize it first, or turn upscale off.`,
      );
    }
    const out = outputSize(size, options.scale);
    if (limits.maxUpscaleOutputPixels !== null && out.width * out.height > limits.maxUpscaleOutputPixels) {
      throw ApiError.badRequest(
        `${label} upscales to at most ${formatMegapixels(limits.maxUpscaleOutputPixels)}. ` +
          `At ${options.scale}× this image would be ${formatSize(out)}. Choose a smaller image or a lower scale.`,
      );
    }
  }

  if (options.removeBackground && limits.maxBackgroundRemovalSide !== null) {
    // Background removal runs last, so it sees the upscaled image.
    const atRemoval = outputSize(size, options.scale);
    if (Math.max(atRemoval.width, atRemoval.height) > limits.maxBackgroundRemovalSide) {
      const cap = limits.maxBackgroundRemovalSide.toLocaleString('en-US');
      throw ApiError.badRequest(
        options.scale === null
          ? `${label} removes backgrounds up to ${cap} px per side. This image is ${formatSize(size)}.`
          : `${label} removes backgrounds up to ${cap} px per side. At ${options.scale}× this image would be ` +
              `${formatSize(atRemoval)}. Choose a smaller image or a lower scale, or turn off Remove background.`,
      );
    }
  }
}
