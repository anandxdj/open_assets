// Step 2 of the AniBuddy pipeline: turn a user upload into a transparent,
// isolated, trimmed asset the rig can be fitted to.
//
// The heavy lifting is NOT written here. `removeUploadedBackground` and
// `isolatePrimarySpriteComponent` already solve background removal and speck
// removal for studio uploads, including the awkward cases (editor checkerboard
// backdrops, light interior regions, cropped spillover blobs). This module
// sequences them, trims to the silhouette, and hashes the result.
import {
  isolatePrimarySpriteComponent,
  removeUploadedBackground,
} from "@/features/studio/lib/imageProcessor";
import { measureSubjectBounds } from "@/features/studio/lib/rig/rigCore";
import {
  type PreparedAsset,
  type PrepareOptions,
  DEFAULT_PREPARE_OPTIONS,
  MAX_SOURCE_EDGE,
} from "@/features/anibuddy/types";

/** Alpha at or below this counts as background, matching `measureSubjectBounds`. */
const ALPHA_FLOOR = 24;
/** Breathing room around the silhouette, as a fraction of the trimmed edge. */
const TRIM_MARGIN = 0.02;

export type { PrepareOptions };

/** Thrown when preparation cannot produce a usable asset; message is shown verbatim. */
export class PrepareError extends Error {}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new PrepareError("That image could not be decoded."));
    image.src = dataUrl;
  });
}

function drawToCanvas(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new PrepareError("This browser refused a 2D canvas.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, ctx };
}

/** Cap the longest edge (F9 §6 memory cap). Returns the input when already small. */
async function downscale(dataUrl: string, maxEdge: number): Promise<string> {
  const image = await loadImage(dataUrl);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest <= maxEdge) return dataUrl;

  const scale = maxEdge / longest;
  const { canvas } = drawToCanvas(
    image,
    Math.max(1, Math.round(image.naturalWidth * scale)),
    Math.max(1, Math.round(image.naturalHeight * scale)),
  );
  return canvas.toDataURL("image/png");
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tight bounding box of pixels above the alpha floor, or null if none. */
function alphaBounds(data: Uint8ClampedArray, width: number, height: number): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function sha256(dataUrl: string): Promise<string> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function prepareAsset(
  sourceDataUrl: string,
  requested: Partial<PrepareOptions> = {},
): Promise<PreparedAsset> {
  const options: PrepareOptions = { ...DEFAULT_PREPARE_OPTIONS, ...requested };
  let working = await downscale(sourceDataUrl, MAX_SOURCE_EDGE);

  if (!options.keepBackground) {
    // maxSize matches our own cap so this does not silently re-downscale.
    working = await removeUploadedBackground(working, { maxSize: MAX_SOURCE_EDGE });
  }
  if (!options.keepLooseParts) {
    working = await isolatePrimarySpriteComponent(working, { alphaThreshold: 32 });
  }

  const image = await loadImage(working);
  const { ctx } = drawToCanvas(image, image.naturalWidth, image.naturalHeight);
  const full = ctx.getImageData(0, 0, image.naturalWidth, image.naturalHeight);

  const box = alphaBounds(full.data, full.width, full.height);
  if (!box) {
    throw new PrepareError(
      options.keepBackground
        ? "This image has no transparency to trim against. Turn background removal back on, or upload a transparent PNG."
        : "We could not find a character in this image. Try art with a plainer background, or keep the original background and trim it yourself.",
    );
  }

  const margin = Math.round(Math.max(box.width, box.height) * TRIM_MARGIN);
  const width = Math.min(full.width, box.width + margin * 2);
  const height = Math.min(full.height, box.height + margin * 2);
  const srcX = Math.max(0, box.x - margin);
  const srcY = Math.max(0, box.y - margin);

  const trimmed = document.createElement("canvas");
  trimmed.width = width;
  trimmed.height = height;
  const trimmedCtx = trimmed.getContext("2d", { willReadFrequently: true });
  if (!trimmedCtx) throw new PrepareError("This browser refused a 2D canvas.");
  trimmedCtx.drawImage(image, srcX, srcY, width, height, 0, 0, width, height);

  // Measured on the TRIMMED asset, because every rig coordinate is normalized
  // against these dimensions.
  const trimmedData = trimmedCtx.getImageData(0, 0, width, height);
  const bounds = measureSubjectBounds(trimmedData.data, width, height);
  if (!bounds) {
    throw new PrepareError("The character is too small in frame to rig. Crop closer and retry.");
  }

  const dataUrl = trimmed.toDataURL("image/png");
  return { dataUrl, width, height, bounds, hash: await sha256(dataUrl), options };
}
