import { UserModel } from './auth.model';
import type { IRefreshSession, IUser } from './auth.model';
import { hashToken } from '../../common/utils/jwt.utils';

/**
 * Refresh-token sessions.
 *
 * Each sign-in (a browser, a phone, an API login) stores its own entry in
 * `user.refreshSessions`: the sha256 of its refresh token plus createdAt,
 * lastUsedAt and a coarse device label. They live on the user document rather
 * than in a collection because the list is capped and tiny, is read together
 * with the user on every refresh, and must be cleared atomically with
 * `tokensValidAfter` by sign-out-all, password change/reset and account
 * deletion (it goes away with the user).
 *
 * Every write here is a single atomic Mongo update, so two sign-ins or two
 * refreshes at once cannot overwrite each other.
 */

/** Most concurrent sessions per user. Past this, the least recently used goes. */
export const MAX_REFRESH_SESSIONS = 10;

/** "Chrome on Linux" style label from a User-Agent header. Coarse on purpose. */
export function describeUserAgent(ua: string | undefined | null): string {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /curl\//i.test(ua) ? 'curl'
    : /node|undici|axios|python|okhttp|postman/i.test(ua) ? 'API client'
    : null;
  const os =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux|X11/.test(ua) ? 'Linux'
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

/** A session entry for a refresh token (only its hash is kept). */
export function newRefreshSession(refreshToken: string, userAgent?: string | null, now = new Date()): IRefreshSession {
  return { tokenHash: hashToken(refreshToken), createdAt: now, lastUsedAt: now, userAgent: describeUserAgent(userAgent) };
}

/** Records a new session for a freshly issued refresh token, evicting the least recently used past the cap. */
export async function addRefreshSession(userId: unknown, refreshToken: string, userAgent?: string | null): Promise<void> {
  await UserModel.updateOne(
    { _id: userId },
    {
      $push: {
        refreshSessions: {
          $each: [newRefreshSession(refreshToken, userAgent)],
          $sort: { lastUsedAt: -1 },
          $slice: MAX_REFRESH_SESSIONS,
        },
      },
    },
  );
}

/**
 * Validates a refresh token against the user's sessions and stamps that
 * session's lastUsedAt. Returns the user, or null when the token matches no
 * session (signed out, revoked, evicted, never issued).
 *
 * A user who still has the legacy single `refreshToken` field keeps that
 * session: when the token matches it, it is moved into `refreshSessions` and
 * the old field is removed, in one atomic update.
 */
export async function useRefreshSession(userId: string, refreshToken: string): Promise<IUser | null> {
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  const touch = () =>
    UserModel.findOneAndUpdate(
      { _id: userId, 'refreshSessions.tokenHash': tokenHash },
      { $set: { 'refreshSessions.$.lastUsedAt': now } },
      { new: true },
    );

  const current = await touch();
  if (current) return current;

  const legacy: IRefreshSession = { tokenHash, createdAt: now, lastUsedAt: now, userAgent: 'Earlier sign-in' };
  const migrated = await UserModel.findOneAndUpdate(
    { _id: userId, refreshToken: tokenHash },
    {
      $unset: { refreshToken: 1 },
      $push: { refreshSessions: { $each: [legacy], $sort: { lastUsedAt: -1 }, $slice: MAX_REFRESH_SESSIONS } },
    },
    { new: true },
  );
  if (migrated) return migrated;

  // Two tabs presenting the same legacy cookie at once: the other request
  // migrated it between our two queries, so the session exists now.
  return touch();
}

/** Ends the one session a refresh token belongs to (this browser's sign-out). */
export async function removeRefreshSession(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await UserModel.updateOne({ 'refreshSessions.tokenHash': tokenHash }, { $pull: { refreshSessions: { tokenHash } } });
  await UserModel.updateOne({ refreshToken: tokenHash }, { $unset: { refreshToken: 1 } });
}

/** Drops every session, a legacy token included. Access tokens are cut off separately via tokensValidAfter. */
export async function clearRefreshSessions(userId: unknown): Promise<void> {
  await UserModel.updateOne({ _id: userId }, { $set: { refreshSessions: [] }, $unset: { refreshToken: 1 } });
}
