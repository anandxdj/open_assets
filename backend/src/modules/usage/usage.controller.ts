import type { Response } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import * as usageService from './usage.service';
import type { ConsumeInput, ListEventsQuery, RefundInput } from './dto/consume.schema';

export async function getMyUsage(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) throw ApiError.unauthorized();
  const usage = await usageService.getUsage(req.user.id);
  ApiResponse.ok(res, 'Usage', usage);
}

export async function getMyUsageEvents(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) throw ApiError.unauthorized();
  // Already coerced and defaulted by validateQuery(listEventsQuerySchema).
  const { page, limit } = req.query as unknown as ListEventsQuery;
  const events = await usageService.listEvents(req.user.id, page, limit);
  ApiResponse.ok(res, 'Usage events', events);
}

export async function consumeCredits(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) throw ApiError.unauthorized();
  const { op, model, units } = req.body as ConsumeInput;
  const result = await usageService.consume(req.user.id, op, model, units);
  ApiResponse.ok(res, 'Credits consumed', result);
}

export async function refundCredits(req: AuthRequest, res: Response): Promise<void> {
  const { eventId } = req.body as RefundInput;
  const result = await usageService.refund(eventId);
  ApiResponse.ok(res, 'Refund processed', result);
}
