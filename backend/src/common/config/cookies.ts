import type { CookieOptions } from 'express';
import { getConfig } from './env';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Options for the refresh-token cookie. `secure`, `sameSite` and `domain` come
 * from COOKIE_SECURE, COOKIE_SAMESITE and COOKIE_DOMAIN (see env.ts for the
 * defaults and the rule that SameSite=None needs Secure).
 */
export function sessionCookieOptions(): CookieOptions {
  const { secure, sameSite, domain } = getConfig().cookie;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    ...(domain ? { domain } : {}),
    maxAge: SEVEN_DAYS_MS,
  };
}

/**
 * Same attributes without `maxAge`. A cookie is only removed when the clearing
 * header matches its name, path and domain, and Express turns `maxAge` into a
 * future expiry that would undo the clear.
 */
export function clearSessionCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions();
  return options;
}
