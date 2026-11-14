import axios from 'axios';
import type { Response } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import type { AuthRequest } from '../auth/auth.middleware';
import { assertWithinLimit, getEntitlements } from '../plans/entitlements';
import { getAiEnhanceLimits, parseAiEnhanceOptions, providerLabel } from './aiEnhance.limits';
import {
  aiUnavailable,
  submitAiEnhance,
  toJobResponse,
  type AiEnhanceDeps,
} from './aiEnhance.service';
import { probeImage } from './imageProbe';

export type GetAiEnhanceDeps = () => Promise<AiEnhanceDeps>;

const RESULT_FETCH_TIMEOUT_MS = 60_000;

/**
 * `GET /api/enhance/capabilities`: what AI enhance can do on this server right
 * now, so the page can degrade before the user uploads anything.
 */
export function createCapabilitiesHandler(getDeps: GetAiEnhanceDeps) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const deps = await getDeps();
    const status = deps.getStorageStatus();
    const limits = getAiEnhanceLimits(status.provider);
    const unavailable = aiUnavailable(status);
    const available = unavailable === null;
    ApiResponse.ok(res, 'Enhance capabilities', {
      provider: status.provider,
      providerLabel: providerLabel(status.provider),
      available,
      reason: unavailable?.code,
      message: unavailable?.message,
      // Variable names help whoever runs the server; users don't need them.
      missing: available || process.env['NODE_ENV'] === 'production' ? undefined : status.missing,
      operations: {
        // `scales` is what the pipeline supports; `maxScale` is what this user's plan allows.
        upscale: { scales: [2, 4], maxScale: getEntitlements(req.user ?? {}).maxUpscale },
        backgroundRemoval: true,
      },
      limits: {
        minSide: limits.minSide,
        maxSide: limits.maxSide,
        maxBytes: limits.maxBytes,
        maxUpscaleInputPixels: limits.maxUpscaleInputPixels,
        maxUpscaleOutputPixels: limits.maxUpscaleOutputPixels,
        maxBackgroundRemovalSide: limits.maxBackgroundRemovalSide,
      },
    });
  };
}

/** `POST /api/enhance/ai`: validate, store the source, queue the transform. */
export function createStartHandler(getDeps: GetAiEnhanceDeps) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) throw ApiError.unauthorized();
    if (!req.file) throw ApiError.badRequest('Provide a PNG, JPEG or WebP image.');

    const options = parseAiEnhanceOptions(req.body);
    // Plan gate: 403 PLAN_LIMIT when the factor is above the plan's maxUpscale
    // (free: 2x, Pro: 4x). Checked before anything is probed or stored.
    if (options.scale !== null) assertWithinLimit(req.user ?? {}, 'maxUpscale', options.scale);
    const probe = probeImage(req.file.buffer);
    if (!probe) throw ApiError.badRequest('Provide a PNG, JPEG or WebP image.');

    const deps = await getDeps();
    const record = await submitAiEnhance(deps, { userId, buffer: req.file.buffer, probe, options });

    res.status(202).json({ success: true, message: 'Enhancement queued', data: toJobResponse(record) });
  };
}

/** `GET /api/enhance/ai/:jobId`: poll a job. */
export function createGetJobHandler(getDeps: GetAiEnhanceDeps) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const deps = await getDeps();
    const job = await deps.store.get(req.params['jobId'] ?? '');
    if (!job) throw ApiError.notFound('Enhancement not found. It may have expired.');
    assertOwner(job.userId, req.user?.id, 'Not your enhancement');
    ApiResponse.ok(res, 'Enhancement fetched', toJobResponse(job));
  };
}

/**
 * `GET /api/enhance/ai/:jobId/result`: stream the finished PNG through the API.
 * Browsers can't send the bearer token on an <img> request and the provider's
 * host would need its own CSP entry, so the page fetches the result from here.
 */
export function createGetResultHandler(getDeps: GetAiEnhanceDeps) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const deps = await getDeps();
    const job = await deps.store.get(req.params['jobId'] ?? '');
    if (!job) throw ApiError.notFound('Enhancement not found. It may have expired.');
    assertOwner(job.userId, req.user?.id, 'Not your enhancement');
    if (job.status !== 'ready' || !job.resultUrl) {
      throw ApiError.badRequest(`The result isn't ready (status: ${job.status}).`);
    }

    // resultUrl is built by our own adapter from a server-generated id.
    const upstream = await axios
      .get(job.resultUrl, {
        responseType: 'stream',
        timeout: RESULT_FETCH_TIMEOUT_MS,
        validateStatus: () => true,
      })
      .catch(() => null);
    if (!upstream || upstream.status !== 200) {
      upstream?.data?.destroy?.();
      throw ApiError.badGateway("The result couldn't be fetched from storage. Try again in a moment.");
    }

    const contentType = String(upstream.headers['content-type'] ?? 'image/png');
    res.setHeader('Content-Type', contentType.startsWith('image/') ? contentType : 'image/png');
    const contentLength = upstream.headers['content-length'];
    if (contentLength) res.setHeader('Content-Length', String(contentLength));
    res.setHeader('Content-Disposition', 'inline; filename="enhanced.png"');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    upstream.data.on('error', () => res.destroy());
    res.on('close', () => upstream.data.destroy());
    upstream.data.pipe(res);
  };
}
