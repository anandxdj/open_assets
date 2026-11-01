import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

const isProduction = process.env.NODE_ENV === 'production';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || (isProduction ? '' : 'access-secret');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (isProduction ? '' : 'refresh-secret');

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  if (isProduction) {
    throw new Error('JWT secrets must be set in production!');
  }
}

const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Signs an access token. Besides the standard `iat` (whole seconds) it carries
 * `iatMs`, the issue time in milliseconds: `user.tokensValidAfter` is compared
 * against it, so a token minted a moment after "sign out everywhere" or a
 * password change stays valid while every earlier one is dead, even within the
 * same second. Pass `issuedAt` only to stamp a token with the exact instant a
 * revocation was recorded (the caller's own fresh session).
 */
export const generateAccessToken = (payload: object, issuedAt: Date = new Date()) => {
  return jwt.sign({ ...payload, iatMs: issuedAt.getTime() }, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN as any,
  });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, JWT_ACCESS_SECRET) as any;
};

/**
 * True when an access token was issued before the user's `tokensValidAfter`
 * (set by "sign out everywhere" and by password changes and resets). Tokens
 * minted before `iatMs` existed fall back to `iat`, which only has second
 * precision and therefore rounds down: the safe direction.
 */
export const isAccessTokenRevoked = (
  decoded: { iat?: number; iatMs?: number },
  tokensValidAfter: Date | null | undefined,
): boolean => {
  if (!tokensValidAfter) return false;
  const issuedAtMs = typeof decoded.iatMs === 'number' ? decoded.iatMs : (decoded.iat ?? 0) * 1000;
  return issuedAtMs < tokensValidAfter.getTime();
};

export const generateRefreshToken = (payload: object) => {
  // A unique `jti` keeps two sign-ins in the same second from minting the same
  // token, which would collapse two sessions into one hash.
  return jwt.sign({ jti: crypto.randomUUID(), ...payload }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN as any,
  });
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as any;
};

export const generateResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  return { rawToken, hashedToken };
};

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
