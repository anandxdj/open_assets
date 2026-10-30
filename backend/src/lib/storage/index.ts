import type { StorageAdapter } from './interface';
import { CloudinaryAdapter } from './cloudinary.adapter';
import { ImageKitAdapter } from './imagekit.adapter';
import { resolveProviderName } from './status';

export type {
  StorageAdapter,
  UploadOptions,
  UploadResult,
  StorageFolder,
  ResourceType,
  EnhanceTransform,
} from './interface';
export { getStorageStatus, resolveProviderName } from './status';
export type { StorageStatus, StorageProviderName } from './status';

function createAdapter(): StorageAdapter {
  if (resolveProviderName() === 'imagekit') return new ImageKitAdapter();
  return new CloudinaryAdapter();
}

export const storage: StorageAdapter = createAdapter();
