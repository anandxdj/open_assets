export type StorageProviderName = 'cloudinary' | 'imagekit' | 'local';

export interface StorageStatus {
  provider: StorageProviderName;
  /** True when every credential the active provider needs is present. */
  configured: boolean;
  /** Names of the missing environment variables (empty when configured). */
  missing: string[];
  /**
   * True when the provider can run the AI transforms (upscale, background
   * removal) that AI enhance is built on. Local storage cannot: it only has a
   * plain resize and flat-colour keying, which the extract pipeline uses.
   */
  supportsAi: boolean;
}

const REQUIRED_ENV: Record<StorageProviderName, string[]> = {
  cloudinary: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  imagekit: ['IMAGEKIT_PRIVATE_KEY', 'IMAGEKIT_URL_ENDPOINT'],
  local: [],
};

export function resolveProviderName(env: NodeJS.ProcessEnv = process.env): StorageProviderName {
  const raw = env['STORAGE_PROVIDER']?.trim();
  if (raw === 'imagekit' || raw === 'local') return raw;
  return 'cloudinary';
}

/**
 * Pure check of the active storage provider's credentials, read at call time so
 * local dev without keys degrades to a clear "not configured" state instead of a
 * failed upload.
 */
export function getStorageStatus(env: NodeJS.ProcessEnv = process.env): StorageStatus {
  const provider = resolveProviderName(env);
  const missing = REQUIRED_ENV[provider].filter((key) => !env[key]?.trim());
  return { provider, configured: missing.length === 0, missing, supportsAi: provider !== 'local' };
}
