import { z } from 'zod';
import { REGISTERED_USAGE_OPS, UsageConstants } from '../usage.constants';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid eventId');

export const consumeSchema = z.object({
  op: z.enum(REGISTERED_USAGE_OPS),
  model: z.string().min(1).max(120),
  units: z
    .number()
    .int()
    .min(UsageConstants.minUnits)
    .max(UsageConstants.maxUnits)
    .optional()
    .default(UsageConstants.minUnits),
});

export type ConsumeInput = z.infer<typeof consumeSchema>;

export const refundSchema = z.object({
  eventId: objectId,
});

export type RefundInput = z.infer<typeof refundSchema>;

/**
 * Correction of the recorded model after the provider chain resolves. Cost is
 * never part of this payload — reconciliation is an audit fix, not a re-charge.
 */
export const reconcileSchema = z.object({
  eventId: objectId,
  model: z.string().min(1).max(120),
  provider: z.string().min(1).max(60),
});

export type ReconcileInput = z.infer<typeof reconcileSchema>;
