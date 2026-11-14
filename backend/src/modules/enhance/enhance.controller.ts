import axios from 'axios';
import type { Response } from 'express';
import { Resvg } from '@resvg/resvg-js';
import { ApiError } from '../../common/utils/ApiError';
import { runExcaliburEnhancement } from '../../lib/py.client';
import type { AuthRequest } from '../auth/auth.middleware';
import type { ExcaliburRecipe } from './enhance.types';

const ALLOWED_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
const MAX_SVG_DIMENSION = 12_000;
const MAX_SVG_PIXELS = 64_000_000;

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function renderSvg(svg: Buffer, scale: 1 | 2 | 3): Buffer {
  const source = svg.toString('utf8');
  if (source.includes('\ufffd') || !/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(source)) {
    throw ApiError.badRequest('Provide a valid UTF-8 SVG image.');
  }
  // This endpoint is intentionally static-only. No scripts, remote assets, XML
  // entities, animation, or HTML embedding can reach the renderer.
  if (/<\/?(?:script|foreignObject|animate(?:Motion|Transform)?|set)\b/i.test(source)
    || /<!\s*(?:doctype|entity)/i.test(source)
    || /\son[a-z]+\s*=/i.test(source)
    || /(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(source)
    || /url\s*\(\s*["']?(?!#)/i.test(source)) {
    throw ApiError.badRequest('SVGs may not contain scripts, external assets, animation, or embedded HTML.');
  }

  const probe = new Resvg(svg, { font: { loadSystemFonts: false } });
  if (!Number.isFinite(probe.width) || !Number.isFinite(probe.height)
    || probe.width < 1 || probe.height < 1
    || probe.width > MAX_SVG_DIMENSION || probe.height > MAX_SVG_DIMENSION
    || probe.width * probe.height * scale * scale > MAX_SVG_PIXELS) {
    throw ApiError.badRequest('Unsupported SVG dimensions.');
  }
  return new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { loadSystemFonts: false },
    shapeRendering: 2,
    textRendering: 2,
  }).render().asPng();
}

/**
 * What the user reads when the Python service fails. The service's own text
 * (a stack trace, "Internal Server Error", a connection error) stays in the log.
 * A 4xx from it means it rejected this image; anything else means it is down or broke.
 */
export function excaliburFailure(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  console.error('[enhance] cleanup failed:', axios.isAxiosError(error) ? (error.code ?? error.message) : error);
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    return ApiError.badRequest('Cleanup could not read this image. Try a different PNG, JPEG or WebP.', 'ENHANCE_REJECTED');
  }
  return ApiError.badGateway('Cleanup is not available right now. Try again in a moment.', 'ENHANCE_UNAVAILABLE');
}

export async function startExcalibur(req: AuthRequest, res: Response): Promise<void> {
  if (!req.file) throw ApiError.badRequest('Provide a PNG, JPEG, or WebP image.');
  if (!req.user?.id) throw ApiError.unauthorized();

  const extension = req.file.originalname.split('.').pop()?.toLowerCase();
  if (!extension || !ALLOWED_FORMATS.has(extension)) throw ApiError.badRequest('Provide a PNG, JPEG, or WebP image.');

  const background = req.body.background;
  if (background !== undefined && background !== 'transparent' && background !== 'white' && background !== 'dark') {
    throw ApiError.badRequest('background must be transparent, white, or dark.');
  }
  const requestedScale = boundedNumber(req.body.scale, 1, 1, 3);
  const recipe: ExcaliburRecipe = {
    schemaVersion: 1,
    engine: 'openassets-excalibur',
    engineVersion: '2',
    // The recipe is still canonicalized server-side, but the source stays in
    // request memory and never enters object storage on this deterministic path.
    sourceSha256: '',
    sourceKind: extension === 'svg' || req.file.mimetype === 'image/svg+xml' ? 'svg' : 'raster',
    cleanup: boundedNumber(req.body.cleanup, 2, 0, 10),
    speckRemoval: boundedNumber(req.body.speckRemoval, 1, 0, 10),
    contrast: boundedNumber(req.body.contrast, 1, 0.5, 2),
    background: background ?? 'transparent',
    scale: requestedScale >= 2.5 ? 3 : requestedScale >= 1.5 ? 2 : 1,
  };
  const crypto = await import('node:crypto');
  recipe.sourceSha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const result = recipe.sourceKind === 'svg'
    ? renderSvg(req.file.buffer, recipe.scale)
    : await runExcaliburEnhancement(req.file.buffer, req.file.mimetype, recipe).catch((error: unknown) => {
        throw excaliburFailure(error);
      });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', 'inline; filename="enhanced.png"');
  res.setHeader('X-Enhancement-Recipe', Buffer.from(JSON.stringify(recipe)).toString('base64url'));
  res.send(result);
}
