export type StorageProviderName = 'cloudinary' | 'imagekit';

export interface StorageStatus {
  provider: StorageProviderName;
  /** True when every credential the active provider needs is present. */
  configured: boolean;
  /** Names of the missing environment variables (empty when configured). */
  missing: string[];
}

const REQUIRED_ENV: Record<StorageProviderName, string[]> = {
  cloudinary: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  imagekit: ['IMAGEKIT_PRIVATE_KEY', 'IMAGEKIT_URL_ENDPOINT'],
};

export function resolveProviderName(env: NodeJS.ProcessEnv = process.env): StorageProviderName {
  return env['STORAGE_PROVIDER'] === 'imagekit' ? 'imagekit' : 'cloudinary';
}

/**
 * Pure check of the active storage provider's credentials, read at call time so
 * local dev without keys degrades to a clear "not configured" state instead of a
 * failed upload.
 */
export function getStorageStatus(env: NodeJS.ProcessEnv = process.env): StorageStatus {
  const provider = resolveProviderName(env);
  const missing = REQUIRED_ENV[provider].filter((key) => !env[key]?.trim());
  return { provider, configured: missing.length === 0, missing };
}
