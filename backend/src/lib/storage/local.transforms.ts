import sharp from 'sharp';
import {
  analyseBorder,
  BACKGROUND_TOLERANCE,
  classifyBackground,
  hasTransparency,
  type JobBackground,
} from '../background';

export { hasTransparency };

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
 *    than guessing. With `removeEnclosed` it also clears pockets of that colour
 *    the border cannot reach (the hole of a ring, the inside of a letter "O").
 */

/** Above this many pixels a transform is refused instead of exhausting memory (an 8000 x 6000 sheet is 48 MP). */
export const MAX_TRANSFORM_PIXELS = 64_000_000;

/** Pixels between 1x and 3x the tolerance next to removed background fade out instead of leaving a halo. */
const FRINGE_REACH = 3;
/** How many pixels deep the fade reaches into the artwork. */
const FRINGE_RINGS = 2;
/**
 * Enclosed pockets (opt-in, `removeEnclosed`). A pocket is a group of background-coloured pixels the border
 * flood did not reach. It is cleared only when it has a real edge: at least this share of the pixels around it
 * must have a clearly different colour (over FRINGE_REACH x the tolerance) within ENCLOSED_EDGE_RADIUS pixels.
 * A smooth gradient inside the art drifts past the tolerance slowly, so it never has such an edge and stays.
 */
const ENCLOSED_MIN_PIXELS = 4;
const ENCLOSED_EDGE_RADIUS = 3;
const ENCLOSED_MIN_EDGE_SHARE = 0.5;

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

export async function readPixels(input: Buffer): Promise<RawImage> {
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

/** Classifies a stored image with the shared rule (see lib/background.ts). */
export async function classifyImage(input: Buffer): Promise<JobBackground> {
  return classifyBackground(await readPixels(input));
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
 * Marks as removed every pocket of background colour that the border flood did not reach and that has a hard edge.
 * Pockets are 4-connected groups of kept pixels within BACKGROUND_TOLERANCE of the background colour.
 */
function removeEnclosedPockets(data: Buffer, removed: Uint8Array, colour: [number, number, number], width: number, height: number): void {
  const total = width * height;
  const reach = BACKGROUND_TOLERANCE * FRINGE_REACH;
  // 0 = not visited, 1 = in a pocket candidate, 2 = pixel next to the pocket being measured.
  const seen = new Uint8Array(total);
  const members = new Int32Array(total);
  const isBackground = (pixel: number) => channelDistance(data, pixel * 4, colour) <= BACKGROUND_TOLERANCE;

  for (let start = 0; start < total; start++) {
    if (removed[start] || seen[start] || !isBackground(start)) continue;

    let count = 0;
    members[count++] = start;
    seen[start] = 1;
    const ring: number[] = [];
    for (let head = 0; head < count; head++) {
      const pixel = members[head] as number;
      const x = pixel % width;
      const neighbours = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        pixel >= width ? pixel - width : -1,
        pixel < total - width ? pixel + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || removed[next]) continue;
        if (isBackground(next)) {
          if (seen[next] === 1) continue;
          seen[next] = 1;
          members[count++] = next;
        } else if (seen[next] !== 2) {
          seen[next] = 2;
          ring.push(next);
        }
      }
    }

    let accept = count >= ENCLOSED_MIN_PIXELS && ring.length > 0;
    if (accept) {
      let strong = 0;
      for (const pixel of ring) {
        const px = pixel % width;
        const py = (pixel - px) / width;
        let hard = false;
        for (let dy = -ENCLOSED_EDGE_RADIUS; dy <= ENCLOSED_EDGE_RADIUS && !hard; dy++) {
          for (let dx = -ENCLOSED_EDGE_RADIUS; dx <= ENCLOSED_EDGE_RADIUS; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (channelDistance(data, (ny * width + nx) * 4, colour) > reach) {
              hard = true;
              break;
            }
          }
        }
        if (hard) strong++;
      }
      accept = strong / ring.length >= ENCLOSED_MIN_EDGE_SHARE;
    }

    for (const pixel of ring) seen[pixel] = 0;
    if (accept) for (let i = 0; i < count; i++) removed[members[i] as number] = 1;
  }
}

export interface KeyOptions {
  /**
   * Also clear pockets of the background colour that the border cannot reach: the hole of a ring or a key, the
   * inside of a letter. Off by default, because artwork can contain the background colour on purpose (a white
   * eye highlight on a white sheet).
   */
  removeEnclosed?: boolean;
}

/**
 * Make a flat background transparent. Returns `{ kind: 'transparent' }` when the
 * image already is (nothing to do) and throws a `LocalTransformError` when the
 * border is not one flat colour.
 *
 * On a white, black or grey background only the part connected to the image border
 * is removed, so a white shirt on a white sheet keeps its white. On a chroma-key
 * colour (see CHROMA_SPREAD) every pixel of that colour goes. With `options.removeEnclosed`, pockets of the
 * background colour with a hard edge go too, on any background (see `removeEnclosedPockets`). Pixels on the edge of the removed area fade out
 * in proportion to how close they are to the background colour, which avoids a
 * hard halo around anti-aliased artwork.
 */
export async function keyOutFlatBackground(input: Buffer, options: KeyOptions = {}): Promise<KeyResult> {
  const image = await readPixels(input);
  if (hasTransparency(image)) return { kind: 'transparent' };

  // The same rule detection applied (lib/background.ts), so the keyer never contradicts the job's classification.
  const background = classifyBackground(image);
  if (background.kind === 'complex') {
    throw new LocalTransformError(
      'BACKGROUND_NOT_FLAT',
      "Flat-colour removal can only remove a flat, single-colour background, and this image's border isn't one. " +
        'Use a sheet that is already transparent or on a plain background, or use AI background removal (Cloudinary or ImageKit).',
    );
  }
  const colour = analyseBorder(image).colour;

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

  if (background.kind === 'chroma') {
    for (let pixel = 0; pixel < total; pixel++) {
      if (!removed[pixel] && channelDistance(data, pixel * 4, colour) <= BACKGROUND_TOLERANCE) removed[pixel] = 1;
    }
  }

  if (options.removeEnclosed) removeEnclosedPockets(data, removed, colour, width, height);

  dropBackgroundNoise(data, removed, colour, width, height);

  let removedCount = 0;
  for (let pixel = 0; pixel < total; pixel++) {
    if (removed[pixel]) {
      data[pixel * 4 + 3] = 0;
      removedCount++;
    }
  }

  // Fade the anti-aliased fringe: kept pixels touching removed ones and still close to the background colour.
  // Two rings deep, because a blurred or resampled edge is two or three pixels wide.
  const reach = BACKGROUND_TOLERANCE * FRINGE_REACH;
  const reached = Uint8Array.from(removed);
  for (let ring = 0; ring < FRINGE_RINGS; ring++) {
    const next: number[] = [];
    for (let pixel = 0; pixel < total; pixel++) {
      if (reached[pixel]) continue;
      const x = pixel % width;
      const touches =
        (x > 0 && reached[pixel - 1]) ||
        (x < width - 1 && reached[pixel + 1]) ||
        (pixel >= width && reached[pixel - width]) ||
        (pixel < total - width && reached[pixel + width]);
      if (touches) next.push(pixel);
    }
    for (const pixel of next) {
      const distance = channelDistance(data, pixel * 4, colour);
      if (distance >= reach) continue;
      reached[pixel] = 1;
      const coverage = (distance - BACKGROUND_TOLERANCE) / (reach - BACKGROUND_TOLERANCE);
      data[pixel * 4 + 3] = Math.max(0, Math.min(255, Math.round(255 * coverage)));
      // The pixel is a blend of artwork and background. Take the background out of the colour too,
      // or a magenta or white tint shows on the edge over a checkerboard.
      if (coverage > 0.05) {
        for (let c = 0; c < 3; c++) {
          const mixed = (data[pixel * 4 + c] as number) - (1 - coverage) * (colour[c] as number);
          data[pixel * 4 + c] = Math.max(0, Math.min(255, Math.round(mixed / coverage)));
        }
      }
    }
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
