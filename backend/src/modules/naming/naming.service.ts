/**
 * Which naming pattern an export uses, and who may use a custom one.
 *
 * Custom patterns are the `customNamingPatterns` entitlement (Pro). A request
 * may carry a pattern; the saved default is a user preference. Free accounts
 * always get the default pattern, which reproduces the names exports had before
 * patterns existed.
 */
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import { UserModel } from '../auth/auth.model';
import { assertEntitled, hasEntitlement } from '../plans/entitlements';
import { invalidPatternError } from './exportNames';
import { DEFAULT_PATTERN, normalizePattern, parsePattern } from './pattern';

type Requester = NonNullable<AuthRequest['user']>;

export interface ExportPreferences {
  /** The pattern exports use when a request does not name one: the saved default for Pro, else the default. */
  namingPattern: string;
  /** What is stored, or null. A lapsed Pro account keeps it but does not use it. */
  savedPattern: string | null;
}

/**
 * Checks a pattern from a request: 400 for a non-string or an invalid pattern,
 * 403 PLAN_REQUIRED when it is not the default and the plan has no custom
 * patterns. Returns the normalized pattern.
 */
export function checkRequestedPattern(user: Requester, requested: unknown): string {
  if (typeof requested !== 'string') throw ApiError.badRequest('namingPattern must be a string', 'INVALID_PATTERN');
  const pattern = normalizePattern(requested);
  if (pattern === DEFAULT_PATTERN) return DEFAULT_PATTERN;
  const parsed = parsePattern(pattern);
  // A blank pattern is a mistake for everyone, so it is a 400 before the plan check.
  if (pattern === '' && !parsed.ok) throw invalidPatternError(parsed.issues);
  assertEntitled(user, 'customNamingPatterns');
  if (!parsed.ok) throw invalidPatternError(parsed.issues);
  return parsed.pattern;
}

async function loadSavedPattern(userId: string): Promise<string | null> {
  const doc = await UserModel.findById(userId).select('exportNamingPattern').lean();
  const saved = doc?.exportNamingPattern;
  if (!saved) return null;
  // Stored values were validated on the way in; a bad one is ignored, not fatal.
  const parsed = parsePattern(saved);
  return parsed.ok ? parsed.pattern : null;
}

/**
 * The pattern for an export request. A pattern in the request wins (checked
 * and plan-gated); without one, a Pro account's saved default; otherwise the
 * default pattern.
 */
export async function resolveNamingPattern(user: Requester | undefined, requested?: unknown): Promise<string> {
  if (!user) throw ApiError.unauthorized('Not authenticated');
  if (requested !== undefined && requested !== null) return checkRequestedPattern(user, requested);
  if (!hasEntitlement(user, 'customNamingPatterns')) return DEFAULT_PATTERN;
  return (await loadSavedPattern(user.id)) ?? DEFAULT_PATTERN;
}

export async function getExportPreferences(user: Requester): Promise<ExportPreferences> {
  const savedPattern = await loadSavedPattern(user.id);
  const entitled = hasEntitlement(user, 'customNamingPatterns');
  return { namingPattern: entitled && savedPattern ? savedPattern : DEFAULT_PATTERN, savedPattern };
}

/**
 * Saves the default export pattern. `null` or the default pattern clears it
 * (always allowed: a lapsed Pro account can still reset). Anything else needs
 * the entitlement and a valid pattern.
 */
export async function saveExportPattern(user: Requester, requested: string | null): Promise<ExportPreferences> {
  const pattern = requested === null ? DEFAULT_PATTERN : checkRequestedPattern(user, requested);
  if (pattern === DEFAULT_PATTERN) {
    await UserModel.updateOne({ _id: user.id }, { $unset: { exportNamingPattern: 1 } });
  } else {
    await UserModel.updateOne({ _id: user.id }, { $set: { exportNamingPattern: pattern } });
  }
  return getExportPreferences(user);
}
