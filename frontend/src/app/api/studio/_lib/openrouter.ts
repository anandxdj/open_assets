/* eslint-disable @typescript-eslint/no-explicit-any -- the response walkers
   (extractImageFromAny, sanitizeForLogging) handle arbitrary provider shapes */
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Shared plumbing for every /api/studio/* route: hybrid key resolution
// (BYOK header vs server key + per-user credits via Express), refunds,
// mock mode for credit-free testing, and OpenRouter response parsing.
import type { NextRequest } from 'next/server';
import { deflateSync } from 'node:zlib';
import type { LlmMessage } from './llm/interface';
import { OpenRouterAdapter } from './llm/openrouter.adapter';

const openrouterAdapter = new OpenRouterAdapter();

export const DEFAULT_MODEL = 'google/gemini-3.1-flash-image-preview';

const EXPRESS_URL =
  process.env.EXPRESS_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

export type UsageOp =
  | 'extend'
  | 'generate'
  | 'scene-brief'
  | 'prop-brief'
  | 'tile-review'
  | 'sprite-review'
  | 'anibuddy-prompt'
  | 'anibuddy-rig';

export type KeyResolution =
  | { ok: true; key: string; byok: boolean; eventId?: string; remaining?: number }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Hybrid key model:
 * 1. `X-OpenRouter-Key` header present → BYOK. Use the user's key directly;
 *    no auth, no credits, key never persisted.
 * 2. Otherwise → free tier. Forward the Authorization header to Express,
 *    which verifies the JWT and atomically deducts credits (402 when broke).
 *    Then use the configured provider chain. Open Quota can serve the primary
 *    attempt without an OpenRouter key; that key is needed only for fallback.
 */
export async function resolveKeyAndCredits(
  request: NextRequest,
  op: UsageOp,
  model: string,
  units = 1,
): Promise<KeyResolution> {
  const byokKey = request.headers.get('x-openrouter-key')?.trim();
  if (byokKey) {
    return { ok: true, key: byokKey, byok: true };
  }

  const auth = request.headers.get('authorization');
  if (!auth) {
    return {
      ok: false,
      status: 401,
      code: 'AUTH_REQUIRED',
      error: 'Sign in to use free credits, or add your own OpenRouter key in Settings.',
    };
  }

  let consumeRes: Response;
  try {
    consumeRes = await fetch(`${EXPRESS_URL}/api/usage/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ op, model, units }),
    });
  } catch {
    return { ok: false, status: 503, error: 'Credits service unavailable. Try again shortly.' };
  }

  if (consumeRes.status === 402) {
    return {
      ok: false,
      status: 402,
      code: 'INSUFFICIENT_CREDITS',
      error: 'You are out of free credits. Add your own OpenRouter key in Settings to continue.',
    };
  }
  if (consumeRes.status === 401) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', error: 'Session expired. Sign in again.' };
  }
  if (!consumeRes.ok) {
    return { ok: false, status: 502, error: 'Failed to reserve credits.' };
  }

  const serverKey = process.env.OPENROUTER_API_KEY;
  const hasOpenQuotaKey = Boolean(process.env.OPENQUOTA_API_KEY?.trim());
  const body = (await consumeRes.json()) as { data?: { eventId?: string; remaining?: number } };
  const eventId = body?.data?.eventId;

  // Open Quota is the primary free-tier provider. The historical guard checked
  // only OpenRouter, which made every request fail with 503 before callLlm()
  // could use a valid OPENQUOTA_API_KEY.
  if (!serverKey && !hasOpenQuotaKey && !isMockMode()) {
    // Don't strand the user's credits when the server is misconfigured.
    if (eventId) await refundCredits(eventId);
    return {
      ok: false,
      status: 503,
      error: 'Free tier is not configured on this server. Add an Open Quota or OpenRouter key, or use your own OpenRouter key in Settings.',
    };
  }

  return { ok: true, key: serverKey ?? '', byok: false, eventId, remaining: body?.data?.remaining };
}

/**
 * Return credits after a non-retryable generation failure. Server-to-server
 * only — guarded by INTERNAL_SERVICE_TOKEN so browsers can't refund themselves.
 * Best-effort: a failed refund is logged, never thrown.
 */
export async function refundCredits(eventId: string): Promise<void> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) {
    console.error('[studio] refund skipped: INTERNAL_SERVICE_TOKEN not set');
    return;
  }
  try {
    const res = await fetch(`${EXPRESS_URL}/api/usage/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-token': token },
      body: JSON.stringify({ eventId }),
    });
    if (!res.ok) console.error('[studio] refund failed:', res.status, await res.text());
  } catch (err) {
    console.error('[studio] refund failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock mode — OPENROUTER_MOCK=1 returns deterministic fixtures with zero spend
// while still exercising auth + credits + the full client canvas pipeline.
// ─────────────────────────────────────────────────────────────────────────────

export function isMockMode(): boolean {
  return process.env.OPENROUTER_MOCK === '1';
}

/**
 * Minimal RGBA PNG encoder (no canvas on the server). Produces a vertical
 * gradient between two colors — enough texture for seam scoring and chroma
 * keying in the client pipeline to do real work on fixtures.
 */
export function mockPngDataUrl(
  width: number,
  height: number,
  topColor: [number, number, number] = [96, 128, 176],
  bottomColor: [number, number, number] = [40, 56, 80],
): string {
  const w = Math.max(1, Math.min(4096, Math.round(width)));
  const h = Math.max(1, Math.min(4096, Math.round(height)));

  // Scanlines: each row prefixed with filter byte 0, then RGBA pixels.
  const raw = Buffer.alloc(h * (1 + w * 4));
  let off = 0;
  for (let y = 0; y < h; y++) {
    raw[off++] = 0;
    const t = h === 1 ? 0 : y / (h - 1);
    const r = Math.round(topColor[0] + (bottomColor[0] - topColor[0]) * t);
    const g = Math.round(topColor[1] + (bottomColor[1] - topColor[1]) * t);
    const b = Math.round(topColor[2] + (bottomColor[2] - topColor[2]) * t);
    for (let x = 0; x < w; x++) {
      raw[off++] = r;
      raw[off++] = g;
      raw[off++] = b;
      raw[off++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** Magenta-keyed fixture for parallax/tile/sprite/prop modes. */
export function mockKeyedPngDataUrl(width: number, height: number): string {
  return mockPngDataUrl(width, height, [255, 0, 255], [255, 0, 255]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter call + response parsing (shared by all routes)
// ─────────────────────────────────────────────────────────────────────────────

export type { LlmMessage as OpenRouterMessage } from './llm/interface';

/**
 * @deprecated Single-provider OpenRouter call, kept for the image routes
 * (generate, extend) which are out of scope for the Open Quota fallback chain.
 * New text/vision calls should use `callLlm` from `./llm`.
 */
export async function callOpenRouter(opts: {
  key: string;
  model: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  referer?: string | null;
}): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
  const result = await openrouterAdapter.chat({
    key: opts.key,
    model: opts.model,
    messages: opts.messages,
    maxTokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
    referer: opts.referer,
    title: 'OpenAssets Studio',
  });

  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, status: result.status, error: result.error };
}

/**
 * Walk an arbitrary OpenAI/OpenRouter response shape and pull out the first
 * image data URL we can find. Different image-output chat models put the
 * payload in different places (top-level `images[]`, `content[].image_url`,
 * inline_data, raw base64 strings, etc.) so we check all of them.
 */
export function extractImageFromAny(node: any): string | null {
  if (!node) return null;

  if (Array.isArray(node.images) && node.images.length > 0) {
    for (const img of node.images) {
      if (img?.image_url?.url) return img.image_url.url;
      if (img?.url) return img.url;
      if (img?.b64_json) return `data:image/png;base64,${img.b64_json}`;
    }
  }

  if (typeof node.b64_json === 'string' && node.b64_json.length > 100) {
    return `data:image/png;base64,${node.b64_json}`;
  }

  const content = node.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'image_url' && part?.image_url?.url) return part.image_url.url;
      if (part?.type === 'image' && part?.url) return part.url;
      if (part?.image_url?.data) return `data:image/png;base64,${part.image_url.data}`;
      if (part?.b64_json) return `data:image/png;base64,${part.b64_json}`;
      if (part?.data && typeof part.data === 'string' && part.data.length > 100) {
        return `data:image/png;base64,${part.data}`;
      }
      if (part?.inline_data?.data) {
        const mime = part.inline_data.mime_type || 'image/png';
        return `data:${mime};base64,${part.inline_data.data}`;
      }
    }
  } else if (typeof content === 'string') {
    if (content.startsWith('data:image') || content.startsWith('http')) return content;
    if (content.length > 100 && /^[A-Za-z0-9+/=]+$/.test(content.substring(0, 100))) {
      return `data:image/png;base64,${content}`;
    }
    const urlMatch = content.match(/!\[.*?\]\((.*?)\)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];
  } else if (content && typeof content === 'object') {
    if ((content as any).data) return `data:image/png;base64,${(content as any).data}`;
    if ((content as any).inline_data?.data) {
      const mime = (content as any).inline_data.mime_type || 'image/png';
      return `data:${mime};base64,${(content as any).inline_data.data}`;
    }
  }

  return null;
}

/** Truncate base64 in nested objects so server logs stay readable. */
export function sanitizeForLogging(obj: any, depth = 0): any {
  if (depth > 10) return '[MAX_DEPTH]';
  if (typeof obj === 'string') {
    if (obj.length > 500) return `[STRING_DATA: ${obj.length} chars]`;
    if (obj.startsWith('data:image')) return `[DATA_URL: ${obj.length} chars]`;
    return obj;
  }
  if (Array.isArray(obj)) return obj.map((item) => sanitizeForLogging(item, depth + 1));
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const key in obj) {
      out[key] =
        typeof obj[key] === 'string' && obj[key].length > 500
          ? `[LONG_STRING: ${obj[key].length} chars]`
          : sanitizeForLogging(obj[key], depth + 1);
    }
    return out;
  }
  return obj;
}
