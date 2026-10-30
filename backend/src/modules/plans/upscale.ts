/** Export upscale factors the pipeline supports. The first is the default. */
export const UPSCALE_SCALES = [2, 4] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];

/**
 * Width in px of the crop for a box, as the crop service cuts it: the rounded
 * box clamped to the sheet (`sheetWidth` 0 or unknown means no clamp). The
 * providers' AI upscale is a fixed 4x, so the extract export resizes to exactly
 * `scale` times this width.
 */
export function croppedWidth(box: { x: number; width: number }, sheetWidth: number): number {
  const x = Math.max(0, Math.round(box.x));
  const x2 = Math.round(box.x) + Math.round(box.width);
  return Math.max(1, (sheetWidth > 0 ? Math.min(sheetWidth, x2) : x2) - x);
}
