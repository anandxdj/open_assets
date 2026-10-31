import type { UpscaleScale } from '../../modules/plans/upscale';

export type ResourceType = 'image' | 'raw';
export type StorageFolder = 'originals' | 'collections' | 'exports' | 'enhance' | 'crops';

export interface UploadOptions {
  folder: StorageFolder;
  publicId: string;
  resourceType?: ResourceType;
}

export interface UploadResult {
  url: string;
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

/**
 * One AI enhancement pass for the Enhance workspace. Unlike `applyUpscale`
 * (which the extract pipeline always chains with background removal), the two
 * operations are independent here.
 */
export interface EnhanceTransform {
  /**
   * AI upscale. Both providers upscale by a fixed factor, so 2x is produced by
   * resizing the upscaled result down to `sourceWidth * 2`; the output is
   * always `scale` times the source in each dimension.
   */
  upscale?: { scale: 2 | 4; sourceWidth: number };
  /** Applied after upscaling, because upscale flattens the alpha channel. */
  removeBackground?: boolean;
}

export interface BackgroundRemovalOptions {
  /**
   * Also remove background-coloured pockets the sheet border cannot reach (the hole of a ring, the inside of a
   * letter). Only the local provider acts on it: Cloudinary and ImageKit cut the subject out with AI and ignore it.
   */
  removeEnclosed?: boolean;
}

export interface StorageAdapter {
  upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;
  delete(publicId: string, resourceType?: ResourceType): Promise<void>;
  applyBackgroundRemoval(publicId: string, options?: BackgroundRemovalOptions): Promise<string>;
  /**
   * AI upscale chained with background removal (the extract export). The
   * providers upscale by a fixed 4x, so when `sourceWidth` is known the result
   * is resized to exactly `scale` times it (2 = half of the provider's 4x).
   * Without `sourceWidth` the provider's fixed factor is returned.
   */
  applyUpscale(publicId: string, scale?: UpscaleScale, sourceWidth?: number): Promise<string>;
  /**
   * Build a PNG derived URL for the requested enhancement and block until the
   * provider has produced it. Rejects when the transform fails or times out.
   */
  applyEnhance(publicId: string, transform: EnhanceTransform): Promise<string>;
}
