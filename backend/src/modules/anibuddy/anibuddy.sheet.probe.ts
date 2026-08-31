// Reads a sheet's real container format and pixel dimensions out of its own
// first bytes.
//
// It exists because neither of the two things otherwise available can be
// trusted. Multer's `fileFilter` reads the *client-declared* Content-Type, so a
// PDF announced as `image/png` walks straight through it. The storage provider
// reports width and height, but only after the bytes have already been uploaded,
// and only when that provider decoded them — the CI path has no provider at all.
//
// Getting the numbers right is load-bearing rather than cosmetic:
// `AssetRef.width`/`height` are declared in SOURCE PIXELS (F9 §6) and every mask
// the decompose stage writes is resolved against them, so a wrong pair here
// shears every part in the resulting rig.
//
// No decode, no dependency: the header of each of the three accepted formats
// states its own size, and reading it is a dozen bytes of arithmetic.

import { AniBuddyConstants } from './anibuddy.constants';

export type AniBuddySheetMimeType = (typeof AniBuddyConstants.asset.mimeTypes)[number];

export interface AniBuddySheetProbeOk {
  ok: true;
  mimeType: AniBuddySheetMimeType;
  width: number;
  height: number;
  byteLength: number;
}

export interface AniBuddySheetProbeFailure {
  ok: false;
  /** A user-facing sentence. Callers surface it verbatim. */
  reason: string;
}

export type AniBuddySheetProbeResult = AniBuddySheetProbeOk | AniBuddySheetProbeFailure;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// JPEG markers that carry no length field, so a scan must step over them rather
// than read a segment size that is not there.
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

// Start-of-frame markers, across baseline, extended, progressive and lossless.
// 0xC4 (DHT), 0xC8 (JPG) and 0xCC (DAC) are deliberately absent — they sit
// inside the same numeric range and are not frame headers.
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export const AniBuddySheetProbe = {
  // Internal method
  _png(buffer: Buffer): AniBuddySheetProbeResult {
    // 8-byte signature, then a length + "IHDR" chunk header, then the size.
    if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
      return { ok: false, reason: 'That PNG is truncated before its header.' };
    }
    return this._sized('image/png', buffer.readUInt32BE(16), buffer.readUInt32BE(20), buffer.length);
  },

  // Internal method
  _jpeg(buffer: Buffer): AniBuddySheetProbeResult {
    let offset = 2;
    while (offset + 1 < buffer.length) {
      // Fill bytes: any number of 0xFF may pad the gap before a marker.
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1] ?? 0;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (JPEG_STANDALONE_MARKERS.has(marker)) {
        offset += 2;
        continue;
      }
      if (JPEG_SOF_MARKERS.has(marker)) {
        if (offset + 9 > buffer.length) break;
        return this._sized(
          'image/jpeg',
          buffer.readUInt16BE(offset + 7),
          buffer.readUInt16BE(offset + 5),
          buffer.length,
        );
      }
      if (offset + 4 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset + 2);
      // A zero or one-byte segment length cannot advance the scan, and a file
      // that claims one is malformed rather than merely unusual.
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
    return { ok: false, reason: 'That JPEG carries no frame header, so its size is unreadable.' };
  },

  // Internal method
  _webp(buffer: Buffer): AniBuddySheetProbeResult {
    const chunk = buffer.toString('ascii', 12, 16);

    // Lossy: a 3-byte frame tag, the 0x9D 0x01 0x2A sync code, then two 14-bit
    // dimensions. The upper two bits of each are a scaling hint, not size.
    if (chunk === 'VP8 ') {
      if (buffer.length < 30) return this._webpTruncated();
      return this._sized(
        'image/webp',
        buffer.readUInt16LE(26) & 0x3fff,
        buffer.readUInt16LE(28) & 0x3fff,
        buffer.length,
      );
    }

    // Lossless: a 0x2F signature byte, then width-1 and height-1 packed into
    // 14 bits each of one little-endian word.
    if (chunk === 'VP8L') {
      if (buffer.length < 25) return this._webpTruncated();
      const bits = buffer.readUInt32LE(21);
      return this._sized(
        'image/webp',
        (bits & 0x3fff) + 1,
        ((bits >>> 14) & 0x3fff) + 1,
        buffer.length,
      );
    }

    // Extended: the canvas size, which is the one that matters — an animated or
    // alpha-carrying WebP's sub-frames may be smaller than the canvas the
    // pipeline treats as the sheet.
    if (chunk === 'VP8X') {
      if (buffer.length < 30) return this._webpTruncated();
      return this._sized(
        'image/webp',
        buffer.readUIntLE(24, 3) + 1,
        buffer.readUIntLE(27, 3) + 1,
        buffer.length,
      );
    }

    return { ok: false, reason: `That WebP uses an unsupported bitstream (${chunk.trim()}).` };
  },

  // Internal method
  _webpTruncated(): AniBuddySheetProbeFailure {
    return { ok: false, reason: 'That WebP is truncated before its size header.' };
  },

  // Internal method — one place enforces the edge bounds, so all three formats
  // refuse identically.
  _sized(
    mimeType: AniBuddySheetMimeType,
    width: number,
    height: number,
    byteLength: number,
  ): AniBuddySheetProbeResult {
    const { minEdge, maxEdge } = AniBuddyConstants.asset;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      return { ok: false, reason: 'That image reports no usable pixel dimensions.' };
    }
    if (width < minEdge || height < minEdge) {
      return {
        ok: false,
        reason: `That sheet is ${width}×${height}px. Each side must be at least ${minEdge}px.`,
      };
    }
    if (width > maxEdge || height > maxEdge) {
      return {
        ok: false,
        reason: `That sheet is ${width}×${height}px. Neither side may exceed ${maxEdge}px.`,
      };
    }
    return { ok: true, mimeType, width, height, byteLength };
  },

  /**
   * Identify and measure a source sheet from its bytes.
   *
   * Returns a reason rather than throwing, so the route can decide the status
   * code and the same function is usable from a test without an Express shell.
   */
  inspect(buffer: Buffer): AniBuddySheetProbeResult {
    if (buffer.length === 0) {
      return { ok: false, reason: 'That file is empty.' };
    }
    if (buffer.length > AniBuddyConstants.asset.maxBytes) {
      const megabytes = Math.floor(AniBuddyConstants.asset.maxBytes / (1024 * 1024));
      return { ok: false, reason: `That sheet is larger than ${megabytes} MB.` };
    }
    if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return this._png(buffer);
    }
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return this._jpeg(buffer);
    }
    if (
      buffer.length >= 16 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return this._webp(buffer);
    }
    return {
      ok: false,
      reason: `That file is not a PNG, WebP or JPEG. Accepted types: ${AniBuddyConstants.asset.mimeTypes.join(', ')}.`,
    };
  },
};
