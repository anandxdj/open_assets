import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../auth/auth.middleware';
import type { AuthRequest } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import {
  adminPlanInput,
  getPlanStatus,
  listUsersForAdmin,
  setUserPlan,
  startTrial,
} from './plans.service';

const planRouter = Router();

/** Effective plan, entitlements, sheets used this month, reset date, trial status. */
planRouter.get('/plans/me', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  ApiResponse.ok(res, 'Plan', await getPlanStatus(req.user.id));
}));

/** Starts the 14-day Pro trial. Once per account. */
planRouter.post('/plans/trial', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  ApiResponse.ok(res, 'Trial started', await startTrial(req.user.id));
}));

const setPlanSchema = z.object({
  plan: z.enum(['free', 'pro']),
  /** Days of Pro from now. Omit or null for Pro with no end date. */
  days: z.number().int().min(1).max(3650).nullish(),
});

const adminRouter = Router();
adminRouter.use('/admin', authenticate(), authorize('admin'));

adminRouter.get('/admin/users', asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = typeof req.query['q'] === 'string' ? req.query['q'].slice(0, 100) : undefined;
  const limit = Number(req.query['limit']);
  const users = await listUsersForAdmin(q, Number.isFinite(limit) && limit > 0 ? limit : 25);
  ApiResponse.ok(res, 'Users', { users });
}));

adminRouter.put(
  '/admin/users/:userId/plan',
  validate(setPlanSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = String(req.params['userId'] ?? '');
    if (!/^[a-f0-9]{24}$/i.test(userId)) throw ApiError.badRequest('Invalid user id');
    const { plan, days } = req.body as z.infer<typeof setPlanSchema>;
    const status = await setUserPlan(userId, adminPlanInput(plan, days));
    console.log(`[admin] ${req.user?.email} set plan=${plan}${days ? ` days=${days}` : ''} for user ${userId}`);
    ApiResponse.ok(res, 'Plan updated', status);
  }),
);

export { planRouter, adminRouter };
