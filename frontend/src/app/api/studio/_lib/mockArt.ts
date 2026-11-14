// Mock-mode art (OPENROUTER_MOCK=1): small procedural pictures drawn on the same
// magenta key the real models are asked for, so the client's keying, slicing and
// preview code has something visible to work on. No files, no spend, deterministic.
// The mock contract is unchanged: same sizes in, a PNG data URL out.
import { encodeRgbaPng } from './openrouter';

type Rgb = [number, number, number];

const KEY: Rgb = [255, 0, 255];

class Raster {
  readonly w: number;
  readonly h: number;
  private readonly data: Uint8Array;

  constructor(width: number, height: number, background: Rgb) {
    this.w = Math.max(1, Math.min(4096, Math.round(width)));
    this.h = Math.max(1, Math.min(4096, Math.round(height)));
    this.data = new Uint8Array(this.w * this.h * 4);
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = background[0];
      this.data[i + 1] = background[1];
      this.data[i + 2] = background[2];
      this.data[i + 3] = 255;
    }
  }

  set(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
  }

  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(this.h, Math.ceil(y + h)); yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(this.w, Math.ceil(x + w)); xx++) this.set(xx, yy, c);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgb): void {
    for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++) {
      for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx++) {
        const dx = (xx - cx) / rx;
        const dy = (yy - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(xx, yy, c);
      }
    }
  }

  diamond(cx: number, cy: number, r: number, c: Rgb): void {
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        if (Math.abs(xx - cx) + Math.abs(yy - cy) <= r) this.set(xx, yy, c);
      }
    }
  }

  dataUrl(): string {
    const raw = Buffer.alloc(this.h * (1 + this.w * 4));
    for (let y = 0; y < this.h; y++) {
      const row = y * (1 + this.w * 4);
      raw[row] = 0;
      Buffer.from(this.data.buffer, y * this.w * 4, this.w * 4).copy(raw, row + 1);
    }
    return encodeRgbaPng(this.w, this.h, raw);
  }
}

// The tile pipeline's platform template ('#' material, '.' key). It is a copy of TILE_TEMPLATE_MASK in
// features/studio/lib/tileset.ts, which is a 'use client' module: importing it into a route handler
// gives a client reference, not the array.
const TILE_TEMPLATE_MASK: readonly string[] = [
  '########',
  '########',
  '########',
  '##....##',
  '##....##',
  '########',
  '########',
  '########',
];

const OUTLINE: Rgb = [24, 32, 48];

/** A bouncing slime in every cell: squashes and stretches along the cycle, so the frames differ. */
export function mockSpriteSheet(width: number, height: number, cols: number, rows: number): string {
  const r = new Raster(width, height, KEY);
  const cw = r.w / cols;
  const ch = r.h / rows;
  const total = cols * rows;
  for (let i = 0; i < total; i++) {
    const x0 = (i % cols) * cw;
    const y0 = Math.floor(i / cols) * ch;
    const phase = (i / total) * Math.PI * 2;
    const lift = Math.max(0, Math.sin(phase)) * ch * 0.18;
    const squash = 1 - Math.sin(phase) * 0.16;
    const rx = cw * 0.26 * (2 - squash);
    const ry = ch * 0.24 * squash;
    const cx = x0 + cw / 2;
    const cy = y0 + ch * 0.66 - ry - lift;
    r.ellipse(cx, cy, rx + 4, ry + 4, OUTLINE);
    r.ellipse(cx, cy, rx, ry, [66, 190, 112]);
    r.ellipse(cx - rx * 0.35, cy - ry * 0.45, rx * 0.22, ry * 0.16, [190, 250, 205]);
    r.ellipse(cx - rx * 0.3, cy - ry * 0.05, rx * 0.12, ry * 0.2, [255, 255, 255]);
    r.ellipse(cx + rx * 0.3, cy - ry * 0.05, rx * 0.12, ry * 0.2, [255, 255, 255]);
    r.ellipse(cx - rx * 0.28, cy, rx * 0.05, ry * 0.1, OUTLINE);
    r.ellipse(cx + rx * 0.32, cy, rx * 0.05, ry * 0.1, OUTLINE);
    r.ellipse(cx, y0 + ch * 0.7, rx * 0.8, ch * 0.03, [30, 120, 80]);
  }
  return r.dataUrl();
}

/** A different simple prop in every cell (crate, coin, potion, gem, barrel), repeating. */
export function mockPropSheet(width: number, height: number, cols: number, rows: number): string {
  const r = new Raster(width, height, KEY);
  const cw = r.w / cols;
  const ch = r.h / rows;
  for (let i = 0; i < cols * rows; i++) {
    const cx = (i % cols) * cw + cw / 2;
    const cy = Math.floor(i / cols) * ch + ch / 2;
    drawProp(r, i % 5, cx, cy, Math.min(cw, ch) * 0.34);
  }
  return r.dataUrl();
}

/** One prop in the middle of the picture. */
export function mockSingleProp(width: number, height: number, seed = 0): string {
  const r = new Raster(width, height, KEY);
  drawProp(r, seed % 5, r.w / 2, r.h / 2, Math.min(r.w, r.h) * 0.34);
  return r.dataUrl();
}

function drawProp(r: Raster, kind: number, cx: number, cy: number, s: number): void {
  if (kind === 0) {
    r.rect(cx - s, cy - s, s * 2, s * 2, OUTLINE);
    r.rect(cx - s + 4, cy - s + 4, s * 2 - 8, s * 2 - 8, [176, 120, 64]);
    for (let k = 1; k < 4; k++) r.rect(cx - s + 4, cy - s + (k * s * 2) / 4, s * 2 - 8, 3, [120, 78, 40]);
  } else if (kind === 1) {
    r.ellipse(cx, cy, s + 4, s + 4, OUTLINE);
    r.ellipse(cx, cy, s, s, [244, 196, 48]);
    r.ellipse(cx, cy, s * 0.62, s * 0.62, [214, 158, 24]);
  } else if (kind === 2) {
    r.rect(cx - s * 0.2 - 3, cy - s - 3, s * 0.4 + 6, s * 0.7 + 3, OUTLINE);
    r.rect(cx - s * 0.2, cy - s, s * 0.4, s * 0.6, [200, 210, 220]);
    r.ellipse(cx, cy + s * 0.2, s * 0.8 + 4, s * 0.8 + 4, OUTLINE);
    r.ellipse(cx, cy + s * 0.2, s * 0.8, s * 0.8, [210, 48, 64]);
    r.ellipse(cx - s * 0.25, cy, s * 0.15, s * 0.2, [255, 170, 176]);
  } else if (kind === 3) {
    r.diamond(cx, cy, s + 4, OUTLINE);
    r.diamond(cx, cy, s, [64, 200, 230]);
    r.diamond(cx - s * 0.2, cy - s * 0.2, s * 0.4, [180, 240, 255]);
  } else {
    r.ellipse(cx, cy, s * 0.8 + 4, s + 4, OUTLINE);
    r.ellipse(cx, cy, s * 0.8, s, [150, 96, 52]);
    r.rect(cx - s * 0.8, cy - s * 0.4, s * 1.6, 4, [90, 90, 100]);
    r.rect(cx - s * 0.8, cy + s * 0.4, s * 1.6, 4, [90, 90, 100]);
  }
}

function noise(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function stone(r: Raster, x0: number, y0: number, w: number, h: number, tint: number): void {
  const brickH = Math.max(8, Math.round(h / 4));
  const brickW = Math.max(12, Math.round(w / 3));
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / brickH);
    for (let x = 0; x < w; x++) {
      const bx = (x + (row % 2 ? brickW / 2 : 0)) % brickW;
      const mortar = y % brickH < 3 || bx < 3;
      const n = noise(x + x0, y + y0) * 18;
      const base = mortar ? 70 : 128 + tint;
      r.set(x0 + x, y0 + y, [base + n, base - 6 + n, base - 20 + n]);
    }
  }
}

/** Stone where the template mask has '#', the key colour where it has '.': the platform silhouette the tile pipeline slices. */
export function mockTileSheet(width: number, height: number, mask: readonly string[] = TILE_TEMPLATE_MASK): string {
  const r = new Raster(width, height, KEY);
  const rows = mask.length;
  const cols = mask[0]?.length ?? 1;
  const cw = Math.floor(r.w / cols);
  const ch = Math.floor(r.h / rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (mask[row]?.[col] === '#') stone(r, col * cw, row * ch, cw, ch, ((row + col) % 4) * 5);
    }
  }
  // The template leaves a quarter-cell of key colour outside the platform; the client aligns on it.
  const inset = Math.round(cw / 4);
  r.rect(0, 0, r.w, inset, KEY);
  r.rect(0, r.h - inset, r.w, inset, KEY);
  r.rect(0, 0, inset, r.h, KEY);
  r.rect(r.w - inset, 0, inset, r.h, KEY);
  return r.dataUrl();
}

/** One stone tile filling the picture. */
export function mockSingleTile(width: number, height: number): string {
  const r = new Raster(width, height, KEY);
  stone(r, 0, 0, r.w, r.h, 0);
  return r.dataUrl();
}

/** A parallax layer cut out on the key: rolling hills with a few pines, empty above. */
export function mockLayer(width: number, height: number, depth = 0): string {
  const r = new Raster(width, height, KEY);
  const colours: Rgb[] = [
    [92, 128, 150],
    [58, 110, 96],
    [34, 80, 62],
  ];
  const c = colours[Math.min(colours.length - 1, Math.max(0, depth))] as Rgb;
  for (let x = 0; x < r.w; x++) {
    const top = r.h * (0.58 - depth * 0.05) + Math.sin(x / (r.w / 5) + depth) * r.h * 0.07 + Math.sin(x / (r.w / 17)) * r.h * 0.02;
    r.rect(x, top, 1, r.h - top, c);
  }
  const trees = 7 + depth * 3;
  for (let t = 0; t < trees; t++) {
    const x = ((t + 0.5) / trees) * r.w;
    const base = r.h * (0.58 - depth * 0.05) + Math.sin(x / (r.w / 5) + depth) * r.h * 0.07 + Math.sin(x / (r.w / 17)) * r.h * 0.02;
    const th = r.h * (0.12 + noise(t, depth) * 0.08);
    for (let y = 0; y < th; y++) r.rect(x - (y / th) * th * 0.28, base - th + y, ((y / th) * th * 0.56) | 0, 1, c);
  }
  return r.dataUrl();
}
