import sharp from 'sharp';

/**
 * The image transforms the local storage provider can do on this machine. They
 * are plain image processing, not the AI add-ons the cloud providers sell:
 *
 *  - `resizeImage`: a Lanczos resize. Used where the extract pipeline asks for
 *    an "upscale" (export at 2x or 4x). Sharper than nearest-neighbour, but it
 *    cannot invent detail the way an AI upscaler does.
 *  - `keyOutFlatBackground`: makes a single flat background colour transparent
 *    by flood-filling in from the image border. It works for sprite sheets drawn
 *    on a white, black or coloured background, and refuses anything else rather
 *    than guessing.
 */

/** Above this many pixels a transform is refused instead of exhausting memory (an 8000 x 6000 sheet is 48 MP). */
export const MAX_TRANSFORM_PIXELS = 64_000_000;

/** The same rule py_backend uses to call an image transparent: an alpha channel with at least 1% non-opaque pixels. */
const TRANSPARENT_ALPHA_BELOW = 250;
const TRANSPARENT_MIN_FRACTION = 0.01;

/** Largest per-channel difference from the background colour that still counts as background. */
const BACKGROUND_TOLERANCE = 24;
/** Pixels between 1x and 3x the tolerance next to removed background fade out instead of leaving a halo. */
const FRINGE_REACH = 3;
/** Share of the border that must be one colour for the background to count as flat. */
const MIN_FLAT_BORDER_FRACTION = 0.85;

/** The image is a transform the local provider cannot do for this input. The message tells the user what to change. */
export class LocalTransformError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LocalTransformError';
    this.code = code;
  }
}

/** Thrown by transforms that need the cloud providers' AI add-ons. */
export class StorageTransformUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageTransformUnsupportedError';
  }
}

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

async function readPixels(input: Buffer): Promise<RawImage> {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const pixels = (meta.width ?? 0) * (meta.height ?? 0);
  if (pixels > MAX_TRANSFORM_PIXELS) {
    throw new LocalTransformError(
      'IMAGE_TOO_LARGE',
      `This image is ${meta.width} x ${meta.height} (${(pixels / 1e6).toFixed(0)} megapixels). Local storage transforms images up to ${MAX_TRANSFORM_PIXELS / 1e6} megapixels.`,
    );
  }
  const { data, info } = await sharp(input, { failOn: 'none' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Whether a decoded RGBA image already has a transparent background. */
export function hasTransparency(image: RawImage): boolean {
  const total = image.width * image.height;
  let transparent = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    if ((image.data[i] as number) < TRANSPARENT_ALPHA_BELOW) transparent++;
  }
  return transparent / total >= TRANSPARENT_MIN_FRACTION;
}

export type KeyResult =
  | { kind: 'transparent' }
  | { kind: 'keyed'; png: Buffer; background: [number, number, number]; removedFraction: number };

function channelDistance(data: Buffer, offset: number, bg: [number, number, number]): number {
  return Math.max(
    Math.abs((data[offset] as number) - bg[0]),
    Math.abs((data[offset + 1] as number) - bg[1]),
    Math.abs((data[offset + 2] as number) - bg[2]),
  );
}

/** The most common border colour (coarsely binned, then averaged), and how much of the border is near it. */
function borderBackground(image: RawImage): { colour: [number, number, number]; fraction: number } {
  const { data, width, height } = image;
  const border: number[] = [];
  for (let x = 0; x < width; x++) {
    border.push(x, (height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    border.push(y * width, y * width + width - 1);
  }

  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const pixel of border) {
    const o = pixel * 4;
    const r = data[o] as number;
    const g = data[o + 1] as number;
    const b = data[o + 2] as number;
    const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = bins.get(bin);
    if (entry) {
      entry.count++;
      entry.r += r;
      entry.g += g;
      entry.b += b;
    } else {
      bins.set(bin, { count: 1, r, g, b });
    }
  }
  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const entry of bins.values()) if (entry.count > best.count) best = entry;
  const colour: [number, number, number] = [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
  ];
  let near = 0;
  for (const pixel of border) if (channelDistance(data, pixel * 4, colour) <= BACKGROUND_TOLERANCE) near++;
  return { colour, fraction: near / border.length };
}

/**
 * Kept pixels that are left in the background by uneven colour (JPEG-like noise a little
 * past the tolerance) would show as faint specks. Such a pixel belongs to a small cluster
 * of kept pixels that are all within fringe reach of the background colour and not attached
 * to anything clearly different: noise, not artwork. A real anti-aliased edge is always
 * connected to solid artwork, so it never matches. Clusters this small or smaller are
 * dropped (marked removed).
 */
const NOISE_CLUSTER_MAX_PIXELS = 64;

function dropBackgroundNoise(data: Buffer, removed: Uint8Array, colour: [number, number, number], width: number, height: number): void {
  const total = width * height;
  const reach = BACKGROUND_TOLERANCE * FRINGE_REACH;
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const cluster = new Int32Array(NOISE_CLUSTER_MAX_PIXELS);
  for (let start = 0; start < total; start++) {
    if (removed[start] || seen[start]) continue;
    seen[start] = 1;
    let top = 0;
    stack[top++] = start;
    let size = 0;
    let solid = false;
    while (top > 0) {
      const pixel = stack[--top] as number;
      if (size < NOISE_CLUSTER_MAX_PIXELS) cluster[size] = pixel;
      size++;
      if (!solid && channelDistance(data, pixel * 4, colour) > reach) solid = true;
      const x = pixel % width;
      const y = (pixel - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (removed[next] || seen[next]) continue;
          seen[next] = 1;
          stack[top++] = next;
        }
      }
    }
    if (!solid && size <= NOISE_CLUSTER_MAX_PIXELS) {
      for (let i = 0; i < size; i++) removed[cluster[i] as number] = 1;
    }
  }
}

/**
 * Make a flat background transparent. Returns `{ kind: 'transparent' }` when the
 * image already is (nothing to do) and throws a `LocalTransformError` when the
 * border is not one flat colour.
 *
 * Only background connected to the image border is removed, so a white shirt on
 * a white sheet keeps its white. Pixels on the edge of the removed area fade out
 * in proportion to how close they are to the background colour, which avoids a
 * hard halo around anti-aliased artwork.
 */
export async function keyOutFlatBackground(input: Buffer): Promise<KeyResult> {
  const image = await readPixels(input);
  if (hasTransparency(image)) return { kind: 'transparent' };

  const { colour, fraction } = borderBackground(image);
  if (fraction < MIN_FLAT_BORDER_FRACTION) {
    throw new LocalTransformError(
      'BACKGROUND_NOT_FLAT',
      "Local storage can only remove a flat, single-colour background, and this image's border isn't one. " +
        'Use a sheet that is already transparent or on a plain background, or configure Cloudinary or ImageKit for AI background removal.',
    );
  }

  const { data, width, height } = image;
  const total = width * height;
  const removed = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;

  const seed = (pixel: number) => {
    if (removed[pixel] || channelDistance(data, pixel * 4, colour) > BACKGROUND_TOLERANCE) return;
    removed[pixel] = 1;
    stack[top++] = pixel;
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (top > 0) {
    const pixel = stack[--top] as number;
    const x = pixel % width;
    if (x > 0) seed(pixel - 1);
    if (x < width - 1) seed(pixel + 1);
    if (pixel >= width) seed(pixel - width);
    if (pixel < total - width) seed(pixel + width);
  }

  dropBackgroundNoise(data, removed, colour, width, height);

  let removedCount = 0;
  for (let pixel = 0; pixel < total; pixel++) {
    if (removed[pixel]) {
      data[pixel * 4 + 3] = 0;
      removedCount++;
    }
  }

  // Fade the anti-aliased fringe: kept pixels touching removed ones and still close to the background colour.
  const reach = BACKGROUND_TOLERANCE * FRINGE_REACH;
  const fringe: number[] = [];
  for (let pixel = 0; pixel < total; pixel++) {
    if (removed[pixel]) continue;
    const x = pixel % width;
    const touches =
      (x > 0 && removed[pixel - 1]) ||
      (x < width - 1 && removed[pixel + 1]) ||
      (pixel >= width && removed[pixel - width]) ||
      (pixel < total - width && removed[pixel + width]);
    if (touches) fringe.push(pixel);
  }
  for (const pixel of fringe) {
    const distance = channelDistance(data, pixel * 4, colour);
    if (distance >= reach) continue;
    const alpha = Math.round((255 * (distance - BACKGROUND_TOLERANCE)) / (reach - BACKGROUND_TOLERANCE));
    data[pixel * 4 + 3] = Math.max(0, Math.min(255, alpha));
  }

  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { kind: 'keyed', png, background: colour, removedFraction: removedCount / total };
}

/**
 * Resize to `targetWidth` (height follows), keeping the alpha channel. Lanczos,
 * so edges stay crisp. Refuses outputs bigger than `MAX_TRANSFORM_PIXELS`.
 */
export async function resizeImage(input: Buffer, targetWidth: number): Promise<{ png: Buffer; width: number; height: number }> {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new LocalTransformError('NOT_AN_IMAGE', 'The stored file is not an image the local provider can read.');
  const outWidth = Math.max(1, Math.round(targetWidth));
  const outHeight = Math.max(1, Math.round((height * outWidth) / width));
  if (outWidth * outHeight > MAX_TRANSFORM_PIXELS) {
    throw new LocalTransformError(
      'IMAGE_TOO_LARGE',
      `The result would be ${outWidth} x ${outHeight}. Local storage resizes up to ${MAX_TRANSFORM_PIXELS / 1e6} megapixels.`,
    );
  }
  const png = await sharp(input, { failOn: 'none' })
    .resize({ width: outWidth, height: outHeight, kernel: 'lanczos3', fit: 'fill' })
    .png()
    .toBuffer();
  return { png, width: outWidth, height: outHeight };
}
