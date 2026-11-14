/**
 * What a sheet's background is, and the rule that decides it.
 *
 * ONE rule for the whole system. py_backend's `classify_background` (detection.py) applies it at detection
 * time and stores the answer on the job; `keyOutFlatBackground` (storage/local.transforms.ts) applies it
 * again when it keys a sheet, so it never disagrees with what the job says. The two implementations are
 * pinned together by the PNG sheets in `__tests__/fixtures/background-cases`, which both test suites read.
 * Change the rule here and in detection.py together.
 *
 *   ring    the outermost RING pixels of the sheet, RING = max(1, min(4, h / 40, w / 40)), rounded down
 *   colour  the per-channel median of the ring (the mean of the two middle values when the count is even),
 *           rounded half up for the #rrggbb form
 *   share   how much of the ring is within FLAT_BORDER_TOLERANCE (largest channel difference) of that colour
 *   kind    transparent  an alpha channel with at least 1% of its pixels below 250
 *           flat         share >= FLAT_BORDER_MIN_SHARE (white, black, grey, a plain colour)
 *           chroma       flat, and the colour's channels differ by CHROMA_SPREAD or more (magenta, green,
 *                        blue screen): artwork does not contain it on purpose, so it goes everywhere
 *           complex      anything else: gradient, texture, photo
 */

export type BackgroundKind = 'transparent' | 'flat' | 'chroma' | 'complex';

/** What detection stores on the job and GET /api/jobs/:id returns. `color` is set for flat and chroma. */
export interface JobBackground {
  kind: BackgroundKind;
  color?: string;
}

/** How the crop treats the sheet's background. Absent means `auto`. */
export type BackgroundRemovalMode = 'auto' | 'flat' | 'ai' | 'none';
export const BACKGROUND_REMOVAL_MODES: readonly BackgroundRemovalMode[] = ['auto', 'flat', 'ai', 'none'];

/** Which method actually ran for the crop: nothing, our own keyer (free), or the provider's AI (paid). */
export type BackgroundMethod = 'none' | 'server' | 'ai';

export interface RgbaImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Largest per-channel difference from the background colour that still counts as background. */
export const BACKGROUND_TOLERANCE = 24;
/** Share of the border ring that must be one colour for the background to count as flat. */
export const FLAT_BORDER_MIN_SHARE = 0.85;
/** A background whose channels differ by at least this much is a chroma key. */
export const CHROMA_SPREAD = 60;

/** The same rule py_backend uses to call an image transparent: an alpha channel with at least 1% non-opaque pixels. */
const TRANSPARENT_ALPHA_BELOW = 250;
const TRANSPARENT_MIN_FRACTION = 0.01;

/** Whether a decoded RGBA image already has a transparent background. */
export function hasTransparency(image: RgbaImage): boolean {
  const total = image.width * image.height;
  let transparent = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    if ((image.data[i] as number) < TRANSPARENT_ALPHA_BELOW) transparent++;
  }
  return total > 0 && transparent / total >= TRANSPARENT_MIN_FRACTION;
}

export interface BorderAnalysis {
  /** The ring's median colour, rounded half up. */
  colour: [number, number, number];
  /** Share (0 to 1) of the ring within BACKGROUND_TOLERANCE of the median colour. */
  share: number;
}

function median(sorted: Uint8Array): number {
  const n = sorted.length;
  return n % 2 === 1 ? (sorted[(n - 1) / 2] as number) : ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
}

/** The ring's median colour and how much of the ring is near it. */
export function analyseBorder(image: RgbaImage): BorderAnalysis {
  const { data, width, height } = image;
  const ring = Math.max(1, Math.min(4, Math.floor(height / 40), Math.floor(width / 40)));

  const pixels: number[] = [];
  for (let y = 0; y < height; y++) {
    const fullRow = y < ring || y >= height - ring;
    if (fullRow) {
      for (let x = 0; x < width; x++) pixels.push(y * width + x);
    } else {
      for (let x = 0; x < ring; x++) pixels.push(y * width + x);
      for (let x = width - ring; x < width; x++) pixels.push(y * width + x);
    }
  }

  const channels = [0, 1, 2].map((c) => {
    const values = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) values[i] = data[(pixels[i] as number) * 4 + c] as number;
    return values;
  });
  const medians = channels.map((values) => median(values.sort()));

  let near = 0;
  for (const pixel of pixels) {
    const o = pixel * 4;
    const distance = Math.max(
      Math.abs((data[o] as number) - (medians[0] as number)),
      Math.abs((data[o + 1] as number) - (medians[1] as number)),
      Math.abs((data[o + 2] as number) - (medians[2] as number)),
    );
    if (distance <= BACKGROUND_TOLERANCE) near++;
  }

  const colour = medians.map((v) => Math.floor(v + 0.5)) as [number, number, number];
  return { colour, share: pixels.length === 0 ? 0 : near / pixels.length };
}

export function toHex(colour: readonly [number, number, number]): string {
  return `#${colour.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The sheet's background by the rule above. */
export function classifyBackground(image: RgbaImage): JobBackground {
  if (hasTransparency(image)) return { kind: 'transparent' };
  const { colour, share } = analyseBorder(image);
  if (share < FLAT_BORDER_MIN_SHARE) return { kind: 'complex' };
  const spread = Math.max(...colour) - Math.min(...colour);
  return { kind: spread >= CHROMA_SPREAD ? 'chroma' : 'flat', color: toHex(colour) };
}

/** Reads a stored `background` field. Anything that is not a valid classification is "not classified" (undefined). */
export function parseBackground(raw: string | undefined | null): JobBackground | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; color?: unknown };
    if (parsed.kind !== 'transparent' && parsed.kind !== 'flat' && parsed.kind !== 'chroma' && parsed.kind !== 'complex') return undefined;
    const color = typeof parsed.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.color) ? parsed.color.toLowerCase() : undefined;
    return color ? { kind: parsed.kind, color } : { kind: parsed.kind };
  } catch {
    return undefined;
  }
}

/** The value stored in the job hash for a classification py_backend returned; empty when it returned none (an older py_backend). */
export function serializeBackground(background: { kind?: string | null; color?: string | null } | null | undefined): string {
  const checked = parseBackground(background ? JSON.stringify({ kind: background.kind, color: background.color ?? undefined }) : undefined);
  return checked ? JSON.stringify(checked) : '';
}

/** A mode from a request: undefined when absent, null when it is not one of the four. */
export function parseBackgroundMode(value: unknown): BackgroundRemovalMode | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' && (BACKGROUND_REMOVAL_MODES as readonly string[]).includes(value) ? (value as BackgroundRemovalMode) : null;
}
