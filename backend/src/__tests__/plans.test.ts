import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../common/utils/ApiError';
import {
  assertEntitled,
  assertWithinLimit,
  ENTITLEMENT_TABLE,
  getEffectivePlan,
  getEntitlements,
  hasEntitlement,
  PLAN_ERROR,
  TRIAL_DAYS,
} from '../modules/plans/entitlements';
import { requireEntitlement } from '../modules/plans/plans.middleware';
import { padBoxes, resolveDetectionTuning } from '../modules/plans/detectionTuning';
import { nextResetDate, periodKey } from '../modules/plans/sheetUsage.service';
import { buildPlanStatus } from '../modules/plans/plans.service';
import { parseAdminGrantArgs, parsePlanSetArgs } from '../modules/plans/cli';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-03-15T12:00:00Z');
const FREE = { plan: 'free' } as const;
const PRO = { plan: 'pro' } as const;

function codeOf(fn: () => unknown): { status: number; code?: string } {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, 'expected an ApiError');
    return { status: err.statusCode, ...(err.code ? { code: err.code } : {}) };
  }
  assert.fail('expected the call to throw');
}

// ── Entitlement table ───────────────────────────────────────────────────────

test('entitlement table: free', () => {
  assert.deepEqual(ENTITLEMENT_TABLE.free, {
    sheetsPerMonth: 5,
    maxUpscale: 2,
    paddingThresholdControls: false,
    customNamingPatterns: false,
    apiKeys: 0,
    teamSharing: false,
  });
});

test('entitlement table: pro', () => {
  assert.deepEqual(ENTITLEMENT_TABLE.pro, {
    sheetsPerMonth: null,
    maxUpscale: 4,
    paddingThresholdControls: true,
    customNamingPatterns: true,
    apiKeys: 5,
    teamSharing: true,
  });
  assert.equal(TRIAL_DAYS, 14);
});

test('the frontend mirror of the entitlement table has not drifted', (t) => {
  const mirror = path.resolve(import.meta.dirname ?? __dirname, '../../../frontend/src/lib/plans/entitlements.json');
  if (!existsSync(mirror)) return t.skip('frontend not present');
  const own = path.resolve(import.meta.dirname ?? __dirname, '../modules/plans/entitlements.json');
  assert.equal(readFileSync(mirror, 'utf8'), readFileSync(own, 'utf8'));
});

test('getEntitlements returns a copy, not the shared row', () => {
  const ent = getEntitlements(FREE, NOW);
  ent.sheetsPerMonth = 999;
  assert.equal(ENTITLEMENT_TABLE.free.sheetsPerMonth, 5);
});

// ── Effective plan ──────────────────────────────────────────────────────────

test('effective plan: pro with no end date stays pro', () => {
  assert.equal(getEffectivePlan(PRO, NOW), 'pro');
});

test('effective plan: a trial that has not ended is pro', () => {
  assert.equal(getEffectivePlan({ plan: 'pro', trialEndsAt: new Date(NOW.getTime() + DAY) }, NOW), 'pro');
});

test('effective plan: an expired trial counts as free', () => {
  const expired = { plan: 'pro', trialEndsAt: new Date(NOW.getTime() - 1000) } as const;
  assert.equal(getEffectivePlan(expired, NOW), 'free');
  assert.equal(getEntitlements(expired, NOW).sheetsPerMonth, 5);
  assert.equal(getEntitlements(expired, NOW).maxUpscale, 2);
  assert.equal(hasEntitlement(expired, 'paddingThresholdControls', NOW), false);
});

test('effective plan: the trial ends exactly at trialEndsAt', () => {
  assert.equal(getEffectivePlan({ plan: 'pro', trialEndsAt: NOW }, NOW), 'free');
});

test('effective plan: ISO strings work as end dates', () => {
  assert.equal(getEffectivePlan({ plan: 'pro', trialEndsAt: '2020-01-01T00:00:00Z' }, NOW), 'free');
  assert.equal(getEffectivePlan({ plan: 'pro', trialEndsAt: '2099-01-01T00:00:00Z' }, NOW), 'pro');
});

test('effective plan: byok and missing plans are free', () => {
  assert.equal(getEffectivePlan({ plan: 'byok' }, NOW), 'free');
  assert.equal(getEffectivePlan({}, NOW), 'free');
  assert.equal(getEffectivePlan({ plan: null }, NOW), 'free');
});

// ── Gates ───────────────────────────────────────────────────────────────────

test('assertEntitled: free is refused with 403 PLAN_REQUIRED, pro passes', () => {
  assert.deepEqual(codeOf(() => assertEntitled(FREE, 'teamSharing', NOW)), { status: 403, code: PLAN_ERROR.PLAN_REQUIRED });
  assert.deepEqual(codeOf(() => assertEntitled(FREE, 'apiKeys', NOW)), { status: 403, code: PLAN_ERROR.PLAN_REQUIRED });
  assert.doesNotThrow(() => assertEntitled(PRO, 'teamSharing', NOW));
  assert.doesNotThrow(() => assertEntitled(PRO, 'apiKeys', NOW));
});

test('assertWithinLimit: upscale and counts', () => {
  assert.doesNotThrow(() => assertWithinLimit(FREE, 'maxUpscale', 2, NOW));
  assert.deepEqual(codeOf(() => assertWithinLimit(FREE, 'maxUpscale', 4, NOW)), { status: 403, code: PLAN_ERROR.PLAN_LIMIT });
  assert.doesNotThrow(() => assertWithinLimit(PRO, 'maxUpscale', 4, NOW));
  assert.doesNotThrow(() => assertWithinLimit(PRO, 'apiKeys', 5, NOW));
  assert.deepEqual(codeOf(() => assertWithinLimit(PRO, 'apiKeys', 6, NOW)), { status: 403, code: PLAN_ERROR.PLAN_LIMIT });
  assert.deepEqual(codeOf(() => assertWithinLimit(FREE, 'apiKeys', 1, NOW)), { status: 403, code: PLAN_ERROR.PLAN_LIMIT });
  assert.doesNotThrow(() => assertWithinLimit(PRO, 'sheetsPerMonth', 10_000, NOW)); // unlimited
  assert.deepEqual(codeOf(() => assertWithinLimit(FREE, 'sheetsPerMonth', 6, NOW)), { status: 403, code: PLAN_ERROR.PLAN_LIMIT });
});

test('assertWithinLimit: an expired trial is held to the free limits', () => {
  const expired = { plan: 'pro', trialEndsAt: new Date(NOW.getTime() - DAY) } as const;
  assert.deepEqual(codeOf(() => assertWithinLimit(expired, 'maxUpscale', 4, NOW)), { status: 403, code: PLAN_ERROR.PLAN_LIMIT });
});

function run(mw: ReturnType<typeof requireEntitlement>, user: unknown): unknown {
  let received: unknown = 'not called';
  mw({ user } as unknown as Request, {} as Response, ((err?: unknown) => {
    received = err;
  }) as NextFunction);
  return received;
}

test('requireEntitlement middleware: 403 PLAN_REQUIRED for free, next() for pro, 401 signed out', () => {
  const mw = requireEntitlement('customNamingPatterns');
  const refused = run(mw, { id: '1', plan: 'free' });
  assert.ok(refused instanceof ApiError);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.code, PLAN_ERROR.PLAN_REQUIRED);
  assert.match(refused.message, /Pro/);
  assert.equal(run(mw, { id: '1', plan: 'pro' }), undefined);
  const signedOut = run(mw, undefined);
  assert.ok(signedOut instanceof ApiError);
  assert.equal(signedOut.statusCode, 401);
});

// ── Padding and threshold gate ──────────────────────────────────────────────

test('detection tuning: free gets the defaults and cannot change them', () => {
  assert.deepEqual(resolveDetectionTuning(FREE, {}, NOW), { threshold: 50, padding: 0 });
  assert.deepEqual(resolveDetectionTuning(FREE, { threshold: 50, padding: 0 }, NOW), { threshold: 50, padding: 0 });
  assert.deepEqual(codeOf(() => resolveDetectionTuning(FREE, { padding: 8 }, NOW)), { status: 403, code: PLAN_ERROR.PLAN_REQUIRED });
  assert.deepEqual(codeOf(() => resolveDetectionTuning(FREE, { threshold: 30 }, NOW)), { status: 403, code: PLAN_ERROR.PLAN_REQUIRED });
});

test('detection tuning: pro can set both, out-of-range values are 400', () => {
  assert.deepEqual(resolveDetectionTuning(PRO, { threshold: 30, padding: 8 }, NOW), { threshold: 30, padding: 8 });
  for (const bad of [{ threshold: 0 }, { threshold: 101 }, { padding: -1 }, { padding: 65 }, { padding: 2.5 }, { threshold: '30' }]) {
    assert.equal(codeOf(() => resolveDetectionTuning(PRO, bad, NOW)).status, 400, JSON.stringify(bad));
  }
});

test('detection tuning: an expired trial loses the controls', () => {
  const expired = { plan: 'pro', trialEndsAt: new Date(NOW.getTime() - DAY) } as const;
  assert.deepEqual(codeOf(() => resolveDetectionTuning(expired, { padding: 8 }, NOW)), { status: 403, code: PLAN_ERROR.PLAN_REQUIRED });
});

test('padBoxes grows boxes and stays inside the sheet', () => {
  const [a, b] = padBoxes(
    [
      { id: 'a', x: 2, y: 50, width: 20, height: 20 },
      { id: 'b', x: 90, y: 10, width: 8, height: 8 },
    ],
    5,
    100,
    60,
  );
  assert.deepEqual(a, { id: 'a', x: 0, y: 45, width: 27, height: 15 });
  assert.deepEqual(b, { id: 'b', x: 85, y: 5, width: 15, height: 18 });
  const same = [{ x: 1, y: 1, width: 2, height: 2 }];
  assert.equal(padBoxes(same, 0, 10, 10), same);
});

// ── Sheet-usage period ──────────────────────────────────────────────────────

test('period key and reset date are UTC calendar months', () => {
  assert.equal(periodKey(new Date('2026-03-31T23:59:59Z')), '2026-03');
  assert.equal(periodKey(new Date('2026-04-01T00:00:00Z')), '2026-04');
  assert.equal(nextResetDate(new Date('2026-03-15T12:00:00Z')).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(nextResetDate(new Date('2026-12-31T23:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
});

// ── Plan status ─────────────────────────────────────────────────────────────

test('plan status: free user', () => {
  const s = buildPlanStatus({ plan: 'free' }, 3, NOW);
  assert.equal(s.effectivePlan, 'free');
  assert.deepEqual(s.sheets, { used: 3, limit: 5, remaining: 2, period: '2026-03', resetAt: '2026-04-01T00:00:00.000Z' });
  assert.equal(s.trial.eligible, true);
  assert.equal(s.trial.active, false);
  assert.equal(s.trial.daysLeft, null);
});

test('plan status: active trial reports days left (rounded up)', () => {
  const s = buildPlanStatus(
    { plan: 'pro', planSource: 'trial', trialStartedAt: NOW, trialEndsAt: new Date(NOW.getTime() + 13.2 * DAY) },
    40,
    NOW,
  );
  assert.equal(s.effectivePlan, 'pro');
  assert.equal(s.sheets.limit, null);
  assert.equal(s.sheets.remaining, null);
  assert.equal(s.trial.active, true);
  assert.equal(s.trial.eligible, false);
  assert.equal(s.trial.daysLeft, 14);
});

test('plan status: an expired trial is free, used and not eligible again', () => {
  const s = buildPlanStatus(
    {
      plan: 'pro',
      planSource: 'trial',
      trialStartedAt: new Date(NOW.getTime() - 20 * DAY),
      trialEndsAt: new Date(NOW.getTime() - 6 * DAY),
    },
    0,
    NOW,
  );
  assert.equal(s.plan, 'pro'); // stored plan is untouched
  assert.equal(s.effectivePlan, 'free');
  assert.equal(s.sheets.limit, 5);
  assert.equal(s.trial.used, true);
  assert.equal(s.trial.active, false);
  assert.equal(s.trial.eligible, false);
  assert.equal(s.proEndsAt, null);
});

test('plan status: admin Pro with no end date is not a trial and has no end', () => {
  const s = buildPlanStatus({ plan: 'pro', planSource: 'admin' }, 0, NOW);
  assert.equal(s.effectivePlan, 'pro');
  assert.equal(s.trial.active, false);
  assert.equal(s.trial.eligible, false);
  assert.equal(s.proEndsAt, null);
});

// ── CLI argument parsing ────────────────────────────────────────────────────

test('plan:set arguments', () => {
  assert.deepEqual(parsePlanSetArgs(['a@b.co', 'pro']), { email: 'a@b.co', plan: 'pro', days: null });
  assert.deepEqual(parsePlanSetArgs(['a@b.co', 'pro', '--days', '30']), { email: 'a@b.co', plan: 'pro', days: 30 });
  assert.deepEqual(parsePlanSetArgs(['--days=7', 'a@b.co', 'pro']), { email: 'a@b.co', plan: 'pro', days: 7 });
  assert.deepEqual(parsePlanSetArgs(['a@b.co', 'free']), { email: 'a@b.co', plan: 'free', days: null });
  for (const bad of [[], ['a@b.co'], ['nope', 'pro'], ['a@b.co', 'team'], ['a@b.co', 'pro', '--days'], ['a@b.co', 'pro', '--days', '0'], ['a@b.co', 'free', '--days', '3'], ['a@b.co', 'pro', '--wat']]) {
    assert.throws(() => parsePlanSetArgs(bad), Error, JSON.stringify(bad));
  }
});

test('admin:grant arguments', () => {
  assert.deepEqual(parseAdminGrantArgs(['a@b.co']), { email: 'a@b.co' });
  assert.throws(() => parseAdminGrantArgs([]));
  assert.throws(() => parseAdminGrantArgs(['nope']));
});

// ── MongoDB: sheet limit, trial, plan changes ───────────────────────────────

const mongoUri = process.env['MONGO_URI'];
const dbSkip = !mongoUri && 'requires MONGO_URI';
const testDb = `${process.env['MONGO_DB_NAME'] ?? 'open_assets'}_test`;

type Mongoose = typeof import('mongoose').default;
let mongoose: Mongoose;
const createdUsers: unknown[] = [];

async function makeUser(extra: Record<string, unknown> = {}) {
  const { UserModel } = await import('../modules/auth/auth.model');
  const user = await UserModel.create({
    email: `plans-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
    name: 'Plans Test',
    isVerified: true,
    ...extra,
  });
  createdUsers.push(user._id);
  return user;
}

before(async () => {
  if (!mongoUri) return;
  mongoose = (await import('mongoose')).default;
  await mongoose.connect(mongoUri, { dbName: testDb });
  const { SheetUsageModel } = await import('../modules/plans/sheetUsage.model');
  await SheetUsageModel.init(); // the unique index is what makes first-of-month uploads safe
});

after(async () => {
  if (!mongoUri || !mongoose) return;
  const { UserModel } = await import('../modules/auth/auth.model');
  const { SheetUsageModel } = await import('../modules/plans/sheetUsage.model');
  await UserModel.deleteMany({ _id: { $in: createdUsers } });
  await SheetUsageModel.deleteMany({ userId: { $in: createdUsers } });
  await mongoose.disconnect();
});

test('sheet limit: 20 parallel uploads against 5 allowed → exactly 5 succeed (first upload of the month races on the upsert)', { skip: dbSkip }, async () => {
  const { tryReserveSheet, getSheetsUsed } = await import('../modules/plans/sheetUsage.service');
  // Several fresh users: each round starts with no row, the worst case for the upsert race.
  for (let round = 0; round < 8; round += 1) {
    const user = await makeUser();
    const id = String(user._id);
    const results = await Promise.all(Array.from({ length: 20 }, () => tryReserveSheet(id, 5, NOW)));
    const ok = results.filter(Boolean);
    assert.equal(ok.length, 5, `round ${round}`);
    assert.deepEqual(ok.map((r) => r?.used).sort(), [1, 2, 3, 4, 5]);
    assert.equal(await getSheetsUsed(id, NOW), 5);
  }
});

test('sheet limit: refuses with 403 SHEET_LIMIT and the reset date once used up', { skip: dbSkip }, async () => {
  const { reserveSheet } = await import('../modules/plans/sheetUsage.service');
  const user = await makeUser();
  const id = String(user._id);
  for (let i = 0; i < 5; i += 1) await reserveSheet(id, 5, NOW);
  await assert.rejects(reserveSheet(id, 5, NOW), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, PLAN_ERROR.SHEET_LIMIT);
    assert.equal(err.details?.['resetAt'], '2026-04-01T00:00:00.000Z');
    assert.equal(err.details?.['limit'], 5);
    assert.equal(err.details?.['used'], 5);
    return true;
  });
});

test('sheet limit: a new month starts a new allowance', { skip: dbSkip }, async () => {
  const { reserveSheet } = await import('../modules/plans/sheetUsage.service');
  const user = await makeUser();
  const id = String(user._id);
  for (let i = 0; i < 5; i += 1) await reserveSheet(id, 5, NOW);
  const april = new Date('2026-04-01T00:00:00Z');
  const next = await reserveSheet(id, 5, april);
  assert.equal(next.period, '2026-04');
  assert.equal(next.used, 1);
});

test('sheet limit: releasing a slot gives it back, never below zero', { skip: dbSkip }, async () => {
  const { reserveSheet, releaseSheet, getSheetsUsed } = await import('../modules/plans/sheetUsage.service');
  const user = await makeUser();
  const id = String(user._id);
  const slot = await reserveSheet(id, 5, NOW);
  await releaseSheet(slot);
  await releaseSheet(slot);
  assert.equal(await getSheetsUsed(id, NOW), 0);
});

test('sheet limit: unlimited (pro) never refuses and still counts, even in parallel', { skip: dbSkip }, async () => {
  const { tryReserveSheet, getSheetsUsed } = await import('../modules/plans/sheetUsage.service');
  const user = await makeUser({ plan: 'pro' });
  const id = String(user._id);
  const results = await Promise.all(Array.from({ length: 12 }, () => tryReserveSheet(id, null, NOW)));
  assert.equal(results.filter(Boolean).length, 12);
  assert.equal(await getSheetsUsed(id, NOW), 12);
});

test('trial: starts once, for 14 days', { skip: dbSkip }, async () => {
  const { startTrial } = await import('../modules/plans/plans.service');
  const user = await makeUser();
  const status = await startTrial(String(user._id), NOW);
  assert.equal(status.effectivePlan, 'pro');
  assert.equal(status.planSource, 'trial');
  assert.equal(status.trial.active, true);
  assert.equal(status.trial.used, true);
  assert.equal(status.trial.eligible, false);
  assert.equal(status.trial.daysLeft, 14);
  assert.equal(status.trial.endsAt, new Date(NOW.getTime() + 14 * DAY).toISOString());

  await assert.rejects(startTrial(String(user._id), NOW), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'ALREADY_PRO');
    return true;
  });
});

test('trial: five simultaneous requests start exactly one trial', { skip: dbSkip }, async () => {
  const { startTrial } = await import('../modules/plans/plans.service');
  const user = await makeUser();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => startTrial(String(user._id), NOW)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const { UserModel } = await import('../modules/auth/auth.model');
  const fresh = await UserModel.findById(user._id);
  assert.equal(fresh?.trialStartedAt?.toISOString(), NOW.toISOString());
});

test('trial: cannot be started again after it expired (TRIAL_USED), and the user is free again', { skip: dbSkip }, async () => {
  const { startTrial, getPlanStatus } = await import('../modules/plans/plans.service');
  const user = await makeUser({
    plan: 'pro',
    planSource: 'trial',
    trialStartedAt: new Date(NOW.getTime() - 20 * DAY),
    trialEndsAt: new Date(NOW.getTime() - 6 * DAY),
  });
  const status = await getPlanStatus(String(user._id), NOW);
  assert.equal(status.effectivePlan, 'free');
  assert.equal(status.trial.eligible, false);
  await assert.rejects(startTrial(String(user._id), NOW), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'TRIAL_USED');
    return true;
  });
});

test('trial: a user on admin-granted Pro is told they already have Pro', { skip: dbSkip }, async () => {
  const { startTrial } = await import('../modules/plans/plans.service');
  const user = await makeUser({ plan: 'pro', planSource: 'admin' });
  await assert.rejects(startTrial(String(user._id), NOW), (err: unknown) => err instanceof ApiError && err.code === 'ALREADY_PRO');
});

test('setPlanByEmail: pro for N days, permanent pro, and back to free', { skip: dbSkip }, async () => {
  const { setPlanByEmail } = await import('../modules/plans/plans.service');
  const user = await makeUser();

  let { status } = await setPlanByEmail(user.email.toUpperCase(), 'pro', 30, NOW);
  assert.equal(status.effectivePlan, 'pro');
  assert.equal(status.planSource, 'admin');
  assert.equal(status.proEndsAt, new Date(NOW.getTime() + 30 * DAY).toISOString());
  assert.equal(status.trial.used, false, 'an admin grant does not use up the self-serve trial');

  ({ status } = await setPlanByEmail(user.email, 'pro', null, NOW));
  assert.equal(status.effectivePlan, 'pro');
  assert.equal(status.proEndsAt, null);

  ({ status } = await setPlanByEmail(user.email, 'free', null, NOW));
  assert.equal(status.effectivePlan, 'free');
  assert.equal(status.plan, 'free');

  await assert.rejects(setPlanByEmail('nobody@nowhere.test', 'pro'), (err: unknown) => err instanceof ApiError && err.statusCode === 404);
});

test('setPlanByEmail: a timed admin grant falls back to free when it ends', { skip: dbSkip }, async () => {
  const { setPlanByEmail, getPlanStatus } = await import('../modules/plans/plans.service');
  const user = await makeUser();
  await setPlanByEmail(user.email, 'pro', 7, NOW);
  assert.equal((await getPlanStatus(String(user._id), new Date(NOW.getTime() + 6 * DAY))).effectivePlan, 'pro');
  assert.equal((await getPlanStatus(String(user._id), new Date(NOW.getTime() + 8 * DAY))).effectivePlan, 'free');
});

test('grantAdminByEmail makes a user admin, once', { skip: dbSkip }, async () => {
  const { grantAdminByEmail } = await import('../modules/plans/plans.service');
  const { UserModel } = await import('../modules/auth/auth.model');
  const user = await makeUser();
  assert.deepEqual(await grantAdminByEmail(user.email), { email: user.email, changed: true });
  assert.deepEqual(await grantAdminByEmail(user.email), { email: user.email, changed: false });
  assert.equal((await UserModel.findById(user._id))?.role, 'admin');
});

test('listUsersForAdmin searches by email as plain text (regex characters are not special)', { skip: dbSkip }, async () => {
  const { listUsersForAdmin } = await import('../modules/plans/plans.service');
  const user = await makeUser({ name: 'Searchable Person' });
  const byEmail = await listUsersForAdmin(user.email.slice(0, 18), 100, NOW);
  assert.ok(byEmail.some((row) => row.id === String(user._id)));
  const byName = await listUsersForAdmin('searchable person', 100, NOW);
  assert.ok(byName.some((row) => row.id === String(user._id)));
  assert.deepEqual(await listUsersForAdmin('.*', 100, NOW), [], 'a regex pattern is matched literally');
});
