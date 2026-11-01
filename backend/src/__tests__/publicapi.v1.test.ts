import 'dotenv/config';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import axios from 'axios';

/**
 * The public API (/api/v1) against the real Express app: API-key authentication,
 * rate limits, and the upload -> crop -> export -> ZIP flow.
 *
 * Needs MongoDB and Redis (MONGO_URI and REDIS_URL, from backend/.env). Like
 * plans.routes.test.ts it uses `<MONGO_DB_NAME>_test` and Redis DB 15, and
 * stubs the storage adapter, the BullMQ queues and the HTTP download of the
 * stored crops, so nothing leaves the machine and no Cloudinary account is needed.
 */

const mongoUri = process.env['MONGO_URI'];
const redisBase = process.env['REDIS_URL'];
const skip = (!mongoUri || !redisBase) && 'requires MONGO_URI and REDIS_URL';

const DAY = 24 * 60 * 60 * 1000;

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  headers: Headers;
  raw: Buffer;
}

interface Ctx {
  base: string;
  /** What the stubs saw. */
  storage: { uploads: { size: number; options: { folder: string; publicId: string } }[]; result: Record<string, unknown> };
  queued: { queue: 'detect' | 'crop' | 'finalize'; data: Record<string, unknown> }[];
  fetched: string[];
  fetchFails: { on: boolean };
  models: {
    User: typeof import('../modules/auth/auth.model').UserModel;
    ApiKey: typeof import('../modules/apikeys/apiKey.model').ApiKeyModel;
  };
  makeUser: (extra?: Record<string, unknown>) => Promise<{ id: string; email: string; sessionToken: string }>;
  makeKey: (userId: string, name?: string) => Promise<{ key: string; id: string }>;
  seedJob: (userId: string, status: string, extra?: Record<string, string>) => Promise<string>;
  getJob: typeof import('../modules/jobs/job.store').getJob;
  /** Runs the finalize worker's job function (the real one) for a job. */
  runFinalize: (jobId: string) => Promise<void>;
  limits: { requestsPerMinute: number; startsPer15Minutes: number; failedAuthPer15Minutes: number };
}

let ctx: Ctx;
let teardown: Array<() => Promise<void>> = [];
let nextIp = 1;
const ip = () => `10.20.0.${nextIp++}`;

async function send(
  method: string,
  path: string,
  opts: { key?: string | null; headers?: Record<string, string>; body?: unknown; form?: FormData; ip?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? ip(), ...opts.headers };
  if (opts.key) headers['authorization'] = `Bearer ${opts.key}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  let json: unknown = null;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    /* binary body */
  }
  return { status: res.status, json, headers: res.headers, raw };
}

function sheetForm(opts: { name?: string; type?: string; bytes?: number; field?: string } = {}): FormData {
  const form = new FormData();
  form.append(
    opts.field ?? 'image',
    new Blob([new Uint8Array(opts.bytes ?? 64)], { type: opts.type ?? 'image/png' }),
    opts.name ?? 'sheet.png',
  );
  return form;
}

before(async () => {
  if (skip) return;

  // Read at import time by the Redis client.
  process.env['REDIS_URL'] = `${(redisBase as string).replace(/\/\d+$/, '')}/${process.env['TEST_REDIS_DB'] ?? '15'}`;
  process.env['NODE_ENV'] = 'test';

  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(mongoUri as string, { dbName: `${process.env['MONGO_DB_NAME'] ?? 'open_assets'}_test` });
  const { UserModel } = await import('../modules/auth/auth.model');
  const { ApiKeyModel } = await import('../modules/apikeys/apiKey.model');
  const { SheetUsageModel } = await import('../modules/plans/sheetUsage.model');
  await Promise.all([ApiKeyModel.init(), SheetUsageModel.init()]);

  const { redis } = await import('../common/config/redis');
  const { detectionQueue, cropQueue, finalizeQueue } = await import('../common/config/bullmq');
  const { storage } = await import('../lib/storage');
  const { createJob, updateJob, getJob } = await import('../modules/jobs/job.store');
  const { generateApiKey } = await import('../modules/apikeys/apiKey.service');
  const { generateAccessToken } = await import('../common/utils/jwt.utils');
  const { V1_LIMITS } = await import('../modules/publicapi/v1.limits');
  const { processFinalize } = await import('../modules/workers/finalize.worker');
  const { createApp } = await import('../app');

  const queued: Ctx['queued'] = [];
  const stub = { uploads: [] as Ctx['storage']['uploads'], result: {} as Record<string, unknown> };
  storage.upload = (async (buffer: Buffer, options: { folder: string; publicId: string }) => {
    stub.uploads.push({ size: buffer.length, options });
    return {
      url: `https://res.example.test/${options.publicId}.png`,
      publicId: `open_assets/originals/${options.publicId}`,
      format: 'png',
      width: 512,
      height: 512,
      ...stub.result,
    };
  }) as typeof storage.upload;
  storage.delete = async () => undefined;
  storage.applyUpscale = (async (publicId: string, scale: number) => `https://res.example.test/up/${publicId}@${scale}x.png`) as typeof storage.applyUpscale;
  detectionQueue.add = (async (_name: string, data: Record<string, unknown>) => {
    queued.push({ queue: 'detect', data });
    return {};
  }) as unknown as typeof detectionQueue.add;
  cropQueue.add = (async (_name: string, data: Record<string, unknown>) => {
    queued.push({ queue: 'crop', data });
    return {};
  }) as unknown as typeof cropQueue.add;
  finalizeQueue.add = (async (_name: string, data: Record<string, unknown>) => {
    queued.push({ queue: 'finalize', data });
    return {};
  }) as unknown as typeof finalizeQueue.add;

  // The ZIP is built from the stored crops, which are fetched over HTTP.
  const fetched: string[] = [];
  const fetchFails = { on: false };
  mock.method(axios, 'get', async (url: string) => {
    fetched.push(url);
    if (fetchFails.on) throw new Error('storage is down');
    return { data: Buffer.from(`png bytes of ${url}`) };
  });

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const userIds: unknown[] = [];
  const jobIds: string[] = [];
  ctx = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    storage: stub,
    queued,
    fetched,
    fetchFails,
    models: { User: UserModel, ApiKey: ApiKeyModel },
    getJob,
    runFinalize: processFinalize,
    limits: V1_LIMITS,
    async makeUser(extra = { plan: 'pro', planSource: 'admin' }) {
      const email = `v1-${randomUUID()}@test.local`;
      const user = await UserModel.create({ email, name: 'V1 Tester', isVerified: true, ...extra });
      userIds.push(user._id);
      return {
        id: String(user._id),
        email,
        sessionToken: generateAccessToken({ id: user._id, email, name: user.name, role: 'user' }),
      };
    },
    async makeKey(userId, name = 'test key') {
      const { key, prefix, keyHash } = generateApiKey();
      const doc = await ApiKeyModel.create({ userId, name, prefix, keyHash });
      return { key, id: String(doc._id) };
    },
    async seedJob(userId, status, extra = {}) {
      const jobId = `v1-test-${randomUUID()}`;
      jobIds.push(jobId);
      await createJob(jobId, {
        cloudinaryUrl: 'https://res.example.test/sheet.png',
        publicId: `open_assets/originals/${jobId}`,
        userId,
        fileName: 'sheet.png',
      });
      await updateJob(jobId, { status: status as never, imageWidth: '512', imageHeight: '512', ...extra });
      return jobId;
    },
  };

  teardown.unshift(async () => {
    mock.restoreAll();
    await ApiKeyModel.deleteMany({ userId: { $in: userIds } });
    await SheetUsageModel.deleteMany({ userId: { $in: userIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    if (jobIds.length) {
      await redis.del(...jobIds.map((id) => `job:${id}`));
      await redis.del(...userIds.map((id) => `user:${String(id)}:jobs`));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([detectionQueue, cropQueue, finalizeQueue].map((q) => q.close()));
    await redis.quit();
    await mongoose.disconnect();
  });
});

after(async () => {
  for (const fn of teardown) await fn();
  teardown = [];
});

const BOXES = [
  { id: 'box_1', x: 10, y: 10, width: 100, height: 80, label: 'asset_001' },
  { id: 'box_2', x: 200, y: 40, width: 64, height: 64, label: 'asset_002' },
];
const ASSETS = [
  { id: 'box_1', name: 'fire_sword', cropped_url: 'https://res.example.test/crop/fire_sword.png', public_id: 'p/fire_sword' },
  { id: 'box_2', name: 'health_potion', cropped_url: 'https://res.example.test/crop/health_potion.png', public_id: 'p/health_potion' },
];

/* ------------------------------------------------------------------ *
 * Authentication
 * ------------------------------------------------------------------ */

test('no Authorization header: 401 API_KEY_MISSING in the standard error envelope', { skip }, async () => {
  const res = await send('GET', '/api/v1/me');
  assert.equal(res.status, 401);
  assert.equal(res.json.success, false);
  assert.equal(res.json.code, 'API_KEY_MISSING');
  assert.equal(typeof res.json.message, 'string');
});

test('cookies are never accepted: a valid session cookie alone is API_KEY_MISSING', { skip }, async () => {
  const user = await ctx.makeUser();
  const res = await send('GET', '/api/v1/me', {
    headers: { cookie: `token=${user.sessionToken}; refreshToken=${user.sessionToken}` },
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.code, 'API_KEY_MISSING');
});

test('a web session JWT in Authorization is rejected: API_KEY_INVALID', { skip }, async () => {
  const user = await ctx.makeUser();
  const asBearer = await send('GET', '/api/v1/me', { key: user.sessionToken });
  assert.equal(asBearer.status, 401);
  assert.equal(asBearer.json.code, 'API_KEY_INVALID');
  // The same JWT works on the web API, which is what makes the v1 refusal meaningful.
  assert.equal((await send('GET', '/api/plans/me', { key: user.sessionToken })).status, 200);
});

test('bad keys: unknown, malformed, wrong scheme and a key in the query string', { skip }, async () => {
  const someIp = ip();
  const unknown = await send('GET', '/api/v1/me', { key: `oa_live_${'0'.repeat(48)}`, ip: someIp });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.code, 'API_KEY_INVALID');

  const malformed = await send('GET', '/api/v1/me', { key: 'oa_live_short', ip: someIp });
  assert.equal(malformed.json.code, 'API_KEY_INVALID');

  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const basic = await send('GET', '/api/v1/me', { headers: { authorization: `Basic ${key}` }, ip: someIp });
  assert.equal(basic.json.code, 'API_KEY_MISSING');
  const query = await send('GET', `/api/v1/me?api_key=${key}`, { ip: someIp });
  assert.equal(query.json.code, 'API_KEY_MISSING', 'keys in the URL are not read');
});

test('a revoked key is refused with API_KEY_REVOKED; revoking in the web API takes effect at once', { skip }, async () => {
  const user = await ctx.makeUser();
  const created = await fetch(`${ctx.base}/api/api-keys`, {
    method: 'POST',
    headers: { authorization: `Bearer ${user.sessionToken}`, 'content-type': 'application/json', 'x-forwarded-for': ip() },
    body: JSON.stringify({ name: 'made over HTTP' }),
  });
  assert.equal(created.status, 201);
  const { key, id } = ((await created.json()) as { data: { key: string; id: string } }).data;

  assert.equal((await send('GET', '/api/v1/me', { key })).status, 200, 'works before revoking');
  const revoked = await fetch(`${ctx.base}/api/api-keys/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${user.sessionToken}`, 'x-forwarded-for': ip() },
  });
  assert.equal(revoked.status, 200);

  const after = await send('GET', '/api/v1/me', { key });
  assert.equal(after.status, 401);
  assert.equal(after.json.code, 'API_KEY_REVOKED');
});

test('a lapsed plan: the key stays listed but stops authenticating with 403 PLAN_REQUIRED', { skip }, async () => {
  const user = await ctx.makeUser({
    plan: 'pro',
    planSource: 'trial',
    trialStartedAt: new Date(Date.now() - 20 * DAY),
    trialEndsAt: new Date(Date.now() + 60 * 1000),
  });
  const { key } = await ctx.makeKey(user.id, 'made during the trial');
  assert.equal((await send('GET', '/api/v1/me', { key })).status, 200, 'works while the trial runs');

  await ctx.models.User.updateOne({ _id: user.id }, { $set: { trialEndsAt: new Date(Date.now() - DAY) } });
  const lapsed = await send('GET', '/api/v1/me', { key });
  assert.equal(lapsed.status, 403);
  assert.equal(lapsed.json.code, 'PLAN_REQUIRED');
  assert.equal(lapsed.json.details.entitlement, 'apiKeys');
  assert.equal((await send('GET', '/api/v1/jobs', { key })).status, 403, 'every route is closed, not just /me');

  const listed = await fetch(`${ctx.base}/api/api-keys`, { headers: { authorization: `Bearer ${user.sessionToken}`, 'x-forwarded-for': ip() } });
  assert.equal(((await listed.json()) as { data: unknown[] }).data.length, 1, 'still listed in Settings');

  // Pro again: the same key works without being recreated.
  await ctx.models.User.updateOne({ _id: user.id }, { $set: { plan: 'pro', planSource: 'admin' }, $unset: { trialEndsAt: 1 } });
  assert.equal((await send('GET', '/api/v1/me', { key })).status, 200);
});

test('a downgraded account (free) cannot use its keys', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'free' });
  const { key } = await ctx.makeKey(user.id);
  const res = await send('GET', '/api/v1/me', { key });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
});

test('a key whose owner no longer exists is API_KEY_INVALID', { skip }, async () => {
  const { key } = await ctx.makeKey('a'.repeat(24));
  const res = await send('GET', '/api/v1/me', { key });
  assert.equal(res.status, 401);
  assert.equal(res.json.code, 'API_KEY_INVALID');
  await ctx.models.ApiKey.deleteMany({ userId: 'a'.repeat(24) });
});

test('an API key is not accepted by the web API', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  for (const path of ['/api/plans/me', '/api/jobs', '/api/account', '/api/api-keys']) {
    assert.equal((await send('GET', path, { key })).status, 401, path);
  }
});

test('a valid key works and a stray session cookie is ignored, not used', { skip }, async () => {
  const owner = await ctx.makeUser();
  const stranger = await ctx.makeUser();
  const { key } = await ctx.makeKey(owner.id);
  const res = await send('GET', '/api/v1/me', { key, headers: { cookie: `token=${stranger.sessionToken}` } });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.key.prefix, key.slice(0, 12));
  // Acting as the key's owner, not the cookie's user.
  const job = await ctx.seedJob(stranger.id, 'detected', { boxes: JSON.stringify(BOXES) });
  assert.equal((await send('GET', `/api/v1/jobs/${job}`, { key, headers: { cookie: `token=${stranger.sessionToken}` } })).status, 404);
});

test('lastUsedAt is recorded on first use', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key, id } = await ctx.makeKey(user.id);
  assert.equal((await ctx.models.ApiKey.findById(id))?.lastUsedAt, undefined);
  assert.equal((await send('GET', '/api/v1/me', { key })).status, 200);
  let used: Date | undefined;
  for (let i = 0; i < 20 && !used; i += 1) {
    used = (await ctx.models.ApiKey.findById(id))?.lastUsedAt;
    if (!used) await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(used, 'lastUsedAt was set');
  assert.ok(Date.now() - used.getTime() < 5000);
});

test('unknown endpoints: 401 without a key, coded 404 with one', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  assert.equal((await send('GET', '/api/v1/nope')).status, 401);
  const res = await send('GET', '/api/v1/nope', { key });
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'NOT_FOUND');
});

test('bad JSON bodies are coded too: INVALID_JSON and PAYLOAD_TOO_LARGE', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const bad = await fetch(`${ctx.base}/api/v1/jobs/${jobId}/crop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-forwarded-for': ip() },
    body: '{"boxes": [',
  });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, 'INVALID_JSON');

  const huge = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key, body: { boxes: [], pad: 'x'.repeat(120_000) } });
  assert.equal(huge.status, 413);
  assert.equal(huge.json.code, 'PAYLOAD_TOO_LARGE');
});

/* ------------------------------------------------------------------ *
 * Rate limits
 * ------------------------------------------------------------------ */

test('rate limit: per key. The 121st request in a minute is 429 RATE_LIMITED with Retry-After; other keys are unaffected', { skip }, async () => {
  const user = await ctx.makeUser();
  const a = await ctx.makeKey(user.id, 'busy');
  const b = await ctx.makeKey(user.id, 'quiet');
  const limit = ctx.limits.requestsPerMinute;
  const sameIp = ip(); // one address for both keys: the limit must follow the key, not the IP

  const first = await send('GET', '/api/v1/jobs/none', { key: a.key, ip: sameIp });
  assert.equal(first.status, 404);
  assert.equal(first.headers.get('ratelimit-limit'), String(limit));
  assert.equal(first.headers.get('ratelimit-remaining'), String(limit - 1));

  for (let used = 1; used < limit; used += 10) {
    const batch = Math.min(10, limit - used);
    const results = await Promise.all(Array.from({ length: batch }, () => send('GET', '/api/v1/jobs/none', { key: a.key, ip: sameIp })));
    assert.ok(results.every((r) => r.status === 404), 'under the limit nothing is throttled');
  }

  const blocked = await send('GET', '/api/v1/jobs/none', { key: a.key, ip: sameIp });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.success, false);
  assert.equal(blocked.json.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1 && Number(blocked.headers.get('retry-after')) <= 60);
  assert.equal(blocked.json.details.retryAfterSeconds, Number(blocked.headers.get('retry-after')));
  assert.equal(blocked.headers.get('ratelimit-remaining'), '0');

  const other = await send('GET', '/api/v1/me', { key: b.key, ip: sameIp });
  assert.equal(other.status, 200, 'the other key shares the IP and is not limited');
});

test('rate limit: starting work (upload, crop, export) has its own per-key budget', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const other = await ctx.makeKey(user.id, 'other');
  const budget = ctx.limits.startsPer15Minutes;
  // Always refused by validation (no such job): the budget counts requests, not successes.
  const call = (k: string, i: number) => send('POST', `/api/v1/jobs/none-${i}/crop`, { key: k, body: {}, ip: `10.30.${Math.floor(i / 100)}.${i % 100}` });

  // The 120 requests a minute limit would trip first if everything went at once: go in two minutes' worth.
  const statuses: number[] = [];
  for (let i = 0; i < budget; i += 1) statuses.push((await call(key, i)).status);
  assert.ok(statuses.every((s) => s === 404), `first ${budget} are answered normally: ${[...new Set(statuses)]}`);

  const blocked = await call(key, budget);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.code, 'RATE_LIMITED');
  assert.match(blocked.json.message, /uploads, crops and exports/);

  assert.equal((await send('GET', '/api/v1/me', { key })).status, 200, 'reads are not part of that budget');
  assert.equal((await call(other.key, 0)).status, 404, 'another key has its own budget');
});

test('rate limit: failed key attempts are limited per IP; a bad guess costs, a good key does not', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const attackerIp = ip();
  const max = ctx.limits.failedAuthPer15Minutes;

  for (let i = 0; i < 40; i += 1) {
    assert.equal((await send('GET', '/api/v1/me', { key, ip: attackerIp })).status, 200);
  }
  const statuses: number[] = [];
  for (let i = 0; i < max; i += 1) statuses.push((await send('GET', '/api/v1/me', { key: `oa_live_${'1'.repeat(48)}`, ip: attackerIp })).status);
  assert.ok(statuses.every((s) => s === 401), 'the first failures are plain 401s');

  const blocked = await send('GET', '/api/v1/me', { key: `oa_live_${'2'.repeat(48)}`, ip: attackerIp });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.code, 'RATE_LIMITED');
  assert.ok(blocked.headers.get('retry-after'));

  assert.equal((await send('GET', '/api/v1/me', { key: `oa_live_${'3'.repeat(48)}`, ip: ip() })).status, 401, 'other addresses are unaffected');
});

/* ------------------------------------------------------------------ *
 * GET /me
 * ------------------------------------------------------------------ */

test('GET /me: key, plan, sheets, max upscale and the rate limits that apply', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id, 'my build box');
  const res = await send('GET', '/api/v1/me', { key });
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  const d = res.json.data;
  assert.equal(d.key.name, 'my build box');
  assert.equal(d.plan, 'pro');
  assert.equal(d.maxUpscale, 4);
  assert.equal(d.sheets.limit, null);
  assert.equal(d.sheets.used, 0);
  assert.deepEqual(d.rateLimits, ctx.limits);
  assert.equal(JSON.stringify(res.json).includes(key), false, 'the key is never echoed');
});

/* ------------------------------------------------------------------ *
 * POST /jobs (upload)
 * ------------------------------------------------------------------ */

test('upload: stores the sheet, creates the owner\'s job, queues detection and counts a sheet', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const storedBefore = ctx.storage.uploads.length;
  const queuedBefore = ctx.queued.length;

  const res = await send('POST', '/api/v1/jobs', { key, form: sheetForm({ name: 'rpg_pack_v1.png', bytes: 2048 }) });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.success, true);
  const { jobId, status, imageUrl } = res.json.data;
  assert.equal(status, 'queued');
  assert.match(imageUrl, /^https:\/\/res\.example\.test\//);
  assert.deepEqual(Object.keys(res.json.data).sort(), ['imageUrl', 'jobId', 'status']);

  assert.equal(ctx.storage.uploads.length, storedBefore + 1);
  const stored = ctx.storage.uploads.at(-1);
  assert.equal(stored?.options.folder, 'originals');
  assert.equal(stored?.options.publicId, jobId);
  assert.equal(stored?.size, 2048);
  assert.deepEqual(ctx.queued.slice(queuedBefore).map((q) => q.queue), ['detect']);

  const job = await ctx.getJob(jobId);
  assert.equal(job?.userId, user.id, 'the job belongs to the key owner');
  assert.equal(job?.fileName, 'rpg_pack_v1.png');
  assert.equal(job?.status, 'queued');

  const me = await send('GET', '/api/v1/me', { key });
  assert.equal(me.json.data.sheets.used, 1, 'the sheet counter is the same one the web app uses');
  const listed = await send('GET', '/api/v1/jobs', { key });
  assert.deepEqual(listed.json.data.jobs.map((j: { jobId: string }) => j.jobId), [jobId]);
});

test('upload: no file is 400 IMAGE_REQUIRED, a non-image is 415, a huge file is 413, and none of them use up a sheet', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const before = ctx.storage.uploads.length;

  const none = await send('POST', '/api/v1/jobs', { key, form: new FormData() });
  assert.equal(none.status, 400);
  assert.equal(none.json.code, 'IMAGE_REQUIRED');

  const wrongField = await send('POST', '/api/v1/jobs', { key, form: sheetForm({ field: 'file' }) });
  assert.equal(wrongField.status, 400);
  assert.equal(wrongField.json.code, 'INVALID_UPLOAD');

  const text = await send('POST', '/api/v1/jobs', { key, form: sheetForm({ type: 'text/plain', name: 'notes.txt' }) });
  assert.equal(text.status, 415);
  assert.equal(text.json.code, 'UNSUPPORTED_FILE_TYPE');

  const big = await send('POST', '/api/v1/jobs', { key, form: sheetForm({ bytes: 21 * 1024 * 1024 }) });
  assert.equal(big.status, 413);
  assert.equal(big.json.code, 'FILE_TOO_LARGE');

  assert.equal(ctx.storage.uploads.length, before, 'nothing reached storage');
  let used = -1;
  for (let i = 0; i < 20 && used !== 0; i += 1) {
    used = (await send('GET', '/api/v1/me', { key })).json.data.sheets.used;
    if (used !== 0) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(used, 0, 'every reserved slot was handed back');
});

test('upload: an image outside the size rules is 400 INVALID_IMAGE and the slot is handed back', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  ctx.storage.result = { width: 10, height: 10 };
  try {
    const res = await send('POST', '/api/v1/jobs', { key, form: sheetForm() });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'INVALID_IMAGE');
  } finally {
    ctx.storage.result = {};
  }
  let used = -1;
  for (let i = 0; i < 20 && used !== 0; i += 1) {
    used = (await send('GET', '/api/v1/me', { key })).json.data.sheets.used;
    if (used !== 0) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(used, 0);
});

/* ------------------------------------------------------------------ *
 * GET /jobs and GET /jobs/:id
 * ------------------------------------------------------------------ */

test('GET /jobs/:id: status, boxes and names in the stable shape', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'detected', {
    boxes: JSON.stringify(BOXES),
    detectionMode: 'dark-background',
    detectionConfidence: '0.9',
    detectionWarning: '',
  });

  const detected = await send('GET', `/api/v1/jobs/${jobId}`, { key });
  assert.equal(detected.status, 200);
  const d = detected.json.data;
  assert.equal(d.jobId, jobId);
  assert.equal(d.status, 'detected');
  assert.equal(d.fileName, 'sheet.png');
  assert.ok(Date.parse(d.createdAt));
  assert.deepEqual(d.image, { url: 'https://res.example.test/sheet.png', width: 512, height: 512 });
  assert.deepEqual(d.detection, { mode: 'dark-background', confidence: 0.9, warning: null });
  assert.deepEqual(d.boxes[0], { id: 'box_1', x: 10, y: 10, width: 100, height: 80, label: 'asset_001' });
  assert.equal(d.boxes.length, 2);
  assert.deepEqual(d.assets, []);
  assert.deepEqual(d.export, { scale: null, namingPattern: null, ready: false });
  assert.equal(d.error, null);
  for (const internal of ['cloudinaryUrl', 'publicId', 'workingUrl', 'userId', 'nameMap', 'selectedIds']) {
    assert.equal(internal in d, false, `${internal} is not part of the public shape`);
  }

  const readyId = await ctx.seedJob(user.id, 'ready', {
    boxes: JSON.stringify(BOXES),
    assets: JSON.stringify([{ ...ASSETS[0], upscaled_url: 'https://res.example.test/up/fire_sword.png' }, ASSETS[1]]),
    selectedIds: JSON.stringify(['box_1']),
    upscaleScale: '4',
  });
  const ready = (await send('GET', `/api/v1/jobs/${readyId}`, { key })).json.data;
  assert.deepEqual(ready.assets[0], {
    id: 'box_1',
    name: 'fire_sword',
    url: 'https://res.example.test/crop/fire_sword.png',
    upscaledUrl: 'https://res.example.test/up/fire_sword.png',
    fileName: null,
  });
  assert.equal(ready.assets[1].upscaledUrl, null);
  assert.deepEqual(ready.export, { scale: 4, namingPattern: null, ready: true });

  const failed = await ctx.seedJob(user.id, 'failed', { error: 'Cropping failed: boom' });
  assert.equal((await send('GET', `/api/v1/jobs/${failed}`, { key })).json.data.error, 'Cropping failed: boom');
});

test('GET /jobs/:id: unknown and other people\'s jobs are the same 404 JOB_NOT_FOUND', { skip }, async () => {
  const me = await ctx.makeUser();
  const them = await ctx.makeUser();
  const { key } = await ctx.makeKey(me.id);
  const theirs = await ctx.seedJob(them.id, 'detected', { boxes: JSON.stringify(BOXES) });

  const stranger = await send('GET', `/api/v1/jobs/${theirs}`, { key });
  const missing = await send('GET', `/api/v1/jobs/${randomUUID()}`, { key });
  for (const res of [stranger, missing]) {
    assert.equal(res.status, 404);
    assert.equal(res.json.code, 'JOB_NOT_FOUND');
  }
  assert.equal(stranger.json.message, missing.json.message, 'no way to tell the two apart');
  for (const [method, suffix] of [['POST', '/crop'], ['POST', '/export'], ['GET', '/download']] as const) {
    const res = await send(method, `/api/v1/jobs/${theirs}${suffix}`, { key, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 404, `${method} ${suffix}`);
    assert.equal(res.json.code, 'JOB_NOT_FOUND');
  }
});

test('GET /jobs: the key owner\'s jobs, newest first, paged with a cursor', { skip }, async () => {
  const me = await ctx.makeUser();
  const them = await ctx.makeUser();
  const { key } = await ctx.makeKey(me.id);
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    ids.push(await ctx.seedJob(me.id, 'detected', { boxes: JSON.stringify(BOXES) }));
    await new Promise((r) => setTimeout(r, 5)); // distinct creation times
  }
  await ctx.seedJob(them.id, 'detected');

  const page1 = await send('GET', '/api/v1/jobs?limit=2', { key });
  assert.equal(page1.status, 200);
  assert.deepEqual(page1.json.data.jobs.map((j: { jobId: string }) => j.jobId), [ids[2], ids[1]]);
  assert.equal(typeof page1.json.data.nextCursor, 'string');
  const row = page1.json.data.jobs[0];
  assert.deepEqual(Object.keys(row).sort(), ['assetCount', 'createdAt', 'error', 'fileName', 'imageUrl', 'jobId', 'status']);
  assert.equal(row.assetCount, 2, 'the box count stands in until assets exist');

  const page2 = await send('GET', `/api/v1/jobs?limit=2&cursor=${encodeURIComponent(page1.json.data.nextCursor)}`, { key });
  assert.deepEqual(page2.json.data.jobs.map((j: { jobId: string }) => j.jobId), [ids[0]]);
  assert.equal(page2.json.data.nextCursor, null);

  const bad = await send('GET', '/api/v1/jobs?limit=0', { key });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'BAD_REQUEST');
  assert.equal((await send('GET', '/api/v1/jobs?cursor=garbage', { key })).status, 400);
});

/* ------------------------------------------------------------------ *
 * POST /jobs/:id/crop
 * ------------------------------------------------------------------ */

test('crop: with no body it crops the detected boxes and queues the same crop job as the web app', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const before = ctx.queued.length;

  const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.success, true);
  assert.equal(res.json.data.jobId, jobId);
  assert.deepEqual(ctx.queued.slice(before), [{ queue: 'crop', data: { jobId, isRaw: undefined } }]);
  assert.deepEqual(JSON.parse((await ctx.getJob(jobId))?.boxes ?? '[]'), BOXES);
});

test('crop: corrected boxes replace the detected ones', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const edited = [{ id: 'box_1', x: 0, y: 0, width: 120, height: 90 }];

  const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key, body: { boxes: edited, role: 'admin' } });
  assert.equal(res.status, 201);
  assert.deepEqual(JSON.parse((await ctx.getJob(jobId))?.boxes ?? '[]'), edited);
});

test('crop: validation (400 VALIDATION_ERROR) and state (409 INVALID_JOB_STATE) are checked before anything is queued', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const detected = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const before = ctx.queued.length;

  for (const boxes of [[], [{ id: 'a', x: 0, y: 0, width: -1, height: 5 }], [{ id: 'a', x: 'left', y: 0, width: 5, height: 5 }], 'all']) {
    const res = await send('POST', `/api/v1/jobs/${detected}/crop`, { key, body: { boxes } });
    assert.equal(res.status, 400, JSON.stringify(boxes));
    assert.equal(res.json.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.json.details.issues));
  }

  for (const status of ['uploaded', 'queued', 'cropping', 'cropped', 'ready']) {
    const jobId = await ctx.seedJob(user.id, status, { boxes: JSON.stringify(BOXES) });
    const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key });
    assert.equal(res.status, 409, status);
    assert.equal(res.json.code, 'INVALID_JOB_STATE');
    assert.deepEqual(res.json.details, { status, expected: 'detected' });
  }

  const empty = await ctx.seedJob(user.id, 'detected', { boxes: '[]' });
  assert.equal((await send('POST', `/api/v1/jobs/${empty}/crop`, { key })).status, 409, 'nothing detected, nothing to crop');
  assert.equal(ctx.queued.length, before, 'nothing was queued');
});

test('crop: removeEnclosedBackground is optional, off by default, and queued only when true', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const queuedFor = async (body: unknown) => {
    const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
    const before = ctx.queued.length;
    const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key, body });
    return { res, jobId, queued: ctx.queued.slice(before) };
  };

  const on = await queuedFor({ removeEnclosedBackground: true });
  assert.equal(on.res.status, 201, JSON.stringify(on.res.json));
  assert.deepEqual(on.queued, [{ queue: 'crop', data: { jobId: on.jobId, isRaw: undefined, removeEnclosedBackground: true } }]);

  const off = await queuedFor({ removeEnclosedBackground: false });
  assert.equal(off.res.status, 201);
  assert.deepEqual(off.queued, [{ queue: 'crop', data: { jobId: off.jobId, isRaw: undefined } }], 'false queues the same job as no field');

  const withBoxes = await queuedFor({ boxes: [{ id: 'box_1', x: 0, y: 0, width: 10, height: 10 }], removeEnclosedBackground: true });
  assert.equal(withBoxes.res.status, 201);
  assert.equal((withBoxes.queued[0]?.data as { removeEnclosedBackground?: boolean }).removeEnclosedBackground, true);
});

test('crop: removeEnclosedBackground must be a boolean (400 VALIDATION_ERROR), and nothing is queued', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const before = ctx.queued.length;
  for (const value of ['true', 'yes', 1, 0, null, {}, []]) {
    const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key, body: { removeEnclosedBackground: value } });
    assert.equal(res.status, 400, JSON.stringify(value));
    assert.equal(res.json.code, 'VALIDATION_ERROR');
    assert.match(res.json.message, /removeEnclosedBackground/);
  }
  assert.equal(ctx.queued.length, before);
});

test('POST /api/crop (the web route): removeEnclosedBackground is optional, a boolean when sent, and reaches the queue', { skip }, async () => {
  const user = await ctx.makeUser();
  const post = async (body: Record<string, unknown>) => {
    const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
    const before = ctx.queued.length;
    const res = await send('POST', '/api/crop', { key: user.sessionToken, body: { jobId, boxes: BOXES, ...body } });
    return { res, jobId, queued: ctx.queued.slice(before) };
  };

  // A request from before the field existed behaves as today.
  const old = await post({});
  assert.equal(old.res.status, 201, JSON.stringify(old.res.json));
  assert.deepEqual(old.queued, [{ queue: 'crop', data: { jobId: old.jobId, isRaw: undefined } }]);

  const on = await post({ removeEnclosedBackground: true });
  assert.equal(on.res.status, 201);
  assert.deepEqual(on.queued, [{ queue: 'crop', data: { jobId: on.jobId, isRaw: undefined, removeEnclosedBackground: true } }]);

  const off = await post({ removeEnclosedBackground: false });
  assert.equal(off.res.status, 201);
  assert.deepEqual(off.queued, [{ queue: 'crop', data: { jobId: off.jobId, isRaw: undefined } }]);

  for (const value of ['true', 1, null, {}]) {
    const bad = await post({ removeEnclosedBackground: value });
    assert.equal(bad.res.status, 400, JSON.stringify(value));
    assert.match(bad.res.json.message, /removeEnclosedBackground must be true or false/);
    assert.equal(bad.queued.length, 0, 'nothing is queued');
    assert.equal((await ctx.getJob(bad.jobId))?.status, 'detected', 'the job is untouched');
  }
});

/* ------------------------------------------------------------------ *
 * backgroundRemoval on the crop, and the background on the job
 * ------------------------------------------------------------------ */

test('crop (v1): backgroundRemoval accepts auto, flat, ai and none, reaches the queue, and is stored on the job', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  for (const mode of ['auto', 'flat', 'ai', 'none']) {
    const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
    const before = ctx.queued.length;
    const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key, body: { backgroundRemoval: mode } });
    assert.equal(res.status, 201, `${mode}: ${JSON.stringify(res.json)}`);
    assert.deepEqual(ctx.queued.slice(before), [{ queue: 'crop', data: { jobId, isRaw: undefined, backgroundRemoval: mode } }], mode);
    assert.equal((await ctx.getJob(jobId))?.backgroundRemoval, mode);
  }
});

test('crop (v1): without backgroundRemoval the queue payload is as before, and the job records auto', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const before = ctx.queued.length;
  const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key });
  assert.equal(res.status, 201);
  assert.deepEqual(ctx.queued.slice(before), [{ queue: 'crop', data: { jobId, isRaw: undefined } }]);
  assert.equal((await ctx.getJob(jobId))?.backgroundRemoval, 'auto');
});

test('crop (v1): backgroundRemoval must be one of the four modes (400 VALIDATION_ERROR), and nothing is queued', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const before = ctx.queued.length;
  for (const value of ['server', 'AUTO', '', true, 1, null, {}, []]) {
    const res = await send('POST', `/api/v1/jobs/${jobId}/crop`, { key, body: { backgroundRemoval: value } });
    assert.equal(res.status, 400, JSON.stringify(value));
    assert.equal(res.json.code, 'VALIDATION_ERROR');
    assert.match(res.json.message, /backgroundRemoval/);
  }
  assert.equal(ctx.queued.length, before);
  assert.equal((await ctx.getJob(jobId))?.status, 'detected');
});

test('POST /api/crop (the web route): backgroundRemoval is optional, one of four modes when sent, and reaches the queue', { skip }, async () => {
  const user = await ctx.makeUser();
  const post = async (body: Record<string, unknown>) => {
    const jobId = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
    const before = ctx.queued.length;
    const res = await send('POST', '/api/crop', { key: user.sessionToken, body: { jobId, boxes: BOXES, ...body } });
    return { res, jobId, queued: ctx.queued.slice(before) };
  };

  for (const mode of ['auto', 'flat', 'ai', 'none']) {
    const ok = await post({ backgroundRemoval: mode, removeEnclosedBackground: true });
    assert.equal(ok.res.status, 201, mode);
    assert.deepEqual(ok.queued, [{ queue: 'crop', data: { jobId: ok.jobId, isRaw: undefined, removeEnclosedBackground: true, backgroundRemoval: mode } }], mode);
  }

  for (const value of ['server', 'Flat', '', 1, true, null, {}]) {
    const bad = await post({ backgroundRemoval: value });
    assert.equal(bad.res.status, 400, JSON.stringify(value));
    assert.match(bad.res.json.message, /backgroundRemoval must be one of auto, flat, ai, none/);
    assert.equal(bad.queued.length, 0, 'nothing is queued');
    assert.equal((await ctx.getJob(bad.jobId))?.status, 'detected', 'the job is untouched');
    assert.equal((await ctx.getJob(bad.jobId))?.backgroundRemoval, undefined, 'and nothing was stored');
  }
});

test('GET /api/jobs/:id returns the background classification, the mode, the method that ran and why', { skip }, async () => {
  const user = await ctx.makeUser();
  const withBackground = await ctx.seedJob(user.id, 'cropped', {
    boxes: JSON.stringify(BOXES),
    background: JSON.stringify({ kind: 'flat', color: '#f7f6f2' }),
    backgroundRemoval: 'auto',
    backgroundMethod: 'server',
  });
  const res = await send('GET', `/api/jobs/${withBackground}`, { key: user.sessionToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.data.background, { kind: 'flat', color: '#f7f6f2' });
  assert.equal(res.json.data.backgroundRemoval, 'auto');
  assert.equal(res.json.data.backgroundMethod, 'server');
  assert.equal(res.json.data.backgroundReason, undefined);

  const kept = await ctx.seedJob(user.id, 'cropped', {
    boxes: JSON.stringify(BOXES),
    background: JSON.stringify({ kind: 'complex' }),
    backgroundRemoval: 'auto',
    backgroundMethod: 'none',
    backgroundReason: 'AI removal is not available on this server.',
  });
  const keptRes = await send('GET', `/api/jobs/${kept}`, { key: user.sessionToken });
  assert.deepEqual(keptRes.json.data.background, { kind: 'complex' });
  assert.equal(keptRes.json.data.backgroundMethod, 'none');
  assert.equal(keptRes.json.data.backgroundReason, 'AI removal is not available on this server.');

  // A job detected before the classification existed, or a corrupt value, has none rather than an error.
  const legacy = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  const legacyRes = await send('GET', `/api/jobs/${legacy}`, { key: user.sessionToken });
  assert.equal(legacyRes.status, 200);
  assert.equal(legacyRes.json.data.background, undefined);
  const corrupt = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES), background: 'not json' });
  assert.equal((await send('GET', `/api/jobs/${corrupt}`, { key: user.sessionToken })).json.data.background, undefined);
});

test('GET /api/v1/jobs/:id returns background and backgroundRemoval, null until they exist', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const detected = await ctx.seedJob(user.id, 'detected', {
    boxes: JSON.stringify(BOXES),
    background: JSON.stringify({ kind: 'chroma', color: '#00ff00' }),
  });
  const first = await send('GET', `/api/v1/jobs/${detected}`, { key });
  assert.deepEqual(first.json.data.background, { kind: 'chroma', color: '#00ff00' });
  assert.equal(first.json.data.backgroundRemoval, null);

  const cropped = await ctx.seedJob(user.id, 'cropped', {
    boxes: JSON.stringify(BOXES),
    background: JSON.stringify({ kind: 'complex' }),
    backgroundRemoval: 'ai',
    backgroundMethod: 'ai',
  });
  const second = await send('GET', `/api/v1/jobs/${cropped}`, { key });
  assert.deepEqual(second.json.data.background, { kind: 'complex', color: null });
  assert.deepEqual(second.json.data.backgroundRemoval, { mode: 'ai', method: 'ai', reason: null });

  const legacy = await ctx.seedJob(user.id, 'detected', { boxes: JSON.stringify(BOXES) });
  assert.equal((await send('GET', `/api/v1/jobs/${legacy}`, { key })).json.data.background, null);
});

/* ------------------------------------------------------------------ *
 * POST /jobs/:id/export
 * ------------------------------------------------------------------ */

test('export: defaults to every asset at 2x and queues the same finalize job as the web app', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });
  const before = ctx.queued.length;

  const res = await send('POST', `/api/v1/jobs/${jobId}/export`, { key });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.jobId, jobId);
  assert.equal(res.json.data.namingPattern, '{name}', 'no pattern and no saved default: the default pattern');
  assert.equal(res.json.data.scale, 2);
  assert.deepEqual(res.json.data.files, [
    { id: 'box_1', name: 'fire_sword', fileName: 'fire_sword.png' },
    { id: 'box_2', name: 'health_potion', fileName: 'health_potion.png' },
  ]);
  assert.deepEqual(ctx.queued.slice(before), [{ queue: 'finalize', data: { jobId } }]);
  const job = await ctx.getJob(jobId);
  assert.deepEqual(JSON.parse(job?.selectedIds ?? '[]'), ['box_1', 'box_2']);
  assert.equal(job?.upscaleScale, '2');
  assert.equal(job?.skipUpscale, 'false');
});

test('export: options. A subset, new names, scale 4 (Pro allows it) and no upscale', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });

  const res = await send('POST', `/api/v1/jobs/${jobId}/export`, {
    key,
    body: { selectedIds: ['box_2', 'nope'], names: { box_2: 'big_potion' }, scale: 4 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const job = await ctx.getJob(jobId);
  assert.deepEqual(JSON.parse(job?.selectedIds ?? '[]'), ['box_2'], 'unknown ids are dropped');
  assert.equal(job?.upscaleScale, '4');
  const names = (JSON.parse(job?.assets ?? '[]') as { id: string; name: string }[]).map((a) => `${a.id}:${a.name}`);
  assert.deepEqual(names, ['box_1:fire_sword', 'box_2:big_potion']);
  assert.deepEqual(res.json.data.files, [{ id: 'box_2', name: 'big_potion', fileName: 'big_potion.png' }], 'only the selected, with the new name');
  assert.equal(res.json.data.scale, 4);

  const second = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });
  const plain = await send('POST', `/api/v1/jobs/${second}/export`, { key, body: { upscale: false } });
  assert.equal(plain.status, 201);
  assert.equal(plain.json.data.scale, 1, 'no upscaling: the naming scale is 1');
  assert.equal((await ctx.getJob(second))?.skipUpscale, 'true');
  assert.equal((await send('GET', `/api/v1/jobs/${second}`, { key })).json.data.export.scale, 1, 'the job reports the same factor');
});

test('export: validation, state, and ids that match nothing', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const cropped = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });
  const before = ctx.queued.length;

  for (const body of [{ scale: 3 }, { scale: '4' }, { upscale: 'yes' }, { selectedIds: [] }, { names: { box_1: '' } }, { selectedIds: 'all' }, { namingPattern: 5 }]) {
    const res = await send('POST', `/api/v1/jobs/${cropped}/export`, { key, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.json.code, 'VALIDATION_ERROR');
  }

  const none = await send('POST', `/api/v1/jobs/${cropped}/export`, { key, body: { selectedIds: ['nope'] } });
  assert.equal(none.status, 400);
  assert.equal(none.json.code, 'BAD_REQUEST', 'the shared export controller\'s own check gets a code too');

  for (const status of ['detected', 'finalizing', 'ready']) {
    const jobId = await ctx.seedJob(user.id, status, { assets: JSON.stringify(ASSETS) });
    const res = await send('POST', `/api/v1/jobs/${jobId}/export`, { key });
    assert.equal(res.status, 409, status);
    assert.equal(res.json.code, 'INVALID_JOB_STATE');
    assert.deepEqual(res.json.details, { status, expected: 'cropped' });
  }
  assert.equal(ctx.queued.length, before);
});

test('export: a naming pattern names the files, and the response lists them', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });

  const res = await send('POST', `/api/v1/jobs/${jobId}/export`, {
    key,
    body: { namingPattern: '{sheet}_{index:03}_{name}_{w}x{h}@{scale}x', scale: 4 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.namingPattern, '{sheet}_{index:03}_{name}_{w}x{h}@{scale}x');
  assert.equal(res.json.data.scale, 4);
  assert.deepEqual(
    res.json.data.files.map((f: { fileName: string }) => f.fileName),
    ['sheet_001_fire_sword_400x320@4x.png', 'sheet_002_health_potion_256x256@4x.png'],
    'the crop size times the upscale factor, the sheet name without its extension, the position padded',
  );
  assert.equal((await ctx.getJob(jobId))?.namingPattern, '{sheet}_{index:03}_{name}_{w}x{h}@{scale}x', 'stored on the job like a web export');
});

test('export: a bad pattern is 400 INVALID_PATTERN and nothing is queued', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });
  const before = ctx.queued.length;

  for (const namingPattern of ['{nope}', 'no tokens', '{name', 'a/{name}', '']) {
    const res = await send('POST', `/api/v1/jobs/${jobId}/export`, { key, body: { namingPattern } });
    assert.equal(res.status, 400, namingPattern);
    assert.equal(res.json.code, 'INVALID_PATTERN', namingPattern);
    assert.ok(Array.isArray(res.json.details.issues));
  }
  assert.equal(ctx.queued.length, before);
  assert.equal((await ctx.getJob(jobId))?.status, 'cropped', 'the job is untouched');
});

test('export: without a pattern the account\'s saved default applies, as on the web', { skip }, async () => {
  const user = await ctx.makeUser({ plan: 'pro', planSource: 'admin', exportNamingPattern: '{name}@{scale}x' });
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });

  const res = await send('POST', `/api/v1/jobs/${jobId}/export`, { key, body: {} });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.namingPattern, '{name}@{scale}x');
  assert.deepEqual(res.json.data.files.map((f: { fileName: string }) => f.fileName), ['fire_sword@2x.png', 'health_potion@2x.png']);

  const explicit = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });
  const over = await send('POST', `/api/v1/jobs/${explicit}/export`, { key, body: { namingPattern: '{name}' } });
  assert.deepEqual(over.json.data.files.map((f: { fileName: string }) => f.fileName), ['fire_sword.png', 'health_potion.png'], 'a pattern in the request wins');
});

test('export, finalize worker, job status and ZIP agree on the file names', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'cropped', { boxes: JSON.stringify(BOXES), assets: JSON.stringify(ASSETS) });

  const started = await send('POST', `/api/v1/jobs/${jobId}/export`, {
    key,
    body: { namingPattern: '{index:02}-{name}@{scale}x', scale: 2 },
  });
  assert.equal(started.status, 201);
  const promised = started.json.data.files.map((f: { fileName: string }) => f.fileName);
  assert.deepEqual(promised, ['01-fire_sword@2x.png', '02-health_potion@2x.png']);

  await ctx.runFinalize(jobId); // what the queue would do
  const status = await send('GET', `/api/v1/jobs/${jobId}`, { key });
  assert.equal(status.json.data.status, 'ready');
  assert.deepEqual(status.json.data.export, { scale: 2, namingPattern: '{index:02}-{name}@{scale}x', ready: true });
  assert.deepEqual(status.json.data.assets.map((a: { fileName: string }) => a.fileName), promised, 'the worker used the names the export promised');
  assert.ok(status.json.data.assets.every((a: { upscaledUrl: string }) => a.upscaledUrl.includes('@2x.png')));

  const zip = await send('GET', `/api/v1/jobs/${jobId}/download`, { key });
  assert.equal(zip.status, 200);
  const text = zip.raw.toString('latin1');
  for (const name of promised) assert.ok(text.includes(name), `${name} is in the ZIP, characters like @ intact`);
});

/* ------------------------------------------------------------------ *
 * GET /jobs/:id/download
 * ------------------------------------------------------------------ */

test('download: a ready export comes back as a ZIP of the selected, upscaled PNGs', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);
  const jobId = await ctx.seedJob(user.id, 'ready', {
    boxes: JSON.stringify(BOXES),
    assets: JSON.stringify([
      { ...ASSETS[0], name: 'sword_renamed', upscaled_url: 'https://res.example.test/up/fire_sword.png' },
      ASSETS[1],
    ]),
    selectedIds: JSON.stringify(['box_1']),
  });
  ctx.fetched.length = 0;

  const res = await send('GET', `/api/v1/jobs/${jobId}/download`, { key });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition') ?? '', new RegExp(`attachment; filename="openassets-${jobId}\\.zip"`));
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.raw.subarray(0, 2).toString('latin1'), 'PK', 'a real ZIP');

  assert.deepEqual(ctx.fetched, ['https://res.example.test/up/fire_sword.png'], 'only the selected asset, from its upscaled URL');
  const text = res.raw.toString('latin1');
  assert.ok(text.includes('sword_renamed.png'));
  assert.ok(text.includes('metadata.json'));
  assert.equal(text.includes('health_potion'), false, 'unselected assets are not in the ZIP');
});

test('download: before the export is ready it is 409 JOB_NOT_READY; a storage failure is 502 EXPORT_FETCH_FAILED', { skip }, async () => {
  const user = await ctx.makeUser();
  const { key } = await ctx.makeKey(user.id);

  for (const status of ['detected', 'cropped', 'finalizing', 'failed']) {
    const jobId = await ctx.seedJob(user.id, status, { assets: JSON.stringify(ASSETS) });
    const res = await send('GET', `/api/v1/jobs/${jobId}/download`, { key });
    assert.equal(res.status, 409, status);
    assert.equal(res.json.code, 'JOB_NOT_READY');
    assert.equal(res.json.details.status, status);
  }

  const ready = await ctx.seedJob(user.id, 'ready', { assets: JSON.stringify(ASSETS), selectedIds: JSON.stringify(['box_1']) });
  ctx.fetchFails.on = true;
  try {
    const res = await send('GET', `/api/v1/jobs/${ready}/download`, { key });
    assert.equal(res.status, 502);
    assert.equal(res.json.code, 'EXPORT_FETCH_FAILED');
  } finally {
    ctx.fetchFails.on = false;
  }
});
