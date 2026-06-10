import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { consumeSchema, refundSchema } from './dto/consume.schema';
import { getMyUsage, consumeCredits, refundCredits } from './usage.controller';

// Refund must only be callable by the Next.js studio proxy (server-to-server),
// never by browsers — otherwise users could refund their own spends.
function requireServiceToken(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected) return next(ApiError.internal('INTERNAL_SERVICE_TOKEN not configured'));
  if (req.headers['x-service-token'] !== expected) {
    return next(ApiError.forbidden('Invalid service token'));
  }
  next();
}

const router = Router();

router.get('/usage/me', authenticate(), asyncHandler(getMyUsage));
router.post('/usage/consume', authenticate(), validate(consumeSchema), asyncHandler(consumeCredits));
router.post('/usage/refund', requireServiceToken, validate(refundSchema), asyncHandler(refundCredits));

export { router as usageRouter };
