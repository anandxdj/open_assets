import type { Readable } from 'node:stream';

export type ResourceType = 'image' | 'raw';
export type StorageFolder = 'originals' | 'collections' | 'exports' | 'enhance' | 'anibuddy';

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
  /**
   * Store an object from a readable stream.
   *
   * Exists for the AniBuddy render handoff: an encoded clip is tens of megabytes,
   * and the alternative is base64 inside a JSON body — a 4/3 inflation buffered
   * simultaneously by the producer's serializer, the socket, the HTTP client and
   * `Buffer.from`. A stream hands the bytes to the provider once.
   *
   * The result is the same as `upload`'s, so callers do not branch on which one
   * they used beyond choosing it.
   */
  uploadStream(stream: Readable, options: UploadOptions): Promise<UploadResult>;
  /**
   * Read an object's original bytes back.
   *
   * The AniBuddy pipeline needs this because Node owns the adapter and Python
   * holds no storage credentials (F9 §5): the worker reads the stored sheet and
   * hands the bytes to a stage as multipart. No transformation is requested, so
   * a provider must return the object as uploaded — a re-encode here would break
   * the `contentHash` every stage is keyed on.
   */
  download(publicId: string, resourceType?: ResourceType): Promise<Buffer>;
  delete(publicId: string, resourceType?: ResourceType): Promise<void>;
  applyBackgroundRemoval(publicId: string): Promise<string>;
  applyUpscale(publicId: string): Promise<string>;
}
