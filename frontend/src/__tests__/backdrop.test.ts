import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzePixels,
  backdropLuminance,
  backdropScore,
  contrastRatio,
  decideAuto,
  describeBackdrop,
  EDGE_WEIGHT,
  LOST_MARGIN,
  lostEdgeShare,
  lostShare,
  MAX_GROUP_SAMPLES,
  meanOpaqueLuminance,
  mergeStats,
  relativeLuminance,
  resolveBackdrop,
  sampleSources,
  type PixelStats,
  type ThemeName,
} from "../features/backdrop/lib/decide";
import { BACKDROP_KEY, readBackdropMode, writeBackdropMode } from "../features/backdrop/lib/prefs";

type Rgba = [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];
const BLACK: Rgba = [0, 0, 0, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const GREY: Rgba = [128, 128, 128, 255];
const RED: Rgba = [220, 40, 40, 255];
const BLUE: Rgba = [40, 90, 220, 255];
const GREEN: Rgba = [20, 150, 80, 255];
const YELLOW: Rgba = [250, 225, 20, 255];
const LIME: Rgba = [160, 255, 30, 255];
const OUTLINE: Rgba = [34, 26, 22, 255];
const NAVY: Rgba = [29, 43, 69, 255];
const GOLD: Rgba = [201, 162, 39, 255];
const CREAM: Rgba = [247, 244, 232, 255];

/** A small RGBA image to draw rectangles on; transparent to start with. */
class Img {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
    background: Rgba = CLEAR,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
    this.rect(0, 0, w, h, background);
  }
  rect(x: number, y: number, rw: number, rh: number, px: Rgba): this {
    for (let j = y; j < y + rh; j += 1) {
      for (let i = x; i < x + rw; i += 1) this.data.set(px, (j * this.w + i) * 4);
    }
    return this;
  }
  stats(): PixelStats {
    return analyzePixels(this.data, this.w);
  }
}

/** Three 8 px sprites with two eye holes each, in one colour: the invaders sheet. */
function invaders(color: Rgba, eye: Rgba = CLEAR): Img {
  const img = new Img(32, 12);
  for (let n = 0; n < 3; n += 1) {
    const x = 1 + n * 10;
    img.rect(x, 2, 8, 8, color).rect(x + 2, 4, 2, 2, eye).rect(x + 5, 4, 2, 2, eye);
  }
  return img;
}

/** A 12 px sprite with a 1 px dark outline and coloured fills, the way most pixel art is drawn. */
function outlined(fills: Rgba[]): Img {
  const img = new Img(16, 16).rect(2, 2, 12, 12, OUTLINE);
  fills.forEach((fill, i) => img.rect(3 + (i % 2) * 5, 3 + Math.floor(i / 2) * 5, 5, 5, fill));
  // Rounded corners, as drawn sprites have: an outline pixel with only outline around it would have nothing behind it.
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) img.rect(x, y, 1, 1, CLEAR);
  return img;
}

/** Coloured fills with no outline at all: the fill is the edge. */
function plainFills(fills: Rgba[]): Img {
  const img = new Img(fills.length * 10 + 2, 12);
  fills.forEach((fill, i) => img.rect(2 + i * 10, 2, 8, 8, fill));
  return img;
}

/** A logo tile: a navy shield, a gold wreath inside it, a cream centre. */
function logo(): Img {
  return new Img(24, 28).rect(2, 2, 20, 24, NAVY).rect(6, 6, 12, 16, GOLD).rect(8, 8, 8, 12, CREAM);
}

function pick(stats: PixelStats | null | "pending", theme: ThemeName): string {
  return decideAuto(stats, theme).backdrop ?? "theme";
}

const both = (stats: PixelStats) => `${pick(stats, "light")}/${pick(stats, "dark")}`;

test("luminance and contrast follow WCAG", () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio(1, 0) - 21) < 1e-9);
  assert.ok(backdropLuminance("light") > 0.8);
  assert.ok(backdropLuminance("dark") < 0.02);
});

test("analyzePixels counts opaque and transparent pixels and the lightness of the art", () => {
  const black = invaders(BLACK).stats();
  assert.equal(black.pixels, 32 * 12);
  assert.equal(black.opaque, 3 * (64 - 8));
  assert.ok(Math.abs(black.transparentShare - (1 - black.opaque / black.pixels)) < 1e-9);
  assert.ok(meanOpaqueLuminance(black) < 0.01);
  assert.ok(meanOpaqueLuminance(invaders(WHITE).stats()) > 0.9);
});

test("silhouette-edge pixels are the opaque ones with a transparent 4-neighbour", () => {
  // A 3x3 block in a 5x5 image: everything but the centre touches the transparent margin.
  const block = new Img(5, 5).rect(1, 1, 3, 3, WHITE).stats();
  assert.equal(block.opaque, 9);
  assert.equal(block.edge, 8);
  assert.equal(block.edgeHistogram.reduce((a, b) => a + b, 0), 8);
  assert.equal(block.edgeReach.reduce((a, b) => a + b, 0), 8);
  // A pixel that only touches the image border has no transparent neighbour, so it is not an edge.
  const corner = new Img(4, 4).rect(0, 0, 2, 2, WHITE).stats();
  assert.equal(corner.edge, 3);
  // A diagonal neighbour does not count.
  const diagonal = new Img(3, 3, WHITE).rect(1, 1, 1, 1, CLEAR).stats();
  assert.equal(diagonal.edge, 4);
  // No transparency at all: no edge.
  assert.equal(new Img(4, 4, WHITE).stats().edge, 0);
  // Edges merge along with the fill.
  const merged = mergeStats([block, corner]);
  assert.ok(merged && merged !== "pending");
  assert.equal(merged.edge, 11);
});

test("half-transparent pixels do not count as art", () => {
  const img = new Img(10, 10).rect(0, 0, 10, 5, [0, 0, 0, 100]).rect(0, 5, 10, 5, WHITE);
  const stats = img.stats();
  assert.equal(stats.opaque, 50);
  assert.ok(meanOpaqueLuminance(stats) > 0.9);
});

test("black art on transparent: the dark theme gets the light backdrop, the light theme keeps its own", () => {
  const black = invaders(BLACK).stats();
  const dark = decideAuto(black, "dark");
  assert.equal(dark.backdrop, "light");
  assert.equal(dark.reason, "dark-art");
  assert.equal(dark.effective, "light");
  const light = decideAuto(black, "light");
  assert.equal(light.backdrop, null);
  assert.equal(light.reason, "theme");
  assert.equal(light.effective, "light");
  // An edge that reads only through two white eye pixels is still a lost silhouette.
  assert.equal(pick(invaders(BLACK, WHITE).stats(), "dark"), "light");
});

test("white art on transparent: the light theme gets the dark backdrop, the dark theme keeps its own", () => {
  const white = invaders(WHITE).stats();
  assert.equal(decideAuto(white, "light").backdrop, "dark");
  assert.equal(decideAuto(white, "light").reason, "light-art");
  assert.equal(decideAuto(white, "dark").backdrop, null);
});

test("coloured pixel art with dark 1 px outlines keeps the theme backdrop in both themes", () => {
  const sprite = outlined([RED, BLUE, GREEN, YELLOW]).stats();
  // The outline alone is lost on the dark backdrop, but the fill behind it still draws the shape.
  assert.equal(lostEdgeShare(sprite, "dark", false), 1);
  assert.equal(lostEdgeShare(sprite, "dark"), 0);
  assert.equal(lostEdgeShare(sprite, "light"), 0);
  assert.equal(both(sprite), "theme/theme");
  // Pale fills (lost on the light backdrop) do not flip the light theme either: the outline reads.
  const pale = outlined([YELLOW, LIME, WHITE, [250, 200, 150, 255]]).stats();
  assert.ok(lostShare(pale, "light") > 0.5);
  assert.equal(both(pale), "theme/theme");
});

test("a colourful sheet of saturated mid-tones keeps the theme backdrop in both themes", () => {
  const sheet = new Img(64, 16);
  [RED, BLUE, [150, 50, 190, 255], [190, 70, 20, 255], [20, 150, 120, 255], [210, 60, 130, 255]].forEach((fill, i) => {
    sheet.rect(2 + i * 10, 2, 8, 12, fill as Rgba);
  });
  const stats = sheet.stats();
  assert.equal(lostShare(stats, "light"), 0);
  assert.equal(both(stats), "theme/theme");
});

test("fill-only art with no outline: yellow, lime and white on the light theme get the dark backdrop", () => {
  const fills = plainFills([YELLOW, LIME, WHITE]).stats();
  assert.equal(lostEdgeShare(fills, "light"), 1);
  assert.equal(decideAuto(fills, "light").backdrop, "dark");
  assert.equal(decideAuto(fills, "light").reason, "light-art");
  assert.equal(decideAuto(fills, "dark").backdrop, null);
});

test("navy, gold and cream logos: the navy outline reads on the light checker, so both themes get light", () => {
  const stats = logo().stats();
  assert.ok(lostShare(stats, "dark") >= 0.4, "navy is lost on the dark backdrop");
  assert.ok(lostShare(stats, "light") >= 0.4, "gold and cream are lost on the light backdrop");
  assert.equal(lostEdgeShare(stats, "dark"), 1, "the navy rim is lost on dark, and nothing behind it reads");
  assert.equal(lostEdgeShare(stats, "light"), 0);
  // The light theme keeps its own checker; the dark theme flips to the same one, so a logo grid never changes with the theme.
  assert.equal(both(stats), "theme/light");
  assert.equal(describeBackdrop("auto", decideAuto(stats, "dark")), "Auto: light backdrop, the art is dark");
});

test("art with both black and white parts goes to mid grey, which keeps all of it", () => {
  const mixed = new Img(24, 12).rect(2, 2, 8, 8, BLACK).rect(14, 2, 8, 8, WHITE).stats();
  assert.equal(lostEdgeShare(mixed, "grey"), 0);
  assert.equal(lostShare(mixed, "grey"), 0);
  assert.equal(decideAuto(mixed, "dark").backdrop, "grey");
  assert.equal(decideAuto(mixed, "light").backdrop, "grey");
  assert.equal(decideAuto(mixed, "dark").reason, "mixed-art");
});

test("mostly black art with a little white still takes the light backdrop, not mid grey", () => {
  const img = new Img(92, 12);
  for (let n = 0; n < 10; n += 1) img.rect(1 + n * 9, 2, 8, 8, n === 9 ? WHITE : BLACK);
  const stats = img.stats();
  assert.equal(pick(stats, "dark"), "light");
  assert.equal(pick(stats, "light"), "theme");
});

test("the margin keeps the theme backdrop unless another one scores clearly better", () => {
  const black = invaders(BLACK).stats();
  const colour = outlined([RED, BLUE, GREEN, YELLOW]).stats();
  const share = (blackTiles: number, colourTiles: number) => {
    const merged = mergeStats([...Array(blackTiles).fill(black), ...Array(colourTiles).fill(colour)]);
    assert.ok(merged && merged !== "pending");
    return merged;
  };
  // One dark tile among nineteen coloured ones: switching would gain little, so the dark theme stays.
  const nearlyTied = share(1, 19);
  assert.ok(backdropScore(nearlyTied, "dark") - backdropScore(nearlyTied, "light") < LOST_MARGIN);
  assert.equal(pick(nearlyTied, "dark"), "theme");
  // Mostly black tiles: the gain passes the margin.
  const mostly = share(3, 1);
  assert.ok(backdropScore(mostly, "dark") - backdropScore(mostly, "light") > LOST_MARGIN);
  assert.equal(pick(mostly, "dark"), "light");
});

test("a score is mostly the lost edge and a little the lost fill", () => {
  const black = invaders(BLACK).stats();
  assert.equal(backdropScore(black, "dark"), 1);
  assert.equal(backdropScore(black, "light"), 0);
  assert.equal(EDGE_WEIGHT, 0.75);
  // Pale sprite outlined in black: nothing of the edge is lost on light, a lot of the fill is.
  const pale = outlined([YELLOW, LIME, WHITE, WHITE]).stats();
  assert.equal(lostEdgeShare(pale, "light"), 0);
  assert.ok(Math.abs(backdropScore(pale, "light") - (1 - EDGE_WEIGHT) * lostShare(pale, "light")) < 1e-9);
});

test("a grid is decided once from all its images, so a mixed grid gets one backdrop", () => {
  const shield = logo().stats();
  const coloured = outlined([RED, BLUE, GREEN, YELLOW]).stats();
  const white = invaders(WHITE).stats();
  const black = invaders(BLACK).stats();
  // Decided alone, the tiles of a mixed grid disagree on the dark theme...
  assert.equal(pick(black, "dark"), "light");
  assert.equal(pick(coloured, "dark"), "theme");
  assert.equal(pick(white, "dark"), "theme");
  // ...decided together, every tile gets the same answer, in both themes.
  const grid = mergeStats([shield, coloured, black, white, shield]);
  assert.ok(grid && grid !== "pending");
  for (const theme of ["dark", "light"] as const) {
    const together = decideAuto(grid, theme);
    assert.equal(together.backdrop, "grey", theme);
    assert.equal(decideAuto(grid, theme).backdrop, together.backdrop);
  }
  // A grid of one kind of logo is just as stable.
  const logos = mergeStats(Array(30).fill(shield));
  assert.ok(logos && logos !== "pending");
  assert.equal(both(logos), "theme/light");
});

test("mid-grey art reads on both backdrops, so the theme keeps its own", () => {
  const grey = invaders(GREY).stats();
  assert.equal(lostShare(grey, "light"), 0);
  assert.equal(lostShare(grey, "dark"), 0);
  assert.equal(lostEdgeShare(grey, "light"), 0);
  assert.equal(both(grey), "theme/theme");
});

test("lostShare is the share of the art that cannot be told from the backdrop", () => {
  const black = invaders(BLACK).stats();
  assert.equal(lostShare(black, "dark"), 1);
  assert.equal(lostShare(black, "light"), 0);
  assert.equal(lostEdgeShare(black, "dark"), 1);
  assert.equal(lostEdgeShare(black, "dark", false), 1);
});

test("a collage is decided from all its images together, skipping unreadable and loading ones", () => {
  const black = new Img(10, 10).rect(1, 1, 8, 8, BLACK).stats();
  const white = new Img(10, 10).rect(1, 1, 8, 8, WHITE).stats();
  const colour = outlined([RED, [210, 60, 130, 255], GREEN, BLUE]).stats();
  // One black and one white sprite among coloured ones do not flip a cover.
  const merged = mergeStats([black, colour, colour, colour, white]);
  assert.ok(merged && merged !== "pending");
  assert.equal(merged.opaque, black.opaque + 3 * colour.opaque + white.opaque);
  assert.equal(pick(merged, "dark"), "theme");
  // All black art: the merge keeps the decision of its parts.
  assert.equal(pick(mergeStats([black, black]), "dark"), "light");
  assert.equal(mergeStats([null, "pending", black])?.valueOf() !== "pending", true);
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
  const opaque = new Img(10, 10, BLACK).stats();
  assert.deepEqual(decideAuto(opaque, "dark"), { backdrop: null, effective: "dark", reason: "opaque" });
  const empty = new Img(10, 10).stats();
  assert.equal(decideAuto(empty, "light").reason, "empty");
  assert.deepEqual(decideAuto(null, "dark"), { backdrop: null, effective: "dark", reason: "unreadable" });
  assert.deepEqual(decideAuto("pending", "light"), { backdrop: null, effective: "light", reason: "pending" });
  assert.equal(decideAuto(analyzePixels(new Uint8ClampedArray(0)), "dark").backdrop, null);
  // An opaque sheet in either theme, even a black one on the dark theme, keeps the theme.
  assert.equal(both(opaque), "theme/theme");
});

test("a stray transparent pixel does not make an opaque image count as transparent art", () => {
  const nearlyOpaque = new Img(40, 30, BLACK).rect(0, 0, 3, 1, CLEAR).stats();
  assert.equal(decideAuto(nearlyOpaque, "dark").reason, "opaque");
});

test("a chosen mode overrides Auto; Auto resolves to the decision", () => {
  const black = invaders(BLACK).stats();
  const decision = decideAuto(black, "dark");
  assert.equal(resolveBackdrop("auto", decision), "light");
  assert.equal(resolveBackdrop("dark", decision), "dark");
  assert.equal(resolveBackdrop("grey", decision), "grey");
  assert.equal(resolveBackdrop("auto", decideAuto(black, "light")), null);
});

test("describeBackdrop says what Auto decided and why", () => {
  const black = invaders(BLACK).stats();
  assert.equal(describeBackdrop("auto", decideAuto(black, "dark")), "Auto: light backdrop, the art is dark");
  assert.equal(describeBackdrop("auto", decideAuto(null, "dark")), "Auto: theme backdrop, the image's pixels could not be read");
  assert.equal(describeBackdrop("auto", decideAuto(black, "light")), "Auto: light backdrop, the art reads on it");
  assert.equal(describeBackdrop("light", decideAuto(black, "dark")), "Light checker");
  assert.equal(describeBackdrop("grey", decideAuto(black, "dark")), "Mid grey");
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
