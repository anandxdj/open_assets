import type { StorageAdapter } from './interface';
import { CloudinaryAdapter } from './cloudinary.adapter';
import { ImageKitAdapter } from './imagekit.adapter';

export type { StorageAdapter, UploadOptions, UploadResult, StorageFolder, ResourceType } from './interface';

function createAdapter(): StorageAdapter {
  const provider = process.env.STORAGE_PROVIDER ?? 'cloudinary';
  if (provider === 'imagekit') return new ImageKitAdapter();
  return new CloudinaryAdapter();
}

export const storage: StorageAdapter = createAdapter();
