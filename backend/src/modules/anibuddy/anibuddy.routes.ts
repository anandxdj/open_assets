import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { authenticate } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { uploadLimiter } from '../../common/middlewares/rateLimit';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { Config } from '../../common/config/config';
import { AniBuddyConstants } from './anibuddy.constants';
import { AniBuddyController } from './anibuddy.controller';
import { uploadAniBuddyAssetSchema } from './dto/asset.schema';
import { writeAniBuddyClipSchema } from './dto/clip.schema';
import {
  annotateAniBuddySheetSchema,
  createAniBuddyProjectSchema,
  enqueueAniBuddyCritiqueSchema,
  enqueueAniBuddyStageSchema,
} from './dto/project.schema';

const router = Router();

/**
 * Guard for the one route the Next app calls into this gateway on.
 *
 * The same secret and the same header the usage refund and reconcile routes use,
 * for the same reason: it names one trust relationship — two of our own processes —
 * and a second secret for the reverse direction of an existing one is a secret
 * nobody rotates. Fails closed when unconfigured, so a deployment that forgot it
 * gets a 500 naming the variable rather than an open internal endpoint.
 */
function requireServiceToken(req: Request, _res: Response, next: NextFunction): void {
  const expected = Config.security.internalServiceToken;
  if (!expected) {
    next(ApiError.internal('INTERNAL_SERVICE_TOKEN not configured'));
    return;
  }
  if (req.headers['x-service-token'] !== expected) {
    next(ApiError.forbidden('Invalid service token'));
    return;
  }
  next();
}

// Same shape as the detect pipeline's upload (memory storage, one file, a hard
// byte ceiling), pointed at AniBuddy's own limits. The mime filter here reads the
// CLIENT'S declared type and is only a cheap early exit; AniBuddySheetProbe reads
// the bytes and is what actually decides the format.
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AniBuddyConstants.asset.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = AniBuddyConstants.asset.mimeTypes as readonly string[];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Only ${allowed.join(', ')} sheets are accepted.`));
  },
}).single(AniBuddyConstants.asset.formField);

/**
 * Multer rejects before any handler runs, and its errors are plain `Error`s that
 * the error middleware would report as 500. Every one of them is a statement
 * about the request, so each becomes a 400 with the reason.
 */
function _receiveSheet(req: Request, res: Response, next: NextFunction): void {
  sheetUpload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      const megabytes = Math.floor(AniBuddyConstants.asset.maxBytes / (1024 * 1024));
      next(
        ApiError.badRequest(
          error.code === 'LIMIT_FILE_SIZE'
            ? `That sheet is larger than ${megabytes} MB.`
            : `Sheet upload rejected: ${error.message}`,
        ),
      );
      return;
    }
    if (error instanceof Error) {
      next(ApiError.badRequest(error.message));
      return;
    }
    next();
  });
}

router.post(
  AniBuddyConstants.routes.assets,
  uploadLimiter,
  authenticate(),
  _receiveSheet,
  validate(uploadAniBuddyAssetSchema),
  asyncHandler(AniBuddyController.uploadAsset),
);

router.post(
  AniBuddyConstants.routes.projects,
  authenticate(),
  validate(createAniBuddyProjectSchema),
  asyncHandler(AniBuddyController.createProject),
);

router.get(
  AniBuddyConstants.routes.projects,
  authenticate(),
  asyncHandler(AniBuddyController.listProjects),
);

// Polling surface for the vertical slice — SSE can wrap the same get later.
router.get(
  AniBuddyConstants.routes.project,
  authenticate(),
  asyncHandler(AniBuddyController.getProject),
);

router.post(
  AniBuddyConstants.routes.enqueue,
  authenticate(),
  validate(enqueueAniBuddyStageSchema),
  asyncHandler(AniBuddyController.enqueueStage),
);

// The closed critique loop. Its own route rather than a fifth `stage` on the enqueue
// above, because it does not pre-authorize credits: the loop charges per pass and
// refunds by failure class, so there is nothing to consume here (F9 §11.6).
router.post(
  AniBuddyConstants.routes.critique,
  authenticate(),
  validate(enqueueAniBuddyCritiqueSchema),
  asyncHandler(AniBuddyController.enqueueCritique),
);

/**
 * The one route the Next app calls INTO this gateway on.
 *
 * `authenticate()` is deliberately absent and `requireServiceToken` takes its place:
 * this is a server-to-server call from our own Next process, which has no user JWT
 * to forward at the point it makes it. It exists so the browser-adjacent app never
 * holds `INTERNAL_API_TOKEN` — the semantics vision call has to happen there, beside
 * the single provider chain, and the annotated sheet it needs can only be drawn by
 * py_backend, which only this gateway may talk to.
 */
router.post(
  AniBuddyConstants.routes.internalAnnotate,
  requireServiceToken,
  validate(annotateAniBuddySheetSchema),
  asyncHandler(AniBuddyController.annotateSheet),
);

// Clip persistence. The body is a Clip and never a document, so there is no field
// on these routes through which a client could author diagnostics or geometry.
router.post(
  AniBuddyConstants.routes.clips,
  authenticate(),
  validate(writeAniBuddyClipSchema),
  asyncHandler(AniBuddyController.createClip),
);

router.put(
  AniBuddyConstants.routes.clip,
  authenticate(),
  validate(writeAniBuddyClipSchema),
  asyncHandler(AniBuddyController.updateClip),
);

router.delete(
  AniBuddyConstants.routes.clip,
  authenticate(),
  asyncHandler(AniBuddyController.deleteClip),
);

export { router as anibuddyRouter };
