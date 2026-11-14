import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Route-level tests for plans, limits and gates, against the real Express app.
 *
 * Needs MongoDB and Redis (MONGO_URI and REDIS_URL, loaded from backend/.env).
 * They use their own database (`<MONGO_DB_NAME>_test`) and Redis DB 15, a fake
 * Python detection service and a stubbed storage adapter, so nothing leaves
 * the machine and no Cloudinary account is needed.
 */

const mongoUri = process.env['MONGO_URI'];
const redisBase = process.env['REDIS_URL'];
const skip = (!mongoUri || !redisBase) && 'requires MONGO_URI and REDIS_URL';

const DAY = 24 * 60 * 60 * 1000;

interface Ctx {
  base: string;
  token: (userId: unknown) => string;
  makeUser: (extra?: Record<string, unknown>) => Promise<{ id: string; token: string; email: string }>;
  uploads: { count: number; fail: boolean };
  /** Public ids storage.delete was asked for. */
  deletedFiles: string[];
  pyRequests: Record<string, unknown>[];
  models: {
    User: typeof import('../modules/auth/auth.model').UserModel;
    SheetUsage: typeof import('../modules/plans/sheetUsage.model').SheetUsageModel;
  };
  redis: typeof import('../common/config/redis').redis;
  createJob: (userId: string, status: string, extra?: Record<string, string>) => Promise<string>;
  getJob: typeof import('../modules/jobs/job.store').getJob;
}

let ctx: Ctx;
let teardown: Array<() => Promise<void>> = [];
let nextIp = 1;

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  ip = '10.9.9.9',
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function upload(token: string, ip: string): Promise<{ status: number; json: any }> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'sheet.png');
  const res = await fetch(`${ctx.base}/api/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
    body: form,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  if (skip) return;

  // Must be set before the app modules load: the Redis URL and the Python
  // service address are read at import time.
  process.env['REDIS_URL'] = `${(redisBase as string).replace(/\/\d+$/, '')}/${process.env['TEST_REDIS_DB'] ?? '15'}`;
  process.env['NODE_ENV'] = 'test';

  const pyRequests: Record<string, unknown>[] = [];
  const py = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      pyRequests.push(JSON.parse(raw || '{}'));
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          boxes: [{ id: 'b1', x: 10, y: 10, width: 20, height: 20, name: 'asset_001' }],
          image_width: 100,
          image_height: 100,
          detection_mode: 'dark-background',
          detection_confidence: 0.9,
          detection_warning: null,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => py.listen(0, '127.0.0.1', resolve));
  process.env['PY_BACKEND_URL'] = `http://127.0.0.1:${(py.address() as AddressInfo).port}`;
  teardown.push(() => new Promise((resolve) => py.close(() => resolve())));

  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(mongoUri as string, { dbName: `${process.env['MONGO_DB_NAME'] ?? 'open_assets'}_test` });
  const { UserModel } = await import('../modules/auth/auth.model');
  const { SheetUsageModel } = await import('../modules/plans/sheetUsage.model');
  await SheetUsageModel.init();

  const { redis } = await import('../common/config/redis');
  const { detectionQueue, cropQueue, finalizeQueue } = await import('../common/config/bullmq');
  const { storage } = await import('../lib/storage');
  const { createJob: storeJob, updateJob, getJob } = await import('../modules/jobs/job.store');
  const { generateAccessToken } = await import('../common/utils/jwt.utils');
  const { createApp } = await import('../app');

  // Stub storage and the detection queue: the limit must be enforced before
  // either is touched, and the tests assert exactly that.
  const uploads = { count: 0, fail: false };
  storage.upload = async () => {
    if (uploads.fail) throw new Error('storage is down');
    uploads.count += 1;
    return { url: 'https://example.test/sheet.png', publicId: `p${uploads.count}`, format: 'png', width: 512, height: 512 };
  };
  const deletedFiles: string[] = [];
  storage.delete = async (publicId) => {
    deletedFiles.push(publicId);
  };
  detectionQueue.add = (async () => ({})) as unknown as typeof detectionQueue.add;

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const created: unknown[] = [];
  const jobIds: string[] = [];

  const token = (userId: unknown) => generateAccessToken({ id: String(userId) });
  ctx = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token,
    uploads,
    deletedFiles,
    pyRequests,
    models: { User: UserModel, SheetUsage: SheetUsageModel },
    redis,
    getJob,
    async makeUser(extra = {}) {
      const user = await UserModel.create({
        email: `routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        name: 'Routes Test',
        isVerified: true,
        ...extra,
      });
      created.push(user._id);
      return { id: String(user._id), token: token(user._id), email: user.email };
    },
    async createJob(userId, status, extra = {}) {
      const jobId = `plans-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      jobIds.push(jobId);
      await storeJob(jobId, { cloudinaryUrl: 'https://res.cloudinary.com/x/y.png', publicId: 'y', userId });
      await updateJob(jobId, { status: status as never, imageWidth: '100', imageHeight: '100', ...extra });
      return jobId;
    },
  };

  teardown.unshift(async () => {
    await UserModel.deleteMany({ _id: { $in: created } });
    await SheetUsageModel.deleteMany({ userId: { $in: created } });
    if (jobIds.length) await redis.del(...jobIds.map((id) => `job:${id}`));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([detectionQueue, cropQueue, finalizeQueue].map((q) => q.obliterate({ force: true }).catch(() => undefined)));
    await Promise.all([detectionQueue.close(), cropQueue.close(), finalizeQueue.close()]);
    await redis.quit();
    await mongoose.disconnect();
  });
});

after(async () => {
  for (const fn of teardown) await fn();
  teardown = [];
});

// ── GET /api/plans/me ───────────────────────────────────────────────────────

test('GET /api/plans/me needs a session', { skip }, async () => {
  assert.equal((await call('GET', '/api/plans/me', null)).status, 401);
});

test('GET /api/plans/me reports the effective plan, entitlements, usage, reset date and trial', { skip }, async () => {
  const user = await ctx.makeUser();
  const { status, json } = await call('GET', '/api/plans/me', user.token);
  assert.equal(status, 200);
  const data = json.data;
  assert.equal(data.effectivePlan, 'free');
  assert.equal(data.entitlements.sheetsPerMonth, 5);
  assert.equal(data.entitlements.maxUpscale, 2);
  assert.equal(data.entitlements.paddingThresholdControls, false);
  assert.equal(data.sheets.used, 0);
  assert.equal(data.sheets.limit, 5);
  assert.equal(data.sheets.remaining, 5);
  assert.match(data.sheets.resetAt, /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  assert.equal(data.trial.eligible, true);
  assert.equal(data.trial.active, false);
});

test('GET /api/plans/me says whether the export upscale is AI, from the storage provider', { skip }, async () => {
  const user = await ctx.makeUser();
  const before = process.env['STORAGE_PROVIDER'];
  try {
    // The provider is read on every request, so it can be switched per call.
    for (const [provider, aiUpscale] of [['local', false], ['cloudinary', true], ['imagekit', true]] as const) {
      process.env['STORAGE_PROVIDER'] = provider;
      const { status, json } = await call('GET', '/api/plans/me', user.token);
      assert.equal(status, 200);
      assert.deepEqual(
        json.data.capabilities,
        {
          aiUpscale,
          enclosedBackground: true,
          backgroundRemoval: { server: true, ai: aiUpscale, aiProvider: provider === 'local' ? null : provider === 'imagekit' ? 'ImageKit' : 'Cloudinary' },
        },
        provider,
      );
    }
  } finally {
    if (before === undefined) delete process.env['STORAGE_PROVIDER'];
    else process.env['STORAGE_PROVIDER'] = before;
  }
});

// ── Free sheet limit on POST /api/upload ────────────────────────────────────

test('upload: a free user gets 5 sheets a month, the 6th is refused before anything is stored', { skip }, async () => {
  const user = await ctx.makeUser();
  const ip = `10.1.0.${nextIp++}`;
  const before = ctx.uploads.count;

  for (let i = 1; i <= 5; i += 1) {
    const res = await upload(user.token, ip);
    assert.equal(res.status, 201, `upload ${i}: ${JSON.stringify(res.json)}`);
  }
  assert.equal(ctx.uploads.count - before, 5);

  const refused = await upload(user.token, ip);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, 'SHEET_LIMIT');
  assert.equal(refused.json.details.limit, 5);
  assert.equal(refused.json.details.used, 5);
  assert.match(refused.json.details.resetAt, /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  assert.equal(ctx.uploads.count - before, 5, 'the refused upload must not reach storage');

  const me = await call('GET', '/api/plans/me', user.token);
  assert.equal(me.json.data.sheets.used, 5);
  assert.equal(me.json.data.sheets.remaining, 0);
});

test('upload: 10 simultaneous uploads from a free user store exactly 5', { skip }, async () => {
  const user = await ctx.makeUser();
  const ip = `10.1.0.${nextIp++}`;
  const before = ctx.uploads.count;
  const results = await Promise.all(Array.from({ length: 10 }, () => upload(user.token, ip)));
  assert.equal(results.filter((r) => r.status === 201).length, 5);
  assert.equal(results.filter((r) => r.status === 403 && r.json.code === 'SHEET_LIMIT').length, 5);
  assert.equal(ctx.uploads.count - before, 5);
});

test('upload: a failed upload does not use up a sheet', { skip }, async () => {
  const user = await ctx.makeUser();
  const ip = `10.1.0.${nextIp++}`;
  ctx.uploads.fail = true;
  try {
    const res = await upload(user.token, ip);
    assert.equal(res.status, 500);
  } finally {
    ctx.uploads.fail = false;
  }
  // The slot is handed back as the response closes; give it a moment.
  let used = -1;
  for (let i = 0; i < 20 && used !== 0; i += 1) {
    used = (await call('GET', '/api/plans/me', user.token)).json.data.sheets.used;
    if (used !== 0) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(used, 0);
});

test('upload: a signed-out request is 401 and takes no sheet', { skip }, async () => {
  const res = await fetch(`${ctx.base}/api/upload`, { method: 'POST', headers: { 'x-forwarded-for': `10.1.0.${nextIp++}` } });
  assert.equal(res.status, 401);
});

test('upload: Pro has no limit and is still counted', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'admin' });
  const ip = `10.1.0.${nextIp++}`;
  for (let i = 0; i < 7; i += 1) assert.equal((await upload(user.token, ip)).status, 201);
  const me = (await call('GET', '/api/plans/me', user.token)).json.data;
  assert.equal(me.effectivePlan, 'pro');
  assert.equal(me.sheets.limit, null);
  assert.equal(me.sheets.used, 7);
});

test('upload: an expired trial is back on the free limit', { skip }, async () => {
  const user = await ctx.makeUser({
    plan: 'pro',
    planSource: 'trial',
    trialStartedAt: new Date(Date.now() - 20 * DAY),
    trialEndsAt: new Date(Date.now() - 6 * DAY),
  });
  const ip = `10.1.0.${nextIp++}`;
  const me = (await call('GET', '/api/plans/me', user.token)).json.data;
  assert.equal(me.effectivePlan, 'free');
  assert.equal(me.trial.eligible, false);
  for (let i = 0; i < 5; i += 1) assert.equal((await upload(user.token, ip)).status, 201);
  assert.equal((await upload(user.token, ip)).json.code, 'SHEET_LIMIT');
});

// ── POST /api/plans/trial ───────────────────────────────────────────────────

test('trial: starts in place, lifts the sheet limit, and can only be used once', { skip }, async () => {
  const user = await ctx.makeUser();
  const ip = `10.1.0.${nextIp++}`;
  for (let i = 0; i < 5; i += 1) await upload(user.token, ip);
  assert.equal((await upload(user.token, ip)).status, 403);

  const started = await call('POST', '/api/plans/trial', user.token);
  assert.equal(started.status, 200);
  assert.equal(started.json.data.effectivePlan, 'pro');
  assert.equal(started.json.data.trial.active, true);
  assert.equal(started.json.data.trial.daysLeft, 14);
  assert.equal(started.json.data.entitlements.maxUpscale, 4);

  assert.equal((await upload(user.token, ip)).status, 201, 'Pro is not limited');

  const again = await call('POST', '/api/plans/trial', user.token);
  assert.equal(again.status, 409);
  assert.ok(['ALREADY_PRO', 'TRIAL_USED'].includes(again.json.code));
});

test('trial: needs a session', { skip }, async () => {
  assert.equal((await call('POST', '/api/plans/trial', null)).status, 401);
});

// ── Admin API ───────────────────────────────────────────────────────────────

test('admin: signed out is 401, a normal user is 403, an admin gets the list', { skip }, async () => {
  const normal = await ctx.makeUser();
  const admin = await ctx.makeUser({ role: 'admin' });
  const target = await ctx.makeUser({ name: 'Findable Target' });

  assert.equal((await call('GET', '/api/admin/users', null)).status, 401);
  assert.equal((await call('GET', '/api/admin/users', normal.token)).status, 403);

  const listed = await call('GET', `/api/admin/users?q=${encodeURIComponent(target.email)}`, admin.token);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.users.length, 1);
  assert.equal(listed.json.data.users[0].email, target.email);
  assert.equal(listed.json.data.users[0].effectivePlan, 'free');
  assert.equal('password' in listed.json.data.users[0], false);
});

test('admin: only an admin can set a plan, and the change takes effect', { skip }, async () => {
  const normal = await ctx.makeUser();
  const admin = await ctx.makeUser({ role: 'admin' });
  const target = await ctx.makeUser();

  const denied = await call('PUT', `/api/admin/users/${target.id}/plan`, normal.token, { plan: 'pro' });
  assert.equal(denied.status, 403);
  assert.equal((await ctx.models.User.findById(target.id))?.plan, 'free');

  assert.equal((await call('PUT', `/api/admin/users/${target.id}/plan`, null, { plan: 'pro' })).status, 401);

  const granted = await call('PUT', `/api/admin/users/${target.id}/plan`, admin.token, { plan: 'pro', days: 30 });
  assert.equal(granted.status, 200);
  assert.equal(granted.json.data.effectivePlan, 'pro');
  assert.equal(granted.json.data.planSource, 'admin');
  assert.ok(granted.json.data.proEndsAt);

  const me = await call('GET', '/api/plans/me', target.token);
  assert.equal(me.json.data.effectivePlan, 'pro');

  const revoked = await call('PUT', `/api/admin/users/${target.id}/plan`, admin.token, { plan: 'free' });
  assert.equal(revoked.json.data.effectivePlan, 'free');
});

test('admin: bad input is 400, an unknown user is 404', { skip }, async () => {
  const admin = await ctx.makeUser({ role: 'admin' });
  const target = await ctx.makeUser();
  assert.equal((await call('PUT', `/api/admin/users/${target.id}/plan`, admin.token, { plan: 'enterprise' })).status, 400);
  assert.equal((await call('PUT', `/api/admin/users/${target.id}/plan`, admin.token, { plan: 'pro', days: -3 })).status, 400);
  assert.equal((await call('PUT', '/api/admin/users/not-an-id/plan', admin.token, { plan: 'pro' })).status, 400);
  assert.equal((await call('PUT', `/api/admin/users/${'0'.repeat(24)}/plan`, admin.token, { plan: 'pro' })).status, 404);
});

test('admin: a user cannot make themselves admin or Pro through the plan routes', { skip }, async () => {
  const user = await ctx.makeUser();
  assert.equal((await call('PUT', `/api/admin/users/${user.id}/plan`, user.token, { plan: 'pro' })).status, 403);
  assert.equal((await ctx.models.User.findById(user.id))?.plan, 'free');
});

// ── 4x upscale gate on POST /api/finalize ───────────────────────────────────

const ASSETS = JSON.stringify([{ id: 'a1', name: 'one', cropped_url: 'https://x/1.png', public_id: 'p1' }]);

test('finalize: free is refused 4x with 403 PLAN_LIMIT and the job is left alone', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped', { assets: ASSETS });
  const res = await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'], scale: 4 });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_LIMIT');
  assert.equal(res.json.details.entitlement, 'maxUpscale');
  assert.equal(res.json.details.limit, 2);
  assert.equal((await ctx.getJob(jobId))?.status, 'cropped');
});

test('finalize: free can export at 2x (the default) and the factor is stored', { skip }, async () => {
  const user = await ctx.makeUser();
  const first = await ctx.createJob(user.id, 'cropped', { assets: ASSETS });
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId: first, selectedIds: ['a1'] })).status, 201);
  assert.equal((await ctx.getJob(first))?.upscaleScale, '2');
  const second = await ctx.createJob(user.id, 'cropped', { assets: ASSETS });
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId: second, selectedIds: ['a1'], scale: 2 })).status, 201);
});

test('finalize: a free user skipping the upscale has nothing to gate', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped', { assets: ASSETS });
  const res = await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'], skipUpscale: true, scale: 4 });
  assert.equal(res.status, 201);
});

test('finalize: Pro can export at 4x', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'admin' });
  const jobId = await ctx.createJob(user.id, 'cropped', { assets: ASSETS });
  const res = await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'], scale: 4 });
  assert.equal(res.status, 201);
  assert.equal((await ctx.getJob(jobId))?.upscaleScale, '4');
});

test('finalize: an expired trial cannot export at 4x', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'trial', trialStartedAt: new Date(Date.now() - 30 * DAY), trialEndsAt: new Date(Date.now() - DAY) });
  const jobId = await ctx.createJob(user.id, 'cropped', { assets: ASSETS });
  const res = await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'], scale: 4 });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_LIMIT');
});

test('finalize: an unsupported factor is 400', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'admin' });
  const jobId = await ctx.createJob(user.id, 'cropped', { assets: ASSETS });
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'], scale: 3 })).status, 400);
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'], scale: '4' })).status, 400);
});

// ── Padding and threshold gate on POST /api/jobs/:jobId/redetect ────────────

test('redetect: free keeps the defaults and is refused custom padding or threshold', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'detected');
  const seen = ctx.pyRequests.length;

  for (const body of [{ padding: 8 }, { threshold: 30 }, { threshold: 30, padding: 8, mode: 'dark' }]) {
    const res = await call('POST', `/api/jobs/${jobId}/redetect`, user.token, body);
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.equal(res.json.code, 'PLAN_REQUIRED');
    assert.equal(res.json.details.entitlement, 'paddingThresholdControls');
  }
  assert.equal(ctx.pyRequests.length, seen, 'a refused request must not reach detection');

  const ok = await call('POST', `/api/jobs/${jobId}/redetect`, user.token, { mode: 'dark' });
  assert.equal(ok.status, 200);
  const sent = ctx.pyRequests.at(-1) as Record<string, unknown>;
  assert.equal(sent['threshold'], 50, 'free users run with the default threshold');
  assert.deepEqual(ok.json.data.boxes[0], { id: 'b1', x: 10, y: 10, width: 20, height: 20, label: 'asset_001' });
});

test('redetect: Pro passes the threshold to detection and gets padded boxes', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'admin' });
  const jobId = await ctx.createJob(user.id, 'detected');
  const res = await call('POST', `/api/jobs/${jobId}/redetect`, user.token, { threshold: 30, padding: 4 });
  assert.equal(res.status, 200);
  assert.equal((ctx.pyRequests.at(-1) as Record<string, unknown>)['threshold'], 30);
  assert.deepEqual(res.json.data.boxes[0], { id: 'b1', x: 6, y: 6, width: 28, height: 28, label: 'asset_001' });
  const stored = JSON.parse((await ctx.getJob(jobId))?.boxes ?? '[]');
  assert.equal(stored[0].width, 28, 'the padded boxes are what is saved on the job');
});

test('redetect: out-of-range values are 400 even for Pro', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'admin' });
  const jobId = await ctx.createJob(user.id, 'detected');
  assert.equal((await call('POST', `/api/jobs/${jobId}/redetect`, user.token, { threshold: 500 })).status, 400);
  assert.equal((await call('POST', `/api/jobs/${jobId}/redetect`, user.token, { padding: -2 })).status, 400);
});

test('redetect: an expired trial is back to the defaults', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'trial', trialStartedAt: new Date(Date.now() - 30 * DAY), trialEndsAt: new Date(Date.now() - DAY) });
  const jobId = await ctx.createJob(user.id, 'detected');
  const res = await call('POST', `/api/jobs/${jobId}/redetect`, user.token, { padding: 4 });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
});

// ── Account deletion removes plan data too ──────────────────────────────────

test('deleting an account also removes its sheet counters, history index, enhance jobs and their files', { skip }, async () => {
  const user = await ctx.makeUser();
  const other = await ctx.makeUser();
  const ip = `10.1.0.${nextIp++}`;

  // Real counters from real uploads, plus a history entry and an enhance job in Redis.
  assert.equal((await upload(user.token, ip)).status, 201);
  const uploadedPublicId = `p${ctx.uploads.count}`; // what the stubbed storage named the original
  await ctx.models.SheetUsage.create({ userId: other.id, period: '2026-01', count: 2 });
  const jobId = await ctx.createJob(user.id, 'detected', { assets: JSON.stringify([{ id: 'x', name: 'x', cropped_url: 'u', public_id: 'del-crop-1' }]) });
  await ctx.redis.hset(`job:${jobId}`, { publicId: 'del-original-1' });
  await ctx.redis.zadd(`user:${user.id}:jobs`, Date.now(), jobId);
  await ctx.redis.hset('enhance:ai:del-test-enh', { id: 'del-test-enh', userId: user.id, sourcePublicId: 'del-enhance-src', status: 'ready' });
  const keepJob = await ctx.createJob(other.id, 'detected');

  const before = ctx.deletedFiles.length;
  const res = await call('DELETE', '/api/account', user.token, { confirmation: user.email }, ip);
  assert.equal(res.status, 200, JSON.stringify(res.json));

  assert.equal(await ctx.models.SheetUsage.countDocuments({ userId: user.id }), 0, 'sheet counters are deleted');
  assert.equal(await ctx.redis.exists(`user:${user.id}:jobs`), 0, 'history index is deleted');
  assert.equal(await ctx.redis.exists(`job:${jobId}`), 0, 'the job record is deleted');
  assert.equal(await ctx.redis.exists('enhance:ai:del-test-enh'), 0, 'the enhance job is deleted');
  assert.deepEqual(
    ctx.deletedFiles.slice(before).sort(),
    ['del-crop-1', 'del-enhance-src', 'del-original-1', uploadedPublicId].sort(),
    'originals, crops and the enhance source are asked for once each',
  );

  // Someone else's data is untouched.
  assert.equal(await ctx.models.SheetUsage.countDocuments({ userId: other.id }), 1);
  assert.equal(await ctx.redis.exists(`job:${keepJob}`), 1);
});
