import type { UpscaleScale } from '../../modules/plans/upscale';

export type ResourceType = 'image' | 'raw';
export type StorageFolder = 'originals' | 'collections' | 'exports' | 'enhance';

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

export interface StorageAdapter {
  upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;
  delete(publicId: string, resourceType?: ResourceType): Promise<void>;
  applyBackgroundRemoval(publicId: string): Promise<string>;
  /** AI upscale. `scale` is the export factor: 2 = one pass (default), 4 = two. */
  applyUpscale(publicId: string, scale?: UpscaleScale): Promise<string>;
}
