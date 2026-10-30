import type { StorageAdapter } from './interface';
import { CloudinaryAdapter } from './cloudinary.adapter';
import { ImageKitAdapter } from './imagekit.adapter';
import { LocalStorageAdapter } from './local.adapter';
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
export { StorageTransformUnsupportedError } from './local.transforms';
export type { StorageStatus, StorageProviderName } from './status';

function createAdapter(): StorageAdapter {
  const provider = resolveProviderName();
  if (provider === 'imagekit') return new ImageKitAdapter();
  if (provider === 'local') return new LocalStorageAdapter();
  return new CloudinaryAdapter();
}

export const storage: StorageAdapter = createAdapter();
