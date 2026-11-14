import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { authenticate } from '../auth/auth.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { enhanceAiLimiter } from '../../common/middlewares/rateLimit';
import { startExcalibur } from './enhance.controller';
import { getAiEnhanceLimits } from './aiEnhance.limits';
import { requireStorage } from './aiEnhance.service';
import {
  createCapabilitiesHandler,
  createGetJobHandler,
  createGetResultHandler,
  createStartHandler,
  type GetAiEnhanceDeps,
} from './aiEnhance.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype.startsWith('image/') || file.mimetype === 'image/svg+xml'),
});

const AI_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Single-image upload for AI enhance. Unlike the generic uploaders this maps
 * multer's failures to JSON 4xx responses, so an oversized or wrong-type file
 * says why instead of surfacing as a 500.
 */
function aiImageUpload(): RequestHandler {
  const { maxBytes } = getAiEnhanceLimits();
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (file.mimetype === 'image/svg+xml') {
        callback(ApiError.badRequest("AI enhance doesn't take SVG. Use Cleanup to render it as a PNG."));
      } else if (!AI_MIME_TYPES.has(file.mimetype)) {
        callback(ApiError.badRequest('Provide a PNG, JPEG or WebP image.'));
      } else {
        callback(null, true);
      }
    },
  }).single('image');

  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error: unknown) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(
            ApiError.payloadTooLarge(`This file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`),
          );
        }
        return next(ApiError.badRequest('Upload a single PNG, JPEG or WebP image in the "image" field.'));
      }
      next(error);
    });
  };
}

export interface EnhanceRouterOptions {
  /** Resolves the storage, job store and queue. Loaded lazily so importing the router never opens Redis. */
  getDeps?: GetAiEnhanceDeps;
  /** Test seam: replaces the JWT check. */
  authenticate?: RequestHandler;
  /** Test seam: replaces the submit-route rate limiter. */
  aiLimiter?: RequestHandler;
}

async function loadDefaultDeps() {
  return (await import('./enhance.deps')).defaultAiEnhanceDeps;
}

export function createEnhanceRouter(options: EnhanceRouterOptions = {}): Router {
  const getDeps = options.getDeps ?? loadDefaultDeps;
  const auth = options.authenticate ?? (authenticate() as unknown as RequestHandler);
  const aiLimiter = options.aiLimiter ?? enhanceAiLimiter;

  // Fail fast, before reading the upload, when there is no storage to send it to.
  const storageGuard: RequestHandler = (_req, _res, next) => {
    getDeps()
      .then((deps) => {
        requireStorage(deps);
        next();
      })
      .catch(next);
  };

  const router = Router();
  router.post('/enhance/excalibur', authenticate(), upload.single('image'), asyncHandler(startExcalibur));

  router.get('/enhance/capabilities', auth, asyncHandler(createCapabilitiesHandler(getDeps)));
  router.post(
    '/enhance/ai',
    aiLimiter,
    auth,
    storageGuard,
    aiImageUpload(),
    asyncHandler(createStartHandler(getDeps)),
  );
  router.get('/enhance/ai/:jobId', auth, asyncHandler(createGetJobHandler(getDeps)));
  router.get('/enhance/ai/:jobId/result', auth, asyncHandler(createGetResultHandler(getDeps)));
  return router;
}

export const enhanceRouter = createEnhanceRouter();
