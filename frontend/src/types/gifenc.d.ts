// Ambient declarations for `gifenc`, which is published as plain JavaScript.
//
// DELETE THIS FILE if a future gifenc version ships its own declarations — a
// local ambient module silently wins over the package's own types, so leaving
// it in place would hide any upstream API change behind a stale signature.
//
// Only the surface `features/anibuddy/lib/export.ts` uses is declared.
declare module "gifenc" {
  export type GifFormat = "rgb565" | "rgb444" | "rgba4444";

  /** RGB or RGBA entries, depending on `format`. */
  export type Palette = number[][];

  export interface QuantizeOptions {
    format?: GifFormat;
    /** Reserve one fully-transparent palette entry (GIF has 1-bit alpha). */
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export interface WriteFrameOptions {
    palette?: Palette;
    /** Hundredths of a second are handled internally; this is milliseconds. */
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
    colorDepth?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array | number[],
      width: number,
      height: number,
      options?: WriteFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: GifFormat,
  ): Uint8Array;

  export function nearestColorIndex(palette: Palette, pixel: number[]): number;
  export function prequantize(
    rgba: Uint8Array | Uint8ClampedArray,
    options?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number },
  ): void;
}
