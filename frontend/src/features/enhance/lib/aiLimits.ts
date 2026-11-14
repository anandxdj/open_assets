import type { AiEnhanceLimits, AiEnhanceOptions, AiScale } from "@/features/enhance/aiEnhanceApi";

export type Size = { width: number; height: number };

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

export function formatSize(size: Size | null): string {
  return size ? `${size.width.toLocaleString("en-US")} × ${size.height.toLocaleString("en-US")}` : "";
}

export function formatMegapixels(pixels: number): string {
  return `${(pixels / 1_000_000).toFixed(1)} megapixels`;
}

export function outputSize(size: Size, scale: AiScale | null): Size {
  const factor = scale ?? 1;
  return { width: size.width * factor, height: size.height * factor };
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "image";
}

/**
 * Quick check of an image against the limits the server reported, so the
 * problem shows before an upload. The server stays the authority: this mirrors
 * its checks and wording (backend aiEnhance.limits.ts) and only adds speed.
 * Returns the first problem, or null when the image looks fine.
 */
export function checkAiLimits(
  image: { size: Size | null; bytes: number },
  options: AiEnhanceOptions,
  limits: AiEnhanceLimits,
  providerLabel: string
): string | null {
  if (image.bytes > limits.maxBytes) {
    return `This file is ${formatBytes(image.bytes)}. The limit is ${formatBytes(limits.maxBytes)}.`;
  }
  const { size } = image;
  if (!size) return null;

  if (Math.min(size.width, size.height) < limits.minSide) {
    return `This image is ${formatSize(size)}. Each side must be at least ${limits.minSide} px.`;
  }
  if (Math.max(size.width, size.height) > limits.maxSide) {
    return `This image is ${formatSize(size)}. Each side can be at most ${limits.maxSide.toLocaleString("en-US")} px.`;
  }

  const pixels = size.width * size.height;
  if (options.scale !== null) {
    if (pixels > limits.maxUpscaleInputPixels) {
      return `${providerLabel} upscales images under ${formatMegapixels(limits.maxUpscaleInputPixels)}. This one is ${formatSize(size)} (${formatMegapixels(pixels)}). Resize it first, or turn upscale off.`;
    }
    const out = outputSize(size, options.scale);
    if (limits.maxUpscaleOutputPixels !== null && out.width * out.height > limits.maxUpscaleOutputPixels) {
      return `${providerLabel} upscales to at most ${formatMegapixels(limits.maxUpscaleOutputPixels)}. At ${options.scale}× this image would be ${formatSize(out)}. Choose a smaller image or a lower scale.`;
    }
  }

  if (options.removeBackground && limits.maxBackgroundRemovalSide !== null) {
    // Background removal runs last, so it sees the upscaled image.
    const atRemoval = outputSize(size, options.scale);
    if (Math.max(atRemoval.width, atRemoval.height) > limits.maxBackgroundRemovalSide) {
      const cap = limits.maxBackgroundRemovalSide.toLocaleString("en-US");
      return options.scale === null
        ? `${providerLabel} removes backgrounds up to ${cap} px per side. This image is ${formatSize(size)}.`
        : `${providerLabel} removes backgrounds up to ${cap} px per side. At ${options.scale}× this image would be ${formatSize(atRemoval)}. Choose a smaller image or a lower scale, or turn off Remove background.`;
    }
  }
  return null;
}
