/**
 * Plan and entitlement types. The numbers live in entitlements.json, which is
 * mirrored byte for byte at frontend/src/lib/plans/entitlements.json (a test
 * fails when the two drift).
 */
import table from './entitlements.json';

/** What is stored on the user. `byok` concerns Studio AI keys only. */
export type StoredPlan = 'free' | 'byok' | 'pro';

/** What a user is entitled to right now. `byok` counts as `free`. */
export type EffectivePlan = 'free' | 'pro';

export type PlanSource = 'admin' | 'trial' | 'billing';

export interface Entitlements {
  /** Sheets that can be uploaded per calendar month (UTC). null = unlimited. */
  sheetsPerMonth: number | null;
  /** Highest export upscale factor. */
  maxUpscale: 2 | 4;
  /** Detection threshold and box padding controls in the editor. */
  paddingThresholdControls: boolean;
  customNamingPatterns: boolean;
  /** Most API keys an account may hold. 0 = none. */
  apiKeys: number;
  teamSharing: boolean;
}

export type EntitlementKey = keyof Entitlements;

export const ENTITLEMENT_TABLE = table.plans as Record<EffectivePlan, Entitlements>;
export const TRIAL_DAYS: number = table.trialDays;
export const DETECTION_LIMITS = table.detection;

/** Anything carrying the plan fields: a user document, a lean user or req.user. */
export interface PlanSubject {
  plan?: StoredPlan | null;
  trialEndsAt?: Date | string | null;
}
