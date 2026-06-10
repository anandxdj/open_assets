import { z } from 'zod';

export const consumeSchema = z.object({
  op: z.enum(['extend', 'generate', 'scene-brief', 'prop-brief', 'tile-review', 'sprite-review']),
  model: z.string().min(1).max(120),
  units: z.number().int().min(1).max(20).optional().default(1),
});

export type ConsumeInput = z.infer<typeof consumeSchema>;

export const refundSchema = z.object({
  eventId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid eventId'),
});

export type RefundInput = z.infer<typeof refundSchema>;
