import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserModel } from '../auth/auth.model';
import type { AuthRequest } from '../auth/auth.middleware';
import { findApiKeyBySecret, looksLikeApiKey, touchLastUsed } from '../apikeys/apiKey.service';
import { assertEntitled } from '../plans/entitlements';
import { v1Error } from './v1.errors';

/** A request that passed API-key authentication. `user` is the key's owner, shaped like a web session's. */
export interface ApiKeyRequest extends AuthRequest {
  apiKey?: { id: string; name: string; prefix: string };
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/**
 * Authentication for `/api/v1`: `Authorization: Bearer oa_live_…` and nothing
 * else. The session cookie and web access tokens are deliberately not looked
 * at, so a page that can already act as the signed-in user (CSRF, a leaked
 * browser token) cannot reach the public API, and a leaked API key cannot
 * reach the web API either (`authenticate()` only verifies JWTs).
 *
 * - 401 API_KEY_MISSING / API_KEY_INVALID / API_KEY_REVOKED
 * - 403 PLAN_REQUIRED when the owner's Pro period has ended: the key stays
 *   listed in Settings but stops working until the plan is back.
 *
 * On success `req.user` is the owner (same shape `authenticate()` sets), so the
 * existing controllers and plan checks run unchanged, and `req.apiKey` names the key.
 */
export const authenticateApiKey: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  void run(req as ApiKeyRequest).then(() => next(), next);
};

async function run(req: ApiKeyRequest): Promise<void> {
  const header = req.headers.authorization;
  const presented = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
  if (!presented) {
    throw v1Error(401, 'API_KEY_MISSING', 'Send your API key as "Authorization: Bearer oa_live_…".');
  }
  // A web session token (a JWT) fails this shape check, so it never costs a lookup.
  if (!looksLikeApiKey(presented)) {
    throw v1Error(401, 'API_KEY_INVALID', 'That is not an OpenAssets API key. Web session tokens do not work on /api/v1.');
  }

  const apiKey = await findApiKeyBySecret(presented);
  if (!apiKey) throw v1Error(401, 'API_KEY_INVALID', 'API key not recognised.');
  if (apiKey.revokedAt) throw v1Error(401, 'API_KEY_REVOKED', 'This API key was revoked.');

  const user = await UserModel.findById(apiKey.userId);
  if (!user) throw v1Error(401, 'API_KEY_INVALID', 'API key not recognised.');

  // Throws 403 PLAN_REQUIRED once the owner is no longer on a plan with API keys.
  assertEntitled(user, 'apiKeys');

  touchLastUsed(apiKey);
  req.user = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    plan: user.plan,
    ...(user.trialEndsAt ? { trialEndsAt: user.trialEndsAt } : {}),
  };
  req.apiKey = { id: String(apiKey._id), name: apiKey.name, prefix: apiKey.prefix };
}
