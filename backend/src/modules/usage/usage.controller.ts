import type { Response } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import { UsageService } from './usage.service';
import type { ConsumeInput, ReconcileInput, RefundInput } from './dto/consume.schema';

// asyncHandler already forwards rejections, but credit failures are the ones
// worth naming in the log — a silent 500 here is a user who paid and got
// nothing. Each handler logs its op context, then rethrows untouched so the
// error middleware still owns the response shape.
export const UsageController = {
  async getMyUsage(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    try {
      // Call to service
      const usage = await UsageService.getUsage(req.user.id);
      ApiResponse.ok(res, 'Usage', usage);
    } catch (error) {
      console.error('[usage] balance lookup failed', { userId: req.user.id, error });
      throw error;
    }
  },

  async consumeCredits(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const { op, model, units } = req.body as ConsumeInput;
    try {
      // Call to service
      const result = await UsageService.consume(req.user.id, op, model, units);
      ApiResponse.ok(res, 'Credits consumed', result);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[usage] consume failed', { userId: req.user.id, op, model, units, error });
      }
      throw error;
    }
  },

  async refundCredits(req: AuthRequest, res: Response): Promise<void> {
    const { eventId } = req.body as RefundInput;
    try {
      // Call to service
      const result = await UsageService.refund(eventId);
      ApiResponse.ok(res, 'Refund processed', result);
    } catch (error) {
      console.error('[usage] refund failed', { eventId, error });
      throw error;
    }
  },

  async reconcileEvent(req: AuthRequest, res: Response): Promise<void> {
    const { eventId, model, provider } = req.body as ReconcileInput;
    try {
      // Call to service
      const result = await UsageService.reconcile(eventId, model, provider);
      ApiResponse.ok(res, 'Usage event reconciled', result);
    } catch (error) {
      console.error('[usage] reconcile failed', { eventId, model, provider, error });
      throw error;
    }
  },
};
