import { z } from 'zod';

const teamName = z
  .string()
  .trim()
  .min(2, 'Team name must be at least 2 characters')
  .max(80, 'Team name must be at most 80 characters');

export const createTeamSchema = z.object({ name: teamName });
export const renameTeamSchema = z.object({ name: teamName });

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Enter an email address')
    .max(254)
    .email('Enter a valid email address'),
});

export const objectIdParam = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** Invite tokens are 32 random bytes, base64url: 43 characters. Anything else is not worth a lookup. */
export const inviteTokenParam = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invite link');

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
