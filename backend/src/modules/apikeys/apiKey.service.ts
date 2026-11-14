import { createHash, randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { assertEntitled, assertWithinLimit, getEntitlements } from '../plans/entitlements';
import type { PlanSubject } from '../plans/plans.types';
import { ApiKeyModel } from './apiKey.model';
import type { IApiKey } from './apiKey.model';

/** Every key starts with this, so a leaked one is recognisable (and scannable). */
export const KEY_PREFIX = 'oa_live_';
/** Random characters shown in the list, after KEY_PREFIX. */
const DISPLAY_RANDOM_CHARS = 4;
/** 24 random bytes = 192 bits, written as 48 hex characters. */
const SECRET_BYTES = 24;
/** lastUsedAt is written at most this often per key, so a busy client is not a write per request. */
const LAST_USED_GRANULARITY_MS = 60_000;

/** The only fields a key is ever shown with. Never includes the secret or its hash. */
export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What creation returns: the summary plus the full key, shown exactly once. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** A new random key and the pieces that get stored. The caller keeps `key` only long enough to show it. */
export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const secret = randomBytes(SECRET_BYTES).toString('hex');
  const key = `${KEY_PREFIX}${secret}`;
  return { key, prefix: `${KEY_PREFIX}${secret.slice(0, DISPLAY_RANDOM_CHARS)}`, keyHash: hashApiKey(key) };
}

/** Cheap shape check, so obvious non-keys (session JWTs) never cost a database lookup. */
export function looksLikeApiKey(value: string): boolean {
  return /^oa_live_[0-9a-f]{48}$/.test(value);
}

type SummarySource = Pick<IApiKey, 'name' | 'prefix' | 'createdAt' | 'lastUsedAt'> & { _id: unknown };

function toSummary(doc: SummarySource): ApiKeySummary {
  return {
    id: String(doc._id),
    name: doc.name,
    prefix: doc.prefix,
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
  };
}

/**
 * The user's active (not revoked) keys, newest first. Allowed on any plan: an
 * account whose Pro period ended must still see its keys and be able to revoke them.
 */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const keys = await ApiKeyModel.find({ userId, revokedAt: { $exists: false } })
    .sort({ _id: -1 })
    .lean();
  return keys.map(toSummary);
}

/** Creates for one user run one at a time in this process, so their count checks do not interleave. */
const creating = new Map<string, Promise<unknown>>();

function oneAtATime<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const run = (creating.get(userId) ?? Promise.resolve()).then(task);
  // The queue only needs to know when this task is over, never how it ended.
  const tail: Promise<unknown> = run.then(
    () => undefined,
    () => undefined,
  ).then(() => {
    if (creating.get(userId) === tail) creating.delete(userId);
  });
  creating.set(userId, tail);
  return run;
}

/**
 * Creates a key. Free accounts get 403 PLAN_REQUIRED; Pro accounts may hold as
 * many active keys as `entitlements.apiKeys` allows, else 403 PLAN_LIMIT.
 *
 * Requests of one user are queued per process, so the count below is exact for
 * them. Other API instances cannot see that queue, so after the insert the
 * count is checked once more and the new key is deleted again if the limit was
 * overshot: no interleaving of requests can leave more than the limit active.
 * (Two requests racing on different instances may both be refused; retrying works.)
 */
export function createApiKey(user: PlanSubject & { id: string }, name: string): Promise<CreatedApiKey> {
  return oneAtATime(user.id, async () => {
    assertEntitled(user, 'apiKeys');
    const filter = { userId: user.id, revokedAt: { $exists: false } };
    assertWithinLimit(user, 'apiKeys', (await ApiKeyModel.countDocuments(filter)) + 1);

    const { key, prefix, keyHash } = generateApiKey();
    const doc = await ApiKeyModel.create({ userId: user.id, name, prefix, keyHash });

    const total = await ApiKeyModel.countDocuments(filter);
    if (total > getEntitlements(user).apiKeys) {
      await ApiKeyModel.deleteOne({ _id: doc._id });
      assertWithinLimit(user, 'apiKeys', total); // throws 403 PLAN_LIMIT
    }
    return { ...toSummary(doc), key };
  });
}

/**
 * Revokes a key. A key that is missing, already revoked or someone else's is
 * the same 404, so ids cannot be probed. Allowed on any plan.
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<{ id: string; revokedAt: string }> {
  const revokedAt = new Date();
  const result = await ApiKeyModel.updateOne(
    { _id: keyId, userId, revokedAt: { $exists: false } },
    { $set: { revokedAt } },
  );
  if (result.matchedCount === 0) throw ApiError.notFound('API key not found');
  return { id: keyId, revokedAt: revokedAt.toISOString() };
}

/** Deletes every key a user owns (account deletion). Returns how many. */
export async function deleteUserApiKeys(userId: string | Types.ObjectId): Promise<number> {
  const result = await ApiKeyModel.deleteMany({ userId });
  return result.deletedCount;
}

/** The key behind a presented secret, whether or not it is revoked. Null when unknown. */
export async function findApiKeyBySecret(key: string): Promise<IApiKey | null> {
  return ApiKeyModel.findOne({ keyHash: hashApiKey(key) });
}

/** Records use, at most once a minute per key. Never throws and never delays the request. */
export function touchLastUsed(apiKey: Pick<IApiKey, '_id' | 'lastUsedAt'>, now: Date = new Date()): void {
  if (apiKey.lastUsedAt && now.getTime() - apiKey.lastUsedAt.getTime() < LAST_USED_GRANULARITY_MS) return;
  ApiKeyModel.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: now } }).catch((err) =>
    console.error('[apikeys] could not record lastUsedAt:', err instanceof Error ? err.message : err),
  );
}
