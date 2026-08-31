import type { Readable } from 'node:stream';
import { ImageKit } from '@imagekit/nodejs';
import axios from 'axios';
import { toFile } from '@imagekit/nodejs';
import type { StorageAdapter, UploadOptions, UploadResult } from './interface';

const FOLDER: Record<string, string> = {
  originals: '/open_assets/originals',
  collections: '/open_assets/collections',
  exports: '/open_assets/exports',
  enhance: '/open_assets/enhance',
  anibuddy: '/open_assets/anibuddy',
};

const DOWNLOAD_TIMEOUT_MS = 60_000;

// publicId encoding: "fileId::filePath"
// fileId   — used for deletion (ik.files.delete)
// filePath — used for URL generation (ik.helper.buildSrc)
// Both are recoverable from the upload response with no extra API calls.
function encode(fileId: string, filePath: string): string {
  return `${fileId}::${filePath}`;
}

function decode(publicId: string): { fileId: string; filePath: string } {
  const sep = publicId.indexOf('::');
  return { fileId: publicId.slice(0, sep), filePath: publicId.slice(sep + 2) };
}

export class ImageKitAdapter implements StorageAdapter {
  private ik: ImageKit;
  private urlEndpoint: string;

  constructor() {
    this.urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT ?? '';
    this.ik = new ImageKit({ privateKey: process.env.IMAGEKIT_PRIVATE_KEY ?? '' });
  }

  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    return this.send(await toFile(buffer, options.publicId), options);
  }

  /**
   * Store an object from a stream.
   *
   * A Node `Readable` is an async iterable of chunks, which is one of the shapes
   * `toFile` accepts, so the SDK consumes it directly. ImageKit's upload endpoint
   * needs a sized file, so the bytes are still assembled once before the request —
   * what this avoids is the base64 hop and its 4/3 inflation, not every copy.
   */
  async uploadStream(stream: Readable, options: UploadOptions): Promise<UploadResult> {
    return this.send(await toFile(stream, options.publicId), options);
  }

  private async send(file: File, options: UploadOptions): Promise<UploadResult> {
    const result = await this.ik.files.upload({
      file,
      fileName: options.publicId,
      folder: FOLDER[options.folder],
      useUniqueFileName: false,
      responseFields: ['metadata'],
    });

    return {
      url: result.url ?? '',
      publicId: encode(result.fileId ?? '', result.filePath ?? ''),
      format: (result as { metadata?: { format?: string } }).metadata?.format,
      width: result.width,
      height: result.height,
      bytes: result.size,
    };
  }

  async download(publicId: string): Promise<Buffer> {
    // Untransformed src: ImageKit then streams the original file, which is what
    // keeps a re-read hashing to the `contentHash` it was stored under.
    const { filePath } = decode(publicId);
    const url = this.ik.helper.buildSrc({ src: filePath, urlEndpoint: this.urlEndpoint });
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    return Buffer.from(res.data);
  }

  async delete(publicId: string): Promise<void> {
    const { fileId } = decode(publicId);
    if (fileId) await this.ik.files.delete(fileId);
  }

  async applyBackgroundRemoval(publicId: string): Promise<string> {
    const { filePath } = decode(publicId);
    const url = this.ik.helper.buildSrc({
      src: filePath,
      urlEndpoint: this.urlEndpoint,
      transformation: [{ aiRemoveBackground: true }],
    });
    await warmup(url);
    return url;
  }

  async applyUpscale(publicId: string): Promise<string> {
    const { filePath } = decode(publicId);
    // Upscale first, then remove background (upscale flattens alpha channel).
    const url = this.ik.helper.buildSrc({
      src: filePath,
      urlEndpoint: this.urlEndpoint,
      transformation: [{ aiUpscale: true }, { aiRemoveBackground: true }],
    });
    await warmup(url);
    return url;
  }
}

// Fire a GET to trigger CDN transform caching; swallowed — URL is valid regardless.
async function warmup(url: string): Promise<void> {
  try {
    await axios.get(url, { validateStatus: () => true, timeout: 60_000 });
  } catch {
    // non-fatal
  }
}
