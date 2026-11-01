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
/** An art pixel counts as lost when its contrast against the backdrop is below this. */
export const LOST_CONTRAST = 2;
/** Auto leaves the theme backdrop alone while no more than this share of the art is lost on it. */
export const LOST_TOLERANCE = 0.25;
/** The other backdrop has to do at least this much better (share of the art) to replace it. */
export const LOST_MARGIN = 0.15;
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

/** Reads RGBA bytes (a canvas ImageData `data`) into the numbers the decision needs. */
export function analyzePixels(data: ArrayLike<number>): PixelStats {
  const histogram = new Array<number>(BINS).fill(0);
  const pixels = Math.floor(data.length / 4);
  let opaque = 0;
  let transparent = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    if (data[i + 3] < 128) {
      transparent += 1;
      continue;
    }
    opaque += 1;
    const lum = relativeLuminance(data[i], data[i + 1], data[i + 2]);
    histogram[Math.min(BINS - 1, Math.floor(Math.sqrt(lum) * BINS))] += 1;
  }
  return { pixels, opaque, transparentShare: pixels ? transparent / pixels : 0, histogram };
}

/** Mean luminance of the opaque pixels, 0 to 1 (from the histogram, so to within one bin). */
export function meanOpaqueLuminance(stats: PixelStats): number {
  if (stats.opaque === 0) return 0;
  let sum = 0;
  stats.histogram.forEach((count, bin) => {
    sum += count * ((bin + 0.5) / BINS) ** 2;
  });
  return sum / stats.opaque;
}

/** Share (0 to 1) of the opaque art that has too little contrast against the backdrop. */
export function lostShare(stats: PixelStats, backdrop: Backdrop): number {
  if (stats.opaque === 0) return 0;
  const bg = backdropLuminance(backdrop);
  let lost = 0;
  stats.histogram.forEach((count, bin) => {
    if (contrastRatio(((bin + 0.5) / BINS) ** 2, bg) < LOST_CONTRAST) lost += count;
  });
  return lost / stats.opaque;
}

export type AutoReason =
  /** The art reads on the theme's own backdrop. */
  | "theme"
  /** Dark art on a dark theme: the light backdrop was picked. */
  | "dark-art"
  /** Light art on a light theme: the dark backdrop was picked. */
  | "light-art"
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
 * Picks the backdrop for Auto. The theme's own checkerboard stays unless a real part of the art would be
 * lost on it and the other one does clearly better. `null` stats means the pixels could not be read yet or at all.
 */
export function decideAuto(stats: PixelStats | null | "pending", theme: ThemeName): AutoDecision {
  const own: Backdrop = theme;
  const stay = (reason: AutoReason): AutoDecision => ({ backdrop: null, effective: own, reason });
  if (stats === "pending") return stay("pending");
  if (!stats) return stay("unreadable");
  if (stats.transparentShare < MIN_TRANSPARENT_SHARE) return stay("opaque");
  if (stats.opaque === 0) return stay("empty");

  const lostOwn = lostShare(stats, own);
  if (lostOwn <= LOST_TOLERANCE) return stay("theme");
  const other: Backdrop = own === "light" ? "dark" : "light";
  if (lostShare(stats, other) <= lostOwn - LOST_MARGIN) {
    return { backdrop: other, effective: other, reason: own === "dark" ? "dark-art" : "light-art" };
  }
  return stay("theme");
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
