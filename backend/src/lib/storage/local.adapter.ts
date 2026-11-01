import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { StorageAdapter, UploadOptions, UploadResult, ResourceType, EnhanceTransform, BackgroundRemovalOptions } from './interface';
import type { UpscaleScale } from '../../modules/plans/upscale';
import {
  extensionFor,
  publicUrl,
  resolveKey,
  resolveLocalStorageSettings,
  toSegments,
  type LocalStorageSettings,
} from './local.paths';
import { keyOutFlatBackground, resizeImage, StorageTransformUnsupportedError } from './local.transforms';

const FOLDER: Record<string, string> = {
  originals: 'originals',
  collections: 'collections',
  exports: 'exports',
  enhance: 'enhance',
  crops: 'crops',
};

/** Derived files (a background-removed or resized copy) live in `<key>.d/`, so deleting a file deletes them too. */
const DERIVED_SUFFIX = '.d';

/**
 * Storage on this machine's disk, for development and self-hosting without
 * Cloudinary or ImageKit keys. Files are served by the API itself at
 * `<LOCAL_STORAGE_BASE_URL>/storage/<key>` (see local.router.ts).
 *
 * The transforms are honest local equivalents, not the AI add-ons:
 *  - `applyUpscale` is a Lanczos resize to the requested size.
 *  - `applyBackgroundRemoval` keys out a flat background (and is a no-op for an
 *    image that is already transparent). Anything else is refused with a message.
 *    Pockets the border cannot reach stay, unless `removeEnclosed` is set.
 *  - `applyEnhance` is not supported: AI enhance reports "not available".
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly settings: LocalStorageSettings;

  constructor(settings: LocalStorageSettings = resolveLocalStorageSettings()) {
    this.settings = settings;
  }

  get root(): string {
    return this.settings.dir;
  }

  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    const resourceType = options.resourceType ?? 'image';
    const described = await describe(buffer, resourceType);
    const folder = FOLDER[options.folder] ?? sanitizeFolder(options.folder);
    const segments = [folder, ...toSegments(options.publicId)];
    const ext = extensionFor(described.format);
    const last = segments.pop() as string;
    segments.push(last.toLowerCase().endsWith(`.${ext}`) ? last : `${last}.${ext}`);
    const key = segments.join('/');

    const target = this.absolute(key);
    await writeAtomic(target, buffer);
    // Overwriting a file makes its derived copies stale.
    await fs.rm(`${target}${DERIVED_SUFFIX}`, { recursive: true, force: true });

    return {
      url: publicUrl(this.settings, key),
      publicId: key,
      format: described.format,
      width: described.width,
      height: described.height,
      bytes: buffer.length,
    };
  }

  async delete(publicId: string, _resourceType: ResourceType = 'image'): Promise<void> {
    const target = resolveKey(this.root, publicId);
    // A key this provider could not have produced (another provider's id, junk) has nothing to delete.
    if (!target) return;
    await removeFile(target);
    await fs.rm(`${target}${DERIVED_SUFFIX}`, { recursive: true, force: true });
    await pruneEmptyParents(path.dirname(target), this.root);
  }

  readBuffer(publicId: string): Promise<Buffer> {
    return this.read(publicId);
  }

  async applyBackgroundRemoval(publicId: string, options: BackgroundRemovalOptions = {}): Promise<string> {
    const source = await this.read(publicId);
    const removeEnclosed = options.removeEnclosed === true;
    // The two results differ, so each has its own cached file.
    const derivedKey = `${publicId}${DERIVED_SUFFIX}/${removeEnclosed ? 'nobg-enclosed' : 'nobg'}.png`;
    const cached = await this.derivedUrlIfPresent(derivedKey);
    if (cached) return cached;

    const result = await keyOutFlatBackground(source, { removeEnclosed });
    // Already transparent: the original is what the pipeline should use.
    if (result.kind === 'transparent') return publicUrl(this.settings, publicId);
    return this.writeDerived(derivedKey, result.png);
  }

  async applyUpscale(publicId: string, scale: UpscaleScale = 2, sourceWidth?: number): Promise<string> {
    const source = await this.read(publicId);
    const derivedKey = `${publicId}${DERIVED_SUFFIX}/x${scale}-${sourceWidth ?? 'auto'}.png`;
    const cached = await this.derivedUrlIfPresent(derivedKey);
    if (cached) return cached;

    // The providers upscale by a fixed 4x and resize to scale x sourceWidth; locally the target is the same.
    const width = sourceWidth ?? (await sharp(source, { failOn: 'none' }).metadata()).width ?? 0;
    const { png } = await resizeImage(source, width * scale);
    return this.writeDerived(derivedKey, png);
  }

  async applyEnhance(_publicId: string, _transform: EnhanceTransform): Promise<string> {
    throw new StorageTransformUnsupportedError(
      'AI enhance is not supported by local storage: it has no AI upscale or background removal. Use Cloudinary or ImageKit.',
    );
  }

  private absolute(key: string): string {
    const resolved = resolveKey(this.root, key);
    if (!resolved) throw new Error(`Invalid storage key: ${key}`);
    return resolved;
  }

  private async read(publicId: string): Promise<Buffer> {
    const target = resolveKey(this.root, publicId);
    if (!target) throw new Error(`Local storage has no file "${publicId}" (HTTP 404)`);
    try {
      return await fs.readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EISDIR') {
        throw new Error(`Local storage has no file "${publicId}" (HTTP 404)`);
      }
      throw error;
    }
  }

  private async derivedUrlIfPresent(key: string): Promise<string | null> {
    try {
      await fs.access(this.absolute(key));
      return publicUrl(this.settings, key);
    } catch {
      return null;
    }
  }

  private async writeDerived(key: string, data: Buffer): Promise<string> {
    await writeAtomic(this.absolute(key), data);
    return publicUrl(this.settings, key);
  }
}

async function describe(
  buffer: Buffer,
  resourceType: ResourceType,
): Promise<{ format?: string; width?: number; height?: number }> {
  if (resourceType === 'raw') {
    return { format: buffer.length >= 4 && buffer.readUInt32BE(0) === 0x504b0304 ? 'zip' : undefined };
  }
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    return { format: meta.format, width: meta.width, height: meta.height };
  } catch {
    // Not an image. The caller validates `format` and deletes the file.
    return {};
  }
}

function sanitizeFolder(folder: string): string {
  return toSegments(folder).join('/') || 'misc';
}

/**
 * Write beside the target and rename, so a reader never sees half a file. A folder that another
 * request just emptied and removed is created again once.
 */
async function writeAtomic(target: string, data: Buffer): Promise<void> {
  const temp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    for (let attempt = 0; ; attempt++) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.writeFile(temp, data);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || attempt >= 1) throw error;
      }
    }
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

async function removeFile(target: string): Promise<void> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isFile() || stat.isSymbolicLink()) await fs.unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Remove a now-empty per-job folder (crops/<jobId>). The top-level folders (originals, crops, ...) stay,
 * so an upload racing a delete never finds its folder gone.
 */
async function pruneEmptyParents(start: string, root: string): Promise<void> {
  let dir = start;
  while (dir !== root && path.dirname(dir) !== root && dir.startsWith(root + path.sep)) {
    try {
      await fs.rmdir(dir);
    } catch {
      return; // not empty, or already gone
    }
    dir = path.dirname(dir);
  }
}
