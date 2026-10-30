import type { AiEnhanceJobStore } from '../../modules/enhance/aiEnhance.store';
import type { AiEnhanceJobRecord } from '../../modules/enhance/enhance.types';
import type { EnhanceTransform, StorageAdapter, UploadOptions, UploadResult } from '../../lib/storage/interface';

/** Header-only PNG: enough for the probe, never decoded. `padding` inflates the byte size. */
export function fakePng(width: number, height: number, padding = 0): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // RGBA
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([signature, ihdr, iend, Buffer.alloc(padding)]);
}

export function fakeAnimatedPng(width: number, height: number): Buffer {
  const base = fakePng(width, height);
  const actl = Buffer.alloc(20);
  actl.writeUInt32BE(8, 0);
  actl.write('acTL', 4, 'ascii');
  // Insert acTL right after IHDR (8 signature + 25 IHDR).
  return Buffer.concat([base.subarray(0, 33), actl, base.subarray(33)]);
}

export function fakeJpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function riff(chunk: Buffer): Buffer {
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(4 + chunk.length, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, chunk]);
}

export function fakeWebpLossy(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(8 + 10);
  chunk.write('VP8 ', 0, 'ascii');
  chunk.writeUInt32LE(10, 4);
  chunk[11] = 0x9d;
  chunk[12] = 0x01;
  chunk[13] = 0x2a;
  chunk.writeUInt16LE(width, 14);
  chunk.writeUInt16LE(height, 16);
  return riff(chunk);
}

export function fakeWebpLossless(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(8 + 5);
  chunk.write('VP8L', 0, 'ascii');
  chunk.writeUInt32LE(5, 4);
  chunk[8] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  chunk.writeUInt32LE(bits >>> 0, 9);
  return riff(chunk);
}

export function fakeWebpExtended(width: number, height: number, animated = false): Buffer {
  const chunk = Buffer.alloc(8 + 10);
  chunk.write('VP8X', 0, 'ascii');
  chunk.writeUInt32LE(10, 4);
  chunk[8] = animated ? 0x02 : 0x00;
  chunk.writeUIntLE(width - 1, 12, 3);
  chunk.writeUIntLE(height - 1, 15, 3);
  return riff(chunk);
}

/** In-memory stand-in for the storage adapter. Records every call. */
export class MockStorage implements StorageAdapter {
  uploads: { size: number; options: UploadOptions }[] = [];
  deleted: string[] = [];
  enhanceCalls: { publicId: string; transform: EnhanceTransform }[] = [];
  /** What `upload` reports back for the stored image; defaults to echoing nothing. */
  uploadResult: Partial<UploadResult> = {};
  enhanceError: Error | null = null;
  resultUrl = 'https://res.example.test/enhanced.png';

  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    this.uploads.push({ size: buffer.length, options });
    return {
      url: `https://res.example.test/${options.publicId}`,
      publicId: `open_assets/enhance/${options.publicId}`,
      ...this.uploadResult,
    };
  }
  async delete(publicId: string): Promise<void> {
    this.deleted.push(publicId);
  }
  async applyBackgroundRemoval(): Promise<string> {
    throw new Error('not used by AI enhance');
  }
  async applyUpscale(): Promise<string> {
    throw new Error('not used by AI enhance');
  }
  async applyEnhance(publicId: string, transform: EnhanceTransform): Promise<string> {
    this.enhanceCalls.push({ publicId, transform });
    if (this.enhanceError) throw this.enhanceError;
    return this.resultUrl;
  }
}

export class MemoryStore implements AiEnhanceJobStore {
  jobs = new Map<string, AiEnhanceJobRecord>();
  async create(record: AiEnhanceJobRecord): Promise<void> {
    this.jobs.set(record.id, { ...record });
  }
  async get(jobId: string): Promise<AiEnhanceJobRecord | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }
  async update(jobId: string, patch: Partial<AiEnhanceJobRecord>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) this.jobs.set(jobId, { ...job, ...patch });
  }
}
