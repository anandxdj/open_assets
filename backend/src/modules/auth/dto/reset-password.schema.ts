import { z } from 'zod';

export const resetPasswordSchema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter and one digit'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
