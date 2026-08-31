import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { Config } from '../../common/config/config';
import { consumeSchema, reconcileSchema, refundSchema } from './dto/consume.schema';
import { UsageController } from './usage.controller';

// Refund and reconcile must only be callable by the Next.js studio proxy
// (server-to-server), never by browsers — otherwise users could refund their
// own spends or forge the served-model audit trail.
function requireServiceToken(req: Request, _res: Response, next: NextFunction) {
  const expected = Config.security.internalServiceToken;
  if (!expected) return next(ApiError.internal('INTERNAL_SERVICE_TOKEN not configured'));
  if (req.headers['x-service-token'] !== expected) {
    return next(ApiError.forbidden('Invalid service token'));
  }
  next();
}

const router = Router();

router.get('/usage/me', authenticate(), asyncHandler(UsageController.getMyUsage));
router.post(
  '/usage/consume',
  authenticate(),
  validate(consumeSchema),
  asyncHandler(UsageController.consumeCredits),
);
router.post(
  '/usage/refund',
  requireServiceToken,
  validate(refundSchema),
  asyncHandler(UsageController.refundCredits),
);
router.post(
  '/usage/reconcile',
  requireServiceToken,
  validate(reconcileSchema),
  asyncHandler(UsageController.reconcileEvent),
);

export { router as usageRouter };
