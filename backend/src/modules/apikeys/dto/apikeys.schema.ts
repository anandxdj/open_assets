import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Name your key').max(60, 'Name must be at most 60 characters'),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
