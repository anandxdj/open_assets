/** Export upscale factors the pipeline supports. The first is the default. */
export const UPSCALE_SCALES = [2, 4] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];
