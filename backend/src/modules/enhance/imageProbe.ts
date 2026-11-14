import type { AiEnhanceImageFormat } from './enhance.types';

export interface ImageProbe {
  format: AiEnhanceImageFormat;
  width: number;
  height: number;
  /** Animated PNG or WebP. Providers don't upscale animated images. */
  animated: boolean;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Read format and pixel size from the file header, so the request can be
 * validated before a byte reaches object storage. The browser-supplied MIME
 * type and file name are never trusted. Returns null when the bytes are not a
 * PNG, JPEG or WebP, or the header is truncated.
 */
export function probeImage(buffer: Buffer): ImageProbe | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return probePng(buffer);
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) return probeJpeg(buffer);
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return probeWebp(buffer);
  }
  return null;
}

function probePng(buffer: Buffer): ImageProbe | null {
  let width = 0;
  let height = 0;
  let animated = false;
  let offset = 8;
  // Chunks are length(4) type(4) data crc(4). IHDR is first; acTL (animation)
  // must precede the first IDAT, so scanning stops there.
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      if (offset + 16 > buffer.length) return null;
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    } else if (type === 'acTL') {
      animated = true;
    } else if (type === 'IDAT' || type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  return width > 0 && height > 0 ? { format: 'png', width, height, animated } : null;
}

function probeJpeg(buffer: Buffer): ImageProbe | null {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1] as number;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    // Markers without a length: TEM, RSTn, SOI.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return null; // EOI before any frame header
    const length = buffer.readUInt16BE(offset + 2);
    // SOF0..SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { format: 'jpeg', width, height, animated: false } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function probeWebp(buffer: Buffer): ImageProbe | null {
  const fourcc = buffer.toString('ascii', 12, 16);
  const data = 20; // RIFF(4) size(4) WEBP(4) fourcc(4) chunkSize(4)
  if (fourcc === 'VP8X') {
    if (buffer.length < data + 10) return null;
    const animated = ((buffer[data] as number) & 0x02) !== 0;
    const width = 1 + buffer.readUIntLE(data + 4, 3);
    const height = 1 + buffer.readUIntLE(data + 7, 3);
    return { format: 'webp', width, height, animated };
  }
  if (fourcc === 'VP8 ') {
    if (buffer.length < data + 10) return null;
    // Frame tag (3 bytes) then the 9D 01 2A start code, then 14-bit sizes.
    if (buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) return null;
    const width = buffer.readUInt16LE(data + 6) & 0x3fff;
    const height = buffer.readUInt16LE(data + 8) & 0x3fff;
    return width > 0 && height > 0 ? { format: 'webp', width, height, animated: false } : null;
  }
  if (fourcc === 'VP8L') {
    if (buffer.length < data + 5 || buffer[data] !== 0x2f) return null;
    const b1 = buffer[data + 1] as number;
    const b2 = buffer[data + 2] as number;
    const b3 = buffer[data + 3] as number;
    const b4 = buffer[data + 4] as number;
    const width = 1 + (b1 | ((b2 & 0x3f) << 8));
    const height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
    return { format: 'webp', width, height, animated: false };
  }
  return null;
}
