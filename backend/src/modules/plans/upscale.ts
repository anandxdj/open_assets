/** Export upscale factors the pipeline supports. The first is the default. */
export const UPSCALE_SCALES = [2, 4] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];

/**
 * How many AI upscale passes produce each factor. The storage providers' one
 * AI upscale pass is the product's 2x; 4x chains two. Change it here if a
 * provider's single pass turns out to be a different factor.
 */
export const UPSCALE_PASSES: Record<UpscaleScale, number> = { 2: 1, 4: 2 };
