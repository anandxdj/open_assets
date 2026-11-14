import { Router } from 'express';

/** Which sign-in methods besides email this server can actually complete. Never carries a value from the env. */
export interface AuthProviders {
  google: boolean;
}

/**
 * Google sign-in works only with a client id, a client secret and a callback URL together:
 * /api/auth/google redirects to an error page when any of them is missing, so the web app
 * must not offer the button then.
 */
export function getAuthProviders(env: NodeJS.ProcessEnv = process.env): AuthProviders {
  const set = (key: string) => Boolean(env[key]?.trim());
  return {
    google: set('GOOGLE_CLIENT_ID') && set('GOOGLE_CLIENT_SECRET') && (set('GOOGLE_REDIRECT_URI') || set('GOOGLE_CALLBACK_URL')),
  };
}

// Public and unauthenticated on purpose: the sign-in page asks before anyone has a session.
export const providersRouter = Router();

providersRouter.get('/providers', (_req, res) => {
  // Short cache: the answer only changes when the operator edits the env and restarts.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ success: true, message: 'Sign-in methods', data: getAuthProviders() });
});
