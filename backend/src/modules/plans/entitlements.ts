/**
 * Single source of truth for what each plan can do. Pure functions only: no
 * database, no Express. Never read `user.plan` to gate a feature; call
 * getEffectivePlan / getEntitlements so expired trials are handled once, here.
 */
import { ApiError } from '../../common/utils/ApiError';
import { ENTITLEMENT_TABLE } from './plans.types';
import type { EffectivePlan, EntitlementKey, Entitlements, PlanSubject } from './plans.types';

export { ENTITLEMENT_TABLE, TRIAL_DAYS } from './plans.types';

/** Machine codes returned in the `code` field of plan errors. */
export const PLAN_ERROR = {
  /** The feature is not part of the user's plan. */
  PLAN_REQUIRED: 'PLAN_REQUIRED',
  /** A numeric limit (API keys, upscale factor) would be exceeded. */
  PLAN_LIMIT: 'PLAN_LIMIT',
  /** The monthly sheet allowance is used up. Carries `details.resetAt`. */
  SHEET_LIMIT: 'SHEET_LIMIT',
} as const;

export const ENTITLEMENT_LABEL: Record<EntitlementKey, string> = {
  sheetsPerMonth: 'Unlimited sheets',
  maxUpscale: '4× upscale',
  paddingThresholdControls: 'Padding and threshold controls',
  customNamingPatterns: 'Custom naming patterns',
  apiKeys: 'API keys',
  teamSharing: 'Team sharing',
  teamSeats: 'Team seats',
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** True when the user has a Pro period with an end date that has passed. */
export function isProPeriodExpired(subject: PlanSubject, now: Date = new Date()): boolean {
  if (subject.plan !== 'pro') return false;
  const ends = toDate(subject.trialEndsAt);
  return ends !== null && ends.getTime() <= now.getTime();
}

/**
 * The plan the user is entitled to right now.
 * - `pro` with no end date, or an end date in the future: pro.
 * - `pro` whose `trialEndsAt` has passed (an expired trial or timed grant): free.
 * - `free`, `byok` and anything unknown: free.
 */
export function getEffectivePlan(subject: PlanSubject, now: Date = new Date()): EffectivePlan {
  if (subject.plan !== 'pro') return 'free';
  return isProPeriodExpired(subject, now) ? 'free' : 'pro';
}

/** A copy of the entitlement row for the user's effective plan. */
export function getEntitlements(subject: PlanSubject, now: Date = new Date()): Entitlements {
  return { ...ENTITLEMENT_TABLE[getEffectivePlan(subject, now)] };
}

/** Boolean keys: the flag. Numeric keys: unlimited (null) or more than zero. */
export function isEntitled(entitlements: Entitlements, key: EntitlementKey): boolean {
  const value = entitlements[key];
  if (typeof value === 'boolean') return value;
  if (value === null) return true;
  return value > 0;
}

export function hasEntitlement(subject: PlanSubject, key: EntitlementKey, now: Date = new Date()): boolean {
  return isEntitled(getEntitlements(subject, now), key);
}

export function planRequiredError(key: EntitlementKey, subject: PlanSubject, now: Date = new Date()): ApiError {
  return new ApiError(
    403,
    `${ENTITLEMENT_LABEL[key]} ${key === 'apiKeys' || key === 'customNamingPatterns' ? 'need' : 'needs'} the Pro plan.`,
    PLAN_ERROR.PLAN_REQUIRED,
    { entitlement: key, requiredPlan: 'pro', plan: getEffectivePlan(subject, now) },
  );
}

/** Throws 403 PLAN_REQUIRED unless the user's plan includes the feature. */
export function assertEntitled(subject: PlanSubject, key: EntitlementKey, now: Date = new Date()): void {
  if (!hasEntitlement(subject, key, now)) throw planRequiredError(key, subject, now);
}

/**
 * Throws 403 PLAN_LIMIT when `requested` is above the plan's limit for a
 * numeric key. `requested` is the value that would be in effect after the
 * action: for a count, existing + 1 (creating a 6th API key passes 6); for the
 * upscale factor, the factor asked for. A null limit means unlimited.
 */
export function assertWithinLimit(
  subject: PlanSubject,
  key: 'sheetsPerMonth' | 'maxUpscale' | 'apiKeys' | 'teamSeats',
  requested: number,
  now: Date = new Date(),
): void {
  const limit = getEntitlements(subject, now)[key];
  if (limit === null || requested <= limit) return;
  const message =
    key === 'maxUpscale'
      ? `Your plan exports up to ${limit}× upscale. 4× needs the Pro plan.`
      : key === 'apiKeys'
        ? limit === 0
          ? 'API keys need the Pro plan.'
          : `Your plan allows ${limit} API keys.`
        : key === 'teamSeats'
          ? limit === 0
            ? 'Team sharing needs the Pro plan.'
            : `Your plan allows ${limit} team seats, the owner included.`
          : `Your plan allows ${limit} sheets a month.`;
  throw new ApiError(403, message, PLAN_ERROR.PLAN_LIMIT, {
    entitlement: key,
    limit,
    requested,
    requiredPlan: 'pro',
    plan: getEffectivePlan(subject, now),
  });
}
