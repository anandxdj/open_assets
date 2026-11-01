// Backdrop for transparent art: which checkerboard (or grey) to draw behind it.
// Pure rules only, so node --test can cover them. The browser side (loading an
// image and reading its pixels) lives in ../useBackdrop.ts.

export type Backdrop = "light" | "dark" | "grey";
export type BackdropMode = "auto" | Backdrop;
export type ThemeName = "light" | "dark";

export const BACKDROP_MODES: BackdropMode[] = ["auto", "light", "dark", "grey"];

/** The two tones of each backdrop, as pixels drawn behind the art (not interface colours). */
export const BACKDROP_PALETTE: Record<Backdrop, { a: string; b: string }> = {
  light: { a: "#FFFFFF", b: "#E6E3DA" },
  dark: { a: "#1A1A1A", b: "#121212" },
  grey: { a: "#808080", b: "#808080" },
};

export const BACKDROP_LABEL: Record<BackdropMode, string> = {
  auto: "Auto",
  light: "Light checker",
  dark: "Dark checker",
  grey: "Mid grey",
};

export function isBackdropMode(value: unknown): value is BackdropMode {
  return typeof value === "string" && (BACKDROP_MODES as string[]).includes(value);
}

const BINS = 32;
/** An art pixel counts as lost when its contrast against the backdrop is below this (WCAG non-text contrast). */
export const LOST_CONTRAST = 3;
/**
 * A backdrop has to score this much better (scores run 0 to 1) than the one it would replace.
 * Ties within it keep the theme backdrop, so ordinary art does not flip.
 */
export const LOST_MARGIN = 0.15;
/**
 * Weight of the silhouette edge in a backdrop's score; the fill gets the rest. What makes art readable is the
 * contrast of its outline, so the edge leads. The fill still counts a little: it breaks ties between backdrops
 * that keep the outline equally well, and it is what flips black art that has a few light pixels (an edge that
 * "reads" only through one white eye is not a readable shape).
 */
export const EDGE_WEIGHT = 0.75;
/**
 * How far behind its outline the edge looks for something that reads, as a share of the shape's longer side.
 * A dark outline on a dark backdrop vanishes, but the fill behind it still draws the shape, so an edge pixel
 * only counts as lost when nothing within this reach reads either. 12% covers the 1 px outline of pixel art and
 * the 7 to 8% strokes of vector illustrations; it is short enough that a navy shield with a gold wreath deeper
 * in is still lost on a dark backdrop.
 */
export const EDGE_REACH = 0.12;
const MAX_REACH = 16;
/** Below this share of transparent pixels an image counts as opaque. */
export const MIN_TRANSPARENT_SHARE = 0.01;

export interface PixelStats {
  pixels: number;
  /** Pixels with alpha of 128 or more. */
  opaque: number;
  /** Share of all pixels with alpha under 128. */
  transparentShare: number;
  /** Opaque pixels by perceptual lightness: bin = floor(sqrt(luminance) * 32). */
  histogram: number[];
  /** Silhouette-edge pixels: opaque pixels with a transparent 4-neighbour. */
  edge: number;
  /** The edge pixels' own lightness, same bins as `histogram`. */
  edgeHistogram: number[];
  /**
   * The edge pixels again, each by the darkest and the lightest pixel within EDGE_REACH behind it (through the
   * same shape): index = darkestBin * 32 + lightestBin. An outline is lost on a backdrop only when both ends
   * are, which `edgeHistogram` alone cannot say.
   */
  edgeReach: number[];
}

function emptyStats(pixels: number): PixelStats {
  return {
    pixels,
    opaque: 0,
    transparentShare: 0,
    histogram: new Array<number>(BINS).fill(0),
    edge: 0,
    edgeHistogram: new Array<number>(BINS).fill(0),
    edgeReach: new Array<number>(BINS * BINS).fill(0),
  };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function hexLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return relativeLuminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** Mean luminance of a backdrop's two tones. */
export function backdropLuminance(backdrop: Backdrop): number {
  const { a, b } = BACKDROP_PALETTE[backdrop];
  return (hexLuminance(a) + hexLuminance(b)) / 2;
}

function lightnessBin(lum: number): number {
  return Math.min(BINS - 1, Math.floor(Math.sqrt(lum) * BINS));
}

/** Luminance at the middle of a lightness bin. */
function binLuminance(bin: number): number {
  return ((bin + 0.5) / BINS) ** 2;
}

/**
 * Reads RGBA bytes (a canvas ImageData `data`, `width` pixels per row) into the numbers the decision needs:
 * the lightness of all the art, and of its silhouette edge. Without a width the pixels count as one row.
 */
export function analyzePixels(data: ArrayLike<number>, width?: number): PixelStats {
  const count = Math.floor(data.length / 4);
  const w = width && width > 0 ? Math.min(Math.floor(width), Math.max(count, 1)) : Math.max(count, 1);
  const h = Math.ceil(count / w);
  const stats = emptyStats(count);
  const lum = new Float32Array(count);
  const art = new Uint8Array(count);
  let transparent = 0;
  for (let i = 0; i < count; i += 1) {
    if (data[i * 4 + 3] < 128) {
      transparent += 1;
      continue;
    }
    art[i] = 1;
    lum[i] = relativeLuminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    stats.opaque += 1;
    stats.histogram[lightnessBin(lum[i])] += 1;
  }
  stats.transparentShare = count ? transparent / count : 0;
  if (stats.opaque === 0 || transparent === 0) return stats;

  const neighbours = (i: number): number[] => {
    const out: number[] = [];
    if (i % w > 0) out.push(i - 1);
    if (i % w < w - 1 && i + 1 < count) out.push(i + 1);
    if (i >= w) out.push(i - w);
    if (i + w < count) out.push(i + w);
    return out;
  };

  // Each shape (a 4-connected run of art) looks EDGE_REACH of its longer side behind its outline.
  const shape = new Int32Array(count).fill(-1);
  const reachOf: number[] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < count; seed += 1) {
    if (!art[seed] || shape[seed] >= 0) continue;
    const id = reachOf.length;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    shape[seed] = id;
    stack.push(seed);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w;
      const y = Math.floor(i / w);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const n of neighbours(i)) {
        if (art[n] && shape[n] < 0) {
          shape[n] = id;
          stack.push(n);
        }
      }
    }
    const longer = Math.max(maxX - minX + 1, maxY - minY + 1);
    reachOf.push(Math.min(MAX_REACH, Math.max(1, Math.round(longer * EDGE_REACH))));
  }

  // The darkest and the lightest pixel within reach, spread one step at a time through the shape.
  let darkest = Float32Array.from(lum);
  let lightest = Float32Array.from(lum);
  const steps = Math.max(...reachOf);
  for (let step = 1; step <= steps; step += 1) {
    const nextDark = Float32Array.from(darkest);
    const nextLight = Float32Array.from(lightest);
    for (let i = 0; i < count; i += 1) {
      if (!art[i] || reachOf[shape[i]] < step) continue;
      for (const n of neighbours(i)) {
        if (!art[n]) continue;
        if (darkest[n] < nextDark[i]) nextDark[i] = darkest[n];
        if (lightest[n] > nextLight[i]) nextLight[i] = lightest[n];
      }
    }
    darkest = nextDark;
    lightest = nextLight;
  }

  for (let i = 0; i < count; i += 1) {
    if (!art[i] || !neighbours(i).some((n) => !art[n])) continue;
    stats.edge += 1;
    stats.edgeHistogram[lightnessBin(lum[i])] += 1;
    stats.edgeReach[lightnessBin(darkest[i]) * BINS + lightnessBin(lightest[i])] += 1;
  }
  return stats;
}

/**
 * Several images as one, for a collage or a whole grid or page that gets a single backdrop.
 * Unreadable and still-loading ones are left out; `null` when none could be read.
 */
export function mergeStats(list: (PixelStats | null | "pending")[]): PixelStats | null | "pending" {
  const ready = list.filter((s): s is PixelStats => typeof s === "object" && s !== null);
  if (ready.length === 0) return list.some((s) => s === "pending") ? "pending" : null;
  const merged = emptyStats(0);
  let transparent = 0;
  for (const s of ready) {
    merged.pixels += s.pixels;
    merged.opaque += s.opaque;
    merged.edge += s.edge;
    transparent += s.transparentShare * s.pixels;
    s.histogram.forEach((n, bin) => {
      merged.histogram[bin] += n;
    });
    s.edgeHistogram.forEach((n, bin) => {
      merged.edgeHistogram[bin] += n;
    });
    s.edgeReach.forEach((n, cell) => {
      merged.edgeReach[cell] += n;
    });
  }
  merged.transparentShare = merged.pixels ? transparent / merged.pixels : 0;
  return merged;
}

/** A grid or page reads at most this many of its images for its one decision, spread evenly across the list. */
export const MAX_GROUP_SAMPLES = 48;

/** The distinct addresses to read for a group: all of them, or an even spread of `max` when there are more. */
export function sampleSources(srcs: (string | null | undefined)[], max = MAX_GROUP_SAMPLES): string[] {
  const unique = Array.from(new Set(srcs.filter((src): src is string => Boolean(src))));
  if (unique.length <= max) return unique;
  return Array.from({ length: max }, (_, i) => unique[Math.floor((i * unique.length) / max)]);
}

/** Mean luminance of the opaque pixels, 0 to 1 (from the histogram, so to within one bin). */
export function meanOpaqueLuminance(stats: PixelStats): number {
  if (stats.opaque === 0) return 0;
  let sum = 0;
  stats.histogram.forEach((count, bin) => {
    sum += count * binLuminance(bin);
  });
  return sum / stats.opaque;
}

function reads(lum: number, backdropLum: number): boolean {
  return contrastRatio(lum, backdropLum) >= LOST_CONTRAST;
}

/** Share (0 to 1) of the opaque art that has too little contrast against the backdrop. */
export function lostShare(stats: PixelStats, backdrop: Backdrop): number {
  if (stats.opaque === 0) return 0;
  const bg = backdropLuminance(backdrop);
  let lost = 0;
  stats.histogram.forEach((count, bin) => {
    if (!reads(binLuminance(bin), bg)) lost += count;
  });
  return lost / stats.opaque;
}

/**
 * Share (0 to 1) of the silhouette edge that cannot be told from the backdrop. By default an outline that
 * vanishes still counts as seen when the fill right behind it reads; with `through` false only the outline
 * pixel itself is looked at.
 */
export function lostEdgeShare(stats: PixelStats, backdrop: Backdrop, through = true): number {
  // No edge pixels (art that only touches the image border): the fill is all there is to judge.
  if (stats.edge === 0) return lostShare(stats, backdrop);
  const bg = backdropLuminance(backdrop);
  let lost = 0;
  if (!through) {
    stats.edgeHistogram.forEach((count, bin) => {
      if (!reads(binLuminance(bin), bg)) lost += count;
    });
    return lost / stats.edge;
  }
  stats.edgeReach.forEach((count, cell) => {
    if (count === 0) return;
    // Something within reach reads when its lightest end does (dark backdrop), its darkest end does (light
    // backdrop), or either does (mid grey, which a black and a white pixel both stand out from).
    const darkestReads = reads(binLuminance(Math.floor(cell / BINS)), bg);
    const lightestReads = reads(binLuminance(cell % BINS), bg);
    if (!darkestReads && !lightestReads) lost += count;
  });
  return lost / stats.edge;
}

/** How badly a backdrop serves the art, 0 (everything reads) to 1: mostly the lost edge, a little the lost fill. */
export function backdropScore(stats: PixelStats, backdrop: Backdrop): number {
  return EDGE_WEIGHT * lostEdgeShare(stats, backdrop) + (1 - EDGE_WEIGHT) * lostShare(stats, backdrop);
}

export type AutoReason =
  /** The art reads on the theme's own backdrop. */
  | "theme"
  /** Dark art on a dark theme: the light backdrop was picked. */
  | "dark-art"
  /** Light art on a light theme: the dark backdrop was picked. */
  | "light-art"
  /** Art with both very dark and very light parts: mid grey keeps most of it. */
  | "mixed-art"
  /** No transparent pixels, so a backdrop would not show. */
  | "opaque"
  | "empty"
  /** The browser would not give up the pixels (cross-origin without CORS, decode error). */
  | "unreadable"
  | "pending";

export interface AutoDecision {
  /** The backdrop to force, or null to leave the theme's own checkerboard. */
  backdrop: Backdrop | null;
  /** The backdrop actually on screen. */
  effective: Backdrop;
  reason: AutoReason;
}

/**
 * Picks the backdrop for Auto: the one that keeps the art's silhouette readable. Each candidate (the theme's own
 * checkerboard, the opposite one, mid grey) is scored by `backdropScore`: mostly the share of silhouette-edge
 * pixels under 3:1 contrast against it, a little the share of all the art. The theme backdrop stays unless
 * another candidate scores at least LOST_MARGIN better, so a tie keeps the theme; mid grey has to win by that
 * margin too. `null` stats means the pixels could not be read.
 */
export function decideAuto(stats: PixelStats | null | "pending", theme: ThemeName): AutoDecision {
  const own: Backdrop = theme;
  const stay = (reason: AutoReason): AutoDecision => ({ backdrop: null, effective: own, reason });
  if (stats === "pending") return stay("pending");
  if (!stats) return stay("unreadable");
  if (stats.transparentShare < MIN_TRANSPARENT_SHARE) return stay("opaque");
  if (stats.opaque === 0) return stay("empty");

  const other: Backdrop = own === "light" ? "dark" : "light";
  let best: Backdrop = own;
  let bestScore = backdropScore(stats, own);
  for (const candidate of [other, "grey"] as const) {
    const score = backdropScore(stats, candidate);
    if (score <= bestScore - LOST_MARGIN) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best === own) return stay("theme");
  const reason: AutoReason = best === "grey" ? "mixed-art" : own === "dark" ? "dark-art" : "light-art";
  return { backdrop: best, effective: best, reason };
}

/** What is on screen for a mode: the forced backdrop, or null for the theme's own. */
export function resolveBackdrop(mode: BackdropMode, decision: AutoDecision): Backdrop | null {
  return mode === "auto" ? decision.backdrop : mode;
}

/** One sentence for the menu and the live region. */
export function describeBackdrop(mode: BackdropMode, decision: AutoDecision): string {
  if (mode !== "auto") return BACKDROP_LABEL[mode];
  switch (decision.reason) {
    case "dark-art":
      return "Auto: light backdrop, the art is dark";
    case "light-art":
      return "Auto: dark backdrop, the art is light";
    case "mixed-art":
      return "Auto: mid grey backdrop, the art has both dark and light parts";
    case "theme":
      return `Auto: ${decision.effective} backdrop, the art reads on it`;
    case "opaque":
      return "Auto: theme backdrop, the image has no transparent pixels";
    case "empty":
      return "Auto: theme backdrop, no art pixels found";
    case "unreadable":
      return "Auto: theme backdrop, the image's pixels could not be read";
    case "pending":
      return "Auto: theme backdrop, checking the image";
  }
}
