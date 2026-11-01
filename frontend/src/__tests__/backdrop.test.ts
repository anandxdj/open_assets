import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzePixels,
  backdropLuminance,
  contrastRatio,
  decideAuto,
  describeBackdrop,
  lostShare,
  meanOpaqueLuminance,
  relativeLuminance,
  resolveBackdrop,
} from "../features/backdrop/lib/decide";
import { BACKDROP_KEY, readBackdropMode, writeBackdropMode } from "../features/backdrop/lib/prefs";

type Rgba = [number, number, number, number];

/** RGBA bytes for a list of pixels, each repeated `count` times. */
function pixels(...groups: [Rgba, number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [px, count] of groups) for (let i = 0; i < count; i += 1) out.push(...px);
  return Uint8ClampedArray.from(out);
}

const CLEAR: Rgba = [0, 0, 0, 0];
const BLACK: Rgba = [0, 0, 0, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const GREY: Rgba = [128, 128, 128, 255];
const RED: Rgba = [220, 40, 40, 255];

// Pixel invaders: black sprites on transparent, 28% opaque.
const invaders = analyzePixels(pixels([BLACK, 28], [CLEAR, 72]));

test("luminance and contrast follow WCAG", () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio(1, 0) - 21) < 1e-9);
  assert.ok(backdropLuminance("light") > 0.8);
  assert.ok(backdropLuminance("dark") < 0.02);
});

test("analyzePixels counts opaque and transparent pixels and the lightness of the art", () => {
  assert.equal(invaders.pixels, 100);
  assert.equal(invaders.opaque, 28);
  assert.ok(Math.abs(invaders.transparentShare - 0.72) < 1e-9);
  assert.equal(meanOpaqueLuminance(invaders) < 0.01, true);
  const white = analyzePixels(pixels([WHITE, 10], [CLEAR, 10]));
  assert.ok(meanOpaqueLuminance(white) > 0.9);
});

test("half-transparent pixels do not count as art", () => {
  const stats = analyzePixels(pixels([[0, 0, 0, 100], 50], [WHITE, 50]));
  assert.equal(stats.opaque, 50);
  assert.ok(meanOpaqueLuminance(stats) > 0.9);
});

test("black art on transparent: the dark theme gets the light backdrop, the light theme keeps its own", () => {
  const dark = decideAuto(invaders, "dark");
  assert.equal(dark.backdrop, "light");
  assert.equal(dark.reason, "dark-art");
  assert.equal(dark.effective, "light");
  const light = decideAuto(invaders, "light");
  assert.equal(light.backdrop, null);
  assert.equal(light.reason, "theme");
  assert.equal(light.effective, "light");
});

test("white art on transparent: the light theme gets the dark backdrop, the dark theme keeps its own", () => {
  const white = analyzePixels(pixels([WHITE, 30], [CLEAR, 70]));
  assert.equal(decideAuto(white, "light").backdrop, "dark");
  assert.equal(decideAuto(white, "light").reason, "light-art");
  assert.equal(decideAuto(white, "dark").backdrop, null);
});

test("coloured art keeps the theme backdrop in both themes", () => {
  const coloured = analyzePixels(pixels([RED, 30], [[40, 90, 220, 255], 20], [CLEAR, 50]));
  assert.equal(decideAuto(coloured, "light").backdrop, null);
  assert.equal(decideAuto(coloured, "dark").backdrop, null);
});

test("a mixed sheet with art on both sides switches only when the other backdrop clearly does better", () => {
  // Half black, half white: each backdrop loses half of it, so nothing is gained by switching.
  const mixed = analyzePixels(pixels([BLACK, 20], [WHITE, 20], [CLEAR, 60]));
  assert.equal(decideAuto(mixed, "dark").backdrop, null);
  assert.equal(decideAuto(mixed, "light").backdrop, null);
  // Mostly black with a little white: the dark theme still switches.
  const mostlyBlack = analyzePixels(pixels([BLACK, 36], [WHITE, 4], [CLEAR, 60]));
  assert.equal(decideAuto(mostlyBlack, "dark").backdrop, "light");
});

test("mid-grey art reads on both backdrops, so the theme keeps its own", () => {
  const grey = analyzePixels(pixels([GREY, 30], [CLEAR, 70]));
  assert.equal(lostShare(grey, "light"), 0);
  assert.equal(lostShare(grey, "dark"), 0);
  assert.equal(decideAuto(grey, "dark").backdrop, null);
});

test("lostShare is the share of the art that cannot be told from the backdrop", () => {
  assert.equal(lostShare(invaders, "dark"), 1);
  assert.equal(lostShare(invaders, "light"), 0);
});

test("opaque images, empty ones, unreadable ones and ones still loading fall back to the theme", () => {
  const opaque = analyzePixels(pixels([BLACK, 100]));
  assert.deepEqual(decideAuto(opaque, "dark"), { backdrop: null, effective: "dark", reason: "opaque" });
  const empty = analyzePixels(pixels([CLEAR, 100]));
  assert.equal(decideAuto(empty, "light").reason, "empty");
  assert.deepEqual(decideAuto(null, "dark"), { backdrop: null, effective: "dark", reason: "unreadable" });
  assert.deepEqual(decideAuto("pending", "light"), { backdrop: null, effective: "light", reason: "pending" });
  assert.equal(decideAuto(analyzePixels(new Uint8ClampedArray(0)), "dark").backdrop, null);
});

test("a stray transparent pixel does not make an opaque image count as transparent art", () => {
  const nearlyOpaque = analyzePixels(pixels([BLACK, 995], [CLEAR, 5]));
  assert.equal(decideAuto(nearlyOpaque, "dark").reason, "opaque");
});

test("a chosen mode overrides Auto; Auto resolves to the decision", () => {
  const decision = decideAuto(invaders, "dark");
  assert.equal(resolveBackdrop("auto", decision), "light");
  assert.equal(resolveBackdrop("dark", decision), "dark");
  assert.equal(resolveBackdrop("grey", decision), "grey");
  assert.equal(resolveBackdrop("auto", decideAuto(invaders, "light")), null);
});

test("describeBackdrop says what Auto decided and why", () => {
  assert.equal(describeBackdrop("auto", decideAuto(invaders, "dark")), "Auto: light backdrop, the art is dark");
  assert.equal(describeBackdrop("auto", decideAuto(null, "dark")), "Auto: theme backdrop, the image's pixels could not be read");
  assert.equal(describeBackdrop("auto", decideAuto(invaders, "light")), "Auto: light backdrop, the art reads on it");
  assert.equal(describeBackdrop("light", decideAuto(invaders, "dark")), "Light checker");
  assert.equal(describeBackdrop("grey", decideAuto(invaders, "dark")), "Mid grey");
});

test("the backdrop mode is remembered, defaults to Auto and ignores junk and broken storage", () => {
  const data = new Map<string, string>();
  const ok = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(readBackdropMode(ok), "auto");
  writeBackdropMode("grey", ok);
  assert.equal(data.get(BACKDROP_KEY), "grey");
  assert.equal(readBackdropMode(ok), "grey");
  data.set(BACKDROP_KEY, "purple");
  assert.equal(readBackdropMode(ok), "auto");

  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readBackdropMode(broken), "auto");
  assert.doesNotThrow(() => writeBackdropMode("dark", broken));
  assert.equal(readBackdropMode(null), "auto");
});
