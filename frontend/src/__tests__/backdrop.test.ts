import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzePixels,
  backdropLuminance,
  contrastRatio,
  decideAuto,
  LOST_MARGIN,
  MAX_GROUP_SAMPLES,
  sampleSources,
  describeBackdrop,
  lostShare,
  meanOpaqueLuminance,
  mergeStats,
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

test("a colourful sheet of saturated mid-tones keeps the theme backdrop in both themes", () => {
  const saturated = analyzePixels(
    pixels(
      [[220, 40, 40, 255], 8], // red
      [[40, 90, 220, 255], 8], // blue
      [[150, 50, 190, 255], 8], // purple
      [[190, 70, 20, 255], 8], // burnt orange
      [[20, 150, 120, 255], 8], // teal
      [[210, 60, 130, 255], 8], // pink
      [CLEAR, 52],
    ),
  );
  assert.equal(lostShare(saturated, "light"), 0);
  assert.equal(decideAuto(saturated, "light").backdrop, null);
  assert.equal(decideAuto(saturated, "dark").backdrop, null);
});

// A logo sheet like the export grid's: navy lettering and shields, gold wreaths, cream and white interiors.
const NAVY: Rgba = [29, 43, 69, 255];
const GOLD: Rgba = [201, 162, 39, 255];
const CREAM: Rgba = [247, 244, 232, 255];
const logos = analyzePixels(pixels([NAVY, 45], [GOLD, 25], [CREAM, 30], [CLEAR, 100]));

test("navy, gold and white logos: dark loses the lettering, light loses the gold and the white, mid grey keeps most", () => {
  assert.ok(lostShare(logos, "dark") >= 0.4, "navy is lost on the dark backdrop");
  assert.ok(lostShare(logos, "light") >= 0.5, "gold and cream are lost on the light backdrop");
  assert.ok(lostShare(logos, "grey") <= 0.3, "only the gold is lost on mid grey");
  for (const theme of ["dark", "light"] as const) {
    const decision = decideAuto(logos, theme);
    assert.equal(decision.backdrop, "grey", theme);
    assert.equal(decision.reason, "mixed-art");
    assert.equal(decision.effective, "grey");
  }
  assert.equal(describeBackdrop("auto", decideAuto(logos, "dark")), "Auto: mid grey backdrop, the art has both dark and light parts");
});

test("art with both black and white parts goes to mid grey, which keeps all of it", () => {
  const mixed = analyzePixels(pixels([BLACK, 20], [WHITE, 20], [CLEAR, 60]));
  assert.equal(lostShare(mixed, "grey"), 0);
  assert.equal(decideAuto(mixed, "dark").backdrop, "grey");
  assert.equal(decideAuto(mixed, "light").backdrop, "grey");
});

test("mostly black art with a little white still takes the light backdrop, not mid grey", () => {
  // Light loses the 10% white, mid grey loses nothing but does not win by the margin over the light one.
  const mostlyBlack = analyzePixels(pixels([BLACK, 36], [WHITE, 4], [CLEAR, 60]));
  assert.equal(decideAuto(mostlyBlack, "dark").backdrop, "light");
  assert.equal(decideAuto(mostlyBlack, "light").backdrop, null);
});

test("the tie margin keeps the theme backdrop unless another one loses clearly less", () => {
  // 90% black, 10% white on a dark theme: light loses 10%, dark loses 90%: switch.
  assert.equal(decideAuto(analyzePixels(pixels([BLACK, 90], [WHITE, 10], [CLEAR, 100])), "dark").backdrop, "light");
  // Dark theme, 5% of the art black (lost on dark), the rest coloured: switching would gain only 5%, so stay.
  const nearlyTied = analyzePixels(pixels([BLACK, 5], [RED, 95], [CLEAR, 100]));
  assert.equal(lostShare(nearlyTied, "dark"), 0.05);
  assert.equal(decideAuto(nearlyTied, "dark").backdrop, null);
  // The same art with 20% black: the gain passes the margin.
  const clear = analyzePixels(pixels([BLACK, 20], [RED, 80], [CLEAR, 100]));
  assert.ok(lostShare(clear, "dark") - lostShare(clear, "light") > LOST_MARGIN);
  assert.equal(decideAuto(clear, "dark").backdrop, "light");
});

test("a grid is decided once from all its images, so tiles with different art share one backdrop", () => {
  const shield = analyzePixels(pixels([NAVY, 80], [CLEAR, 20])); // the mostly navy tile
  const wreath = analyzePixels(pixels([GOLD, 40], [CREAM, 30], [NAVY, 10], [CLEAR, 20]));
  // Decided alone, the navy shield and its neighbour disagree on the dark theme...
  assert.equal(decideAuto(shield, "dark").backdrop, "light");
  assert.equal(decideAuto(wreath, "dark").backdrop, null);
  // ...decided together, every tile gets the same answer.
  const grid = mergeStats([shield, wreath, logos, logos, wreath]);
  assert.ok(grid && grid !== "pending");
  const together = decideAuto(grid, "dark");
  assert.equal(together.backdrop, "grey");
  assert.equal(decideAuto(grid, "dark").backdrop, together.backdrop);
  assert.equal(decideAuto(grid, "light").backdrop, "grey");
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

test("a collage is decided from all its images together, skipping unreadable and loading ones", () => {
  const white = analyzePixels(pixels([WHITE, 30], [CLEAR, 70]));
  const colour = analyzePixels(pixels([RED, 30], [[210, 60, 130, 255], 30], [CLEAR, 40]));
  // One dark-on-light image among coloured ones does not flip a dark-theme cover.
  const merged = mergeStats([invaders, colour, colour, white]);
  assert.ok(merged && merged !== "pending");
  assert.equal(merged.opaque, 28 + 60 + 60 + 30);
  assert.equal(decideAuto(merged, "dark").backdrop, null);
  // All black art: the merge keeps the decision of its parts.
  assert.equal(decideAuto(mergeStats([invaders, invaders]), "dark").backdrop, "light");
  assert.equal(mergeStats([null, "pending", invaders])?.valueOf() !== "pending", true);
  assert.equal(mergeStats([null, null]), null);
  assert.equal(mergeStats([null, "pending"]), "pending");
  assert.equal(mergeStats([]), null);
});

test("a group reads each distinct image once, and an even spread of them when there are many", () => {
  assert.deepEqual(sampleSources(["a", "b", "a", null, undefined, "c"]), ["a", "b", "c"]);
  const many = Array.from({ length: 200 }, (_, i) => `img-${i}`);
  const sampled = sampleSources(many);
  assert.equal(sampled.length, MAX_GROUP_SAMPLES);
  assert.equal(sampled[0], "img-0");
  assert.ok(Number(sampled[sampled.length - 1].slice(4)) >= 190, "the spread reaches the end of the list");
  assert.deepEqual(sampleSources([]), []);
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
