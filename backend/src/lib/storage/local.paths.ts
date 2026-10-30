import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Where the local storage provider keeps files and how a stored file's key maps
 * to a path on disk and a URL. Pure (no I/O), so the traversal rules are
 * easy to test.
 *
 * A key is the file's path under the storage directory, with forward slashes,
 * for example `originals/3f2a….png` or `crops/<jobId>/asset_001.png`. It is the
 * `publicId` the adapter returns, and it is what `delete` and the transforms
 * take back.
 */

export interface LocalStorageSettings {
  /** Absolute path of the directory files are kept in. */
  dir: string;
  /** Public URL of this API, without a trailing slash. Files are served from `${baseUrl}/storage/<key>`. */
  baseUrl: string;
}

export const LOCAL_URL_PREFIX = '/storage';

export function resolveLocalStorageSettings(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): LocalStorageSettings {
  const dir = env['LOCAL_STORAGE_DIR']?.trim() || './.local-storage';
  const port = env['PORT']?.trim() || '4000';
  const baseUrl = (env['LOCAL_STORAGE_BASE_URL']?.trim() || `http://localhost:${port}`).replace(/\/+$/, '');
  return { dir: path.resolve(cwd, dir), baseUrl };
}

const MAX_SEGMENT_LENGTH = 100;

/**
 * One path segment made safe for every filesystem: letters, digits, `.`, `_`
 * and `-` only, no leading dot (so no `.`, `..` or hidden files) and a bounded
 * length. When that changes the name, a short hash of the original is appended,
 * so two different names never end up as the same file.
 */
export function sanitizeSegment(raw: string): string {
  let clean = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, MAX_SEGMENT_LENGTH);
  if (clean === raw) return clean;
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 8);
  clean = clean.replace(/_+$/, '');
  return clean ? `${clean}-${hash}` : `x-${hash}`;
}

/** A public id from a caller ("crops/<job>/asset_001") as a list of safe segments. */
export function toSegments(publicId: string): string[] {
  return publicId
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map(sanitizeSegment);
}

/**
 * Turns a key into an absolute path inside `root`, or `null` when the key is
 * not one this provider could have produced (traversal, absolute paths, hidden
 * or empty segments, null bytes, backslashes). Nothing is read from disk here.
 */
export function resolveKey(root: string, key: string): string | null {
  if (typeof key !== 'string' || key === '' || key.length > 600) return null;
  if (key.includes('\0') || key.includes('\\') || key.startsWith('/')) return null;
  const segments = key.split('/');
  for (const segment of segments) {
    if (segment === '' || segment.startsWith('.') || segment.length > 255) return null;
  }
  const absolute = path.resolve(root, ...segments);
  if (!absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

export function publicUrl(settings: LocalStorageSettings, key: string): string {
  return `${settings.baseUrl}${LOCAL_URL_PREFIX}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** File extension (without the dot) for what was stored, from what the image decoder or magic bytes found. */
export function extensionFor(format: string | undefined): string {
  switch (format) {
    case 'png':
    case 'webp':
    case 'gif':
    case 'avif':
    case 'zip':
      return format;
    case 'jpeg':
    case 'jpg':
      return 'jpg';
    default:
      // Not something we would show in a browser (an SVG, a non-image): kept as a download-only blob.
      return 'bin';
  }
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  zip: 'application/zip',
};

export function contentTypeFor(fileName: string): string {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Only these are shown in the browser; anything else is offered as a download. */
export function isInlineType(contentType: string): boolean {
  return contentType.startsWith('image/');
}
