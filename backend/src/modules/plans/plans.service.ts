import type { Types } from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import type { IUser } from '../auth/auth.model';
import { getStorageStatus, type StorageStatus } from '../../lib/storage/status';
import { getEffectivePlan, getEntitlements } from './entitlements';
import { nextResetDate, periodKey, getSheetsUsed } from './sheetUsage.service';
import { SheetUsageModel } from './sheetUsage.model';
import { TRIAL_DAYS } from './plans.types';
import type { EffectivePlan, Entitlements, PlanSource, StoredPlan } from './plans.types';

const DAY_MS = 24 * 60 * 60 * 1000;

type PlanFields = Pick<IUser, 'plan' | 'planSource' | 'planUpdatedAt' | 'trialEndsAt' | 'trialStartedAt'>;

export interface PlanStatus {
  /** The stored plan. Do not gate features on it; use effectivePlan. */
  plan: StoredPlan;
  effectivePlan: EffectivePlan;
  planSource: PlanSource | null;
  entitlements: Entitlements;
  sheets: {
    used: number;
    /** null = unlimited. */
    limit: number | null;
    /** null = unlimited. */
    remaining: number | null;
    /** `YYYY-MM` (UTC). */
    period: string;
    /** When the allowance resets, ISO 8601. */
    resetAt: string;
  };
  trial: {
    /** Total length of the trial, in days. */
    days: number;
    /** A trial was started on this account at some point. */
    used: boolean;
    /** The user is on Pro through a trial right now. */
    active: boolean;
    /** The user can start a trial right now. */
    eligible: boolean;
    startedAt: string | null;
    endsAt: string | null;
    /** Whole days left (rounded up) while active, otherwise null. */
    daysLeft: number | null;
  };
  /** End of any time-limited Pro period (trial or timed admin grant), else null. */
  proEndsAt: string | null;
  /**
   * What this server's storage provider can do, which is the same for every
   * account (unlike `entitlements`). It lives here because the export screen
   * already loads this once per session and needs it beside `maxUpscale`.
   */
  capabilities: {
    /**
     * True when the export's upscale is done by the provider's AI upscaler
     * (Cloudinary, ImageKit). False on local storage, where it is a plain
     * Lanczos resize, so the UI must not call it AI.
     */
    aiUpscale: boolean;
  };
}

function iso(date: Date | null | undefined): string | null {
  return date ? new Date(date).toISOString() : null;
}

export function buildPlanStatus(
  user: PlanFields,
  sheetsUsed: number,
  now: Date = new Date(),
  /** Read from the environment when omitted; tests pass it to pin the provider. */
  storage: Pick<StorageStatus, 'supportsAi'> = getStorageStatus(),
): PlanStatus {
  const effectivePlan = getEffectivePlan(user, now);
  const entitlements = getEntitlements(user, now);
  const limit = entitlements.sheetsPerMonth;
  const endsAt = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
  const trialActive = effectivePlan === 'pro' && user.planSource === 'trial';
  const trialUsed = Boolean(user.trialStartedAt) || user.planSource === 'trial';
  const proEndsAt = effectivePlan === 'pro' && endsAt ? endsAt : null;

  return {
    plan: user.plan ?? 'free',
    effectivePlan,
    planSource: user.planSource ?? null,
    entitlements,
    sheets: {
      used: sheetsUsed,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - sheetsUsed),
      period: periodKey(now),
      resetAt: nextResetDate(now).toISOString(),
    },
    trial: {
      days: TRIAL_DAYS,
      used: trialUsed,
      active: trialActive,
      eligible: !trialUsed && effectivePlan === 'free',
      startedAt: iso(user.trialStartedAt),
      endsAt: iso(user.planSource === 'trial' ? endsAt : null),
      daysLeft: trialActive && endsAt ? Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)) : null,
    },
    proEndsAt: iso(proEndsAt),
    capabilities: { aiUpscale: storage.supportsAi },
  };
}

export async function getPlanStatus(userId: string, now: Date = new Date()): Promise<PlanStatus> {
  const user = await UserModel.findById(userId)
    .select('plan planSource planUpdatedAt trialEndsAt trialStartedAt')
    .lean();
  if (!user) throw ApiError.notFound('User not found');
  return buildPlanStatus(user, await getSheetsUsed(userId, now), now);
}

/**
 * Starts the 14-day Pro trial. Once per account, atomic: the update only
 * matches while no trial has started and the user is not already on Pro, so two
 * simultaneous requests cannot both win.
 */
export async function startTrial(userId: string, now: Date = new Date()): Promise<PlanStatus> {
  const endsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  const started = await UserModel.findOneAndUpdate(
    {
      _id: userId,
      trialStartedAt: null,
      $nor: [{ plan: 'pro', $or: [{ trialEndsAt: null }, { trialEndsAt: { $gt: now } }] }],
    },
    {
      $set: {
        plan: 'pro',
        planSource: 'trial',
        planUpdatedAt: now,
        trialStartedAt: now,
        trialEndsAt: endsAt,
      },
    },
    { new: true },
  );

  if (!started) {
    const user = await UserModel.findById(userId).select('plan trialEndsAt trialStartedAt').lean();
    if (!user) throw ApiError.notFound('User not found');
    if (getEffectivePlan(user, now) === 'pro') {
      throw new ApiError(409, 'You already have Pro.', 'ALREADY_PRO');
    }
    throw new ApiError(409, 'The Pro trial has already been used on this account.', 'TRIAL_USED');
  }
  return getPlanStatus(userId, now);
}

export interface SetPlanInput {
  plan: 'free' | 'pro';
  source: PlanSource;
  /**
   * When Pro ends. Omit or null for no end date (permanent Pro, until changed).
   * A billing webhook passes the paid-through date here.
   */
  endsAt?: Date | null;
}

/**
 * Sets a user's plan. Admin grants and a future billing webhook both go
 * through here; neither writes the plan fields on its own. `trialStartedAt` is
 * only ever set by the trial flow and is kept when the plan changes, so a used
 * trial stays used.
 */
export async function setUserPlan(
  userId: string | Types.ObjectId,
  input: SetPlanInput,
  now: Date = new Date(),
): Promise<PlanStatus> {
  const set: Record<string, unknown> = {
    plan: input.plan,
    planSource: input.source,
    planUpdatedAt: now,
  };
  const unset: Record<string, 1> = {};
  if (input.plan === 'pro' && input.endsAt) set['trialEndsAt'] = input.endsAt;
  else unset['trialEndsAt'] = 1;

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true },
  );
  if (!user) throw ApiError.notFound('User not found');
  return getPlanStatus(String(user._id), now);
}

/** Admin shape: `days` of Pro from now, or permanent when omitted. */
export function adminPlanInput(plan: 'free' | 'pro', days: number | null | undefined, now: Date = new Date()): SetPlanInput {
  if (plan === 'pro' && days) {
    return { plan, source: 'admin', endsAt: new Date(now.getTime() + days * DAY_MS) };
  }
  return { plan, source: 'admin', endsAt: null };
}

export async function setPlanByEmail(
  email: string,
  plan: 'free' | 'pro',
  days?: number | null,
  now: Date = new Date(),
): Promise<{ email: string; status: PlanStatus }> {
  const user = await UserModel.findOne({ email: email.trim().toLowerCase() }).select('_id email');
  if (!user) throw ApiError.notFound(`No user with email ${email}`);
  const status = await setUserPlan(user._id as Types.ObjectId, adminPlanInput(plan, days, now), now);
  return { email: user.email, status };
}

export async function grantAdminByEmail(email: string): Promise<{ email: string; changed: boolean }> {
  const user = await UserModel.findOne({ email: email.trim().toLowerCase() }).select('_id email role');
  if (!user) throw ApiError.notFound(`No user with email ${email}`);
  if (user.role === 'admin') return { email: user.email, changed: false };
  await UserModel.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
  return { email: user.email, changed: true };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  isVerified: boolean;
  createdAt: string | null;
  plan: StoredPlan;
  effectivePlan: EffectivePlan;
  planSource: PlanSource | null;
  proEndsAt: string | null;
  trialUsed: boolean;
  sheetsThisMonth: number;
}

/** Admin user list. `q` matches email or name, case-insensitive, as plain text. */
export async function listUsersForAdmin(
  q: string | undefined,
  limit = 25,
  now: Date = new Date(),
): Promise<AdminUserRow[]> {
  const term = q?.trim();
  const filter = term
    ? { $or: [{ email: { $regex: escapeRegex(term), $options: 'i' } }, { name: { $regex: escapeRegex(term), $options: 'i' } }] }
    : {};
  const users = await UserModel.find(filter)
    .select('email name role isVerified createdAt plan planSource trialEndsAt trialStartedAt')
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(1, limit), 100))
    .lean();

  const usage = await SheetUsageModel.find({
    userId: { $in: users.map((u) => u._id) },
    period: periodKey(now),
  })
    .select('userId count')
    .lean();
  const used = new Map(usage.map((row) => [String(row.userId), row.count]));

  return users.map((u) => {
    const status = buildPlanStatus(u, 0, now);
    return {
      id: String(u._id),
      email: u.email,
      name: u.name,
      role: u.role,
      isVerified: u.isVerified,
      createdAt: iso((u as { createdAt?: Date }).createdAt),
      plan: status.plan,
      effectivePlan: status.effectivePlan,
      planSource: status.planSource,
      proEndsAt: status.proEndsAt,
      trialUsed: status.trial.used,
      sheetsThisMonth: used.get(String(u._id)) ?? 0,
    };
  });
}
