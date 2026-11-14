import { z } from 'zod';

// Mirrors the password rule in auth/dto/register.schema.ts and reset-password.schema.ts.
// The 128 cap keeps absurd payloads out of bcrypt (which only reads the first 72 bytes).
const newPassword = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter and one digit');

export const updateProfileSchema = z.object({
  // Same bounds as registration.
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  // Required when the account already has a password. Google-only accounts have
  // none and omit it; the service decides which case applies.
  currentPassword: z.string().min(1, 'Current password is required').max(128).optional(),
  newPassword,
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const deleteAccountSchema = z.object({
  // Must equal the account email; compared in the service.
  confirmation: z.string().trim().min(1, 'Type your email address to confirm').max(320),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
