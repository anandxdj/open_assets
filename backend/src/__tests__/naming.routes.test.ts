import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Route-level tests for custom naming patterns: the Pro gate on the server, the
 * saved default, the names a finalize gives its assets, and the names saved to a
 * collection. Against the real Express app, MongoDB and Redis, like
 * plans.routes.test.ts: they use `<MONGO_DB_NAME>_test` and Redis DB 15, and the
 * storage adapter is stubbed, so nothing leaves the machine.
 */

const mongoUri = process.env['MONGO_URI'];
const redisBase = process.env['REDIS_URL'];
const skip = (!mongoUri || !redisBase) && 'requires MONGO_URI and REDIS_URL';

const DAY = 24 * 60 * 60 * 1000;

// Boxes (asset ids are box ids) on an 800x600 sheet named "sprites.png".
const BOXES = JSON.stringify([
  { id: 'a1', x: 10, y: 10, width: 128, height: 96 },
  { id: 'a2', x: 200, y: 10, width: 64, height: 64 },
  { id: 'a3', x: 300, y: 10, width: 64, height: 64 },
]);
const asset = (id: string, name: string) => ({ id, name, cropped_url: `https://x/${id}.png`, public_id: `p_${id}` });
// Two assets share a name, and one has a space in it: both matter for the file names.
const ASSETS = JSON.stringify([asset('a1', 'Red Potion'), asset('a2', 'sword'), asset('a3', 'sword')]);

interface Ctx {
  base: string;
  makeUser: (extra?: Record<string, unknown>) => Promise<{ id: string; token: string; email: string }>;
  createJob: (userId: string, status: string, extra?: Record<string, string>) => Promise<string>;
  getJob: typeof import('../modules/jobs/job.store').getJob;
  User: typeof import('../modules/auth/auth.model').UserModel;
  Image: typeof import('../modules/collections/image.model').ImageModel;
  processFinalize: typeof import('../modules/workers/finalize.worker').processFinalize;
  upscaled: { publicId: string; scale: number | undefined; sourceWidth: number | undefined }[];
}

let ctx: Ctx;
let teardown: Array<() => Promise<void>> = [];

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '10.7.7.7',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

before(async () => {
  if (skip) return;
  process.env['REDIS_URL'] = `${(redisBase as string).replace(/\/\d+$/, '')}/15`;
  process.env['NODE_ENV'] = 'test';

  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(mongoUri as string, { dbName: `${process.env['MONGO_DB_NAME'] ?? 'open_assets'}_test` });
  const { UserModel } = await import('../modules/auth/auth.model');
  const { ImageModel } = await import('../modules/collections/image.model');
  const { CollectionModel } = await import('../modules/collections/collection.model');
  const { FolderModel } = await import('../modules/collections/folder.model');
  const { redis } = await import('../common/config/redis');
  const { detectionQueue, cropQueue, finalizeQueue } = await import('../common/config/bullmq');
  const { storage } = await import('../lib/storage');
  const { createJob: storeJob, updateJob, getJob } = await import('../modules/jobs/job.store');
  const { generateAccessToken } = await import('../common/utils/jwt.utils');
  const { processFinalize } = await import('../modules/workers/finalize.worker');
  const { createApp } = await import('../app');

  // The upscale provider is stubbed: it records the call and returns a URL.
  const upscaled: Ctx['upscaled'] = [];
  storage.applyUpscale = (async (publicId: string, scale?: number, sourceWidth?: number) => {
    upscaled.push({ publicId, scale, sourceWidth });
    return `https://res.example.test/up/${scale}x/${publicId}.png`;
  }) as typeof storage.applyUpscale;
  // The real queue is left in place but never consumed: no worker runs in tests.
  finalizeQueue.add = (async () => ({})) as unknown as typeof finalizeQueue.add;

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const users: unknown[] = [];
  const jobIds: string[] = [];

  ctx = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    getJob,
    User: UserModel,
    Image: ImageModel,
    processFinalize,
    upscaled,
    async makeUser(extra = {}) {
      const user = await UserModel.create({
        email: `naming-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        name: 'Naming Test',
        isVerified: true,
        ...extra,
      });
      users.push(user._id);
      return { id: String(user._id), token: generateAccessToken({ id: String(user._id) }), email: user.email };
    },
    async createJob(userId, status, extra = {}) {
      const jobId = `naming-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      jobIds.push(jobId);
      await storeJob(jobId, { cloudinaryUrl: 'https://res.cloudinary.com/x/y.png', publicId: 'y', userId, fileName: 'sprites.png' });
      await updateJob(jobId, {
        status: status as never,
        imageWidth: '800',
        imageHeight: '600',
        boxes: BOXES,
        assets: ASSETS,
        ...extra,
      });
      return jobId;
    },
  };

  teardown.unshift(async () => {
    const collections = await CollectionModel.find({ creator: { $in: users } }).select('_id');
    const collectionIds = collections.map((c) => c._id);
    await ImageModel.deleteMany({ collectionId: { $in: collectionIds } });
    await FolderModel.deleteMany({ collectionId: { $in: collectionIds } });
    await CollectionModel.deleteMany({ _id: { $in: collectionIds } });
    await UserModel.deleteMany({ _id: { $in: users } });
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

const PRO = { plan: 'pro', planSource: 'admin' } as const;
const lapsedPro = () => ({
  plan: 'pro',
  planSource: 'trial',
  trialStartedAt: new Date(Date.now() - 30 * DAY),
  trialEndsAt: new Date(Date.now() - DAY),
});

const fileNames = (res: { json: any }): string[] => res.json.data.files.map((f: { fileName: string }) => f.fileName);

// ── Saved default: GET and PUT /api/preferences/export ──────────────────────

test('preferences: need a session', { skip }, async () => {
  assert.equal((await call('GET', '/api/preferences/export', null)).status, 401);
  assert.equal((await call('PUT', '/api/preferences/export', null, { namingPattern: null })).status, 401);
});

test('preferences: a free user has the default pattern and nothing saved', { skip }, async () => {
  const user = await ctx.makeUser();
  const res = await call('GET', '/api/preferences/export', user.token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.data, { namingPattern: '{name}', savedPattern: null });
});

test('preferences: a free user cannot save a custom pattern (403 PLAN_REQUIRED) and nothing is stored', { skip }, async () => {
  const user = await ctx.makeUser();
  const res = await call('PUT', '/api/preferences/export', user.token, { namingPattern: '{sheet}_{name}' });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
  assert.equal(res.json.details.entitlement, 'customNamingPatterns');
  assert.match(res.json.message, /Custom naming patterns need the Pro plan/);
  assert.equal((await ctx.User.findById(user.id))?.exportNamingPattern, undefined);
});

test('preferences: Pro saves a pattern, it is trimmed, and GET returns it', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const saved = await call('PUT', '/api/preferences/export', user.token, { namingPattern: '  {sheet}_{index:03}_{name}  ' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.data, { namingPattern: '{sheet}_{index:03}_{name}', savedPattern: '{sheet}_{index:03}_{name}' });
  assert.equal((await ctx.User.findById(user.id))?.exportNamingPattern, '{sheet}_{index:03}_{name}');
  assert.deepEqual((await call('GET', '/api/preferences/export', user.token)).json.data, saved.json.data);
});

test('preferences: an invalid pattern is 400 INVALID_PATTERN with the problems, and is not saved', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  for (const bad of ['{foo}', 'static', '{name', 'a/{name}', '', '   ', `{name}${'x'.repeat(100)}`, '{index:9}']) {
    const res = await call('PUT', '/api/preferences/export', user.token, { namingPattern: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.json.code, 'INVALID_PATTERN', JSON.stringify(bad));
    assert.ok(Array.isArray(res.json.details.issues) && res.json.details.issues.length > 0, JSON.stringify(bad));
    assert.ok(res.json.message.length > 0);
  }
  assert.equal((await ctx.User.findById(user.id))?.exportNamingPattern, undefined);
  assert.equal((await call('PUT', '/api/preferences/export', user.token, { namingPattern: 5 })).status, 400);
  assert.equal((await call('PUT', '/api/preferences/export', user.token, {})).status, 400);
});

test('preferences: null or the default pattern clears the saved one', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  await call('PUT', '/api/preferences/export', user.token, { namingPattern: '{index}_{name}' });
  const cleared = await call('PUT', '/api/preferences/export', user.token, { namingPattern: null });
  assert.deepEqual(cleared.json.data, { namingPattern: '{name}', savedPattern: null });
  assert.equal((await ctx.User.findById(user.id))?.exportNamingPattern, undefined);

  await call('PUT', '/api/preferences/export', user.token, { namingPattern: '{index}_{name}' });
  const byDefault = await call('PUT', '/api/preferences/export', user.token, { namingPattern: '{name}' });
  assert.deepEqual(byDefault.json.data, { namingPattern: '{name}', savedPattern: null });
});

test('preferences: when Pro lapses the saved pattern is kept but not applied, and can still be reset', { skip }, async () => {
  const user = await ctx.makeUser({ ...lapsedPro(), exportNamingPattern: '{index}_{name}' });
  const read = await call('GET', '/api/preferences/export', user.token);
  assert.deepEqual(read.json.data, { namingPattern: '{name}', savedPattern: '{index}_{name}' });

  const edit = await call('PUT', '/api/preferences/export', user.token, { namingPattern: '{sheet}_{name}' });
  assert.equal(edit.status, 403);
  assert.equal(edit.json.code, 'PLAN_REQUIRED');

  const reset = await call('PUT', '/api/preferences/export', user.token, { namingPattern: null });
  assert.equal(reset.status, 200);
  assert.equal((await ctx.User.findById(user.id))?.exportNamingPattern, undefined);
});

// ── POST /api/jobs/:jobId/export-names ──────────────────────────────────────

test('export-names: free gets exactly the names exports always had', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, { selectedIds: ['a1', 'a2', 'a3'] });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.pattern, '{name}');
  assert.equal(res.json.data.scale, 1);
  assert.deepEqual(fileNames(res), ['Red_Potion.png', 'sword.png', 'sword_2.png']);
  assert.deepEqual(res.json.data.files.map((f: { id: string }) => f.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(res.json.data.files.map((f: { name: string }) => f.name), ['Red Potion', 'sword', 'sword']);
});

test('export-names: the default pattern spelled out is fine for free', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, { namingPattern: ' {name} ' });
  assert.equal(res.status, 200);
  assert.deepEqual(fileNames(res), ['Red_Potion.png', 'sword.png', 'sword_2.png']);
});

test('export-names: a free user sending a custom pattern is refused with 403 PLAN_REQUIRED', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, { namingPattern: '{index:03}_{name}' });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
  assert.equal(res.json.details.entitlement, 'customNamingPatterns');
});

test('export-names: a free user whose saved pattern is left over from Pro still gets the default', { skip }, async () => {
  const user = await ctx.makeUser({ ...lapsedPro(), exportNamingPattern: '{index}_{name}' });
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, {});
  assert.deepEqual(fileNames(res), ['Red_Potion.png', 'sword.png', 'sword_2.png']);
});

test('export-names: Pro applies the pattern with sheet, index, size and dedupe', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, {
    namingPattern: '{sheet}_{index:03}_{name}_{w}x{h}',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(fileNames(res), [
    'sprites_001_Red_Potion_128x96.png',
    'sprites_002_sword_64x64.png',
    'sprites_003_sword_64x64.png',
  ]);

  const collide = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, { namingPattern: '{sheet}_{w}_{name}' });
  assert.deepEqual(fileNames(collide), ['sprites_128_Red_Potion.png', 'sprites_64_sword.png', 'sprites_64_sword_2.png']);
});

test('export-names: Pro without a pattern in the request uses the saved default', { skip }, async () => {
  const user = await ctx.makeUser({ ...PRO, exportNamingPattern: '{index:02}-{name}' });
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, {});
  assert.equal(res.json.data.pattern, '{index:02}-{name}');
  assert.deepEqual(fileNames(res), ['01-Red_Potion.png', '02-sword.png', '03-sword.png']);
});

test('export-names: only the selected assets are named, in the job order', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, {
    selectedIds: ['a3', 'a1'],
    namingPattern: '{index}_{name}',
  });
  assert.deepEqual(res.json.data.files.map((f: { id: string }) => f.id), ['a1', 'a3']);
  assert.deepEqual(fileNames(res), ['1_Red_Potion.png', '2_sword.png']);
});

test('export-names: an upscaled export reports its scale and the larger size', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const jobId = await ctx.createJob(user.id, 'ready', { upscaleScale: '4', skipUpscale: 'false' });
  const res = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, { namingPattern: '{name}_{w}x{h}@{scale}x' });
  assert.equal(res.json.data.scale, 4);
  assert.deepEqual(fileNames(res), ['Red_Potion_512x384@4x.png', 'sword_256x256@4x.png', 'sword_256x256@4x_2.png']);
});

test('export-names: invalid patterns are 400, other people\'s jobs are 403, unknown jobs 404', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const other = await ctx.makeUser(PRO);
  const jobId = await ctx.createJob(user.id, 'cropped');

  const bad = await call('POST', `/api/jobs/${jobId}/export-names`, user.token, { namingPattern: '{nope}' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_PATTERN');

  assert.equal((await call('POST', `/api/jobs/${jobId}/export-names`, other.token, {})).status, 403);
  assert.equal((await call('POST', '/api/jobs/does-not-exist/export-names', user.token, {})).status, 404);
  assert.equal((await call('POST', `/api/jobs/${jobId}/export-names`, null, {})).status, 401);

  const empty = await ctx.createJob(user.id, 'detected', { assets: '[]' });
  assert.equal((await call('POST', `/api/jobs/${empty}/export-names`, user.token, {})).status, 400);
});

// ── POST /api/finalize ──────────────────────────────────────────────────────

test('finalize: a free user with a custom pattern is refused 403 PLAN_REQUIRED and the job is left alone', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'], namingPattern: '{index}_{name}' });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
  const job = await ctx.getJob(jobId);
  assert.equal(job?.status, 'cropped');
  assert.equal(job?.namingPattern, undefined);
});

test('finalize: free exports with the default pattern, and it is stored', { skip }, async () => {
  const user = await ctx.makeUser();
  const first = await ctx.createJob(user.id, 'cropped');
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId: first, selectedIds: ['a1'] })).status, 201);
  assert.equal((await ctx.getJob(first))?.namingPattern, '{name}');
  const second = await ctx.createJob(user.id, 'cropped');
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId: second, selectedIds: ['a1'], namingPattern: '{name}' })).status, 201);
});

test('finalize: a free account never uses a pattern left over from Pro', { skip }, async () => {
  const user = await ctx.makeUser({ ...lapsedPro(), exportNamingPattern: '{index}_{name}' });
  const jobId = await ctx.createJob(user.id, 'cropped');
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1'] })).status, 201);
  assert.equal((await ctx.getJob(jobId))?.namingPattern, '{name}');
});

test('finalize: Pro stores the pattern; without one the saved default applies; an invalid one is 400', { skip }, async () => {
  const user = await ctx.makeUser({ ...PRO, exportNamingPattern: '{sheet}_{name}' });

  const explicit = await ctx.createJob(user.id, 'cropped');
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId: explicit, selectedIds: ['a1'], namingPattern: '{index:03}_{name}' })).status, 201);
  assert.equal((await ctx.getJob(explicit))?.namingPattern, '{index:03}_{name}');

  const fallback = await ctx.createJob(user.id, 'cropped');
  assert.equal((await call('POST', '/api/finalize', user.token, { jobId: fallback, selectedIds: ['a1'] })).status, 201);
  assert.equal((await ctx.getJob(fallback))?.namingPattern, '{sheet}_{name}');

  const bad = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', '/api/finalize', user.token, { jobId: bad, selectedIds: ['a1'], namingPattern: 'x/{name}' });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'INVALID_PATTERN');
  assert.equal((await ctx.getJob(bad))?.status, 'cropped');
});

// ── The finalize worker names the files ─────────────────────────────────────

const parsedAssets = async (jobId: string) => JSON.parse((await ctx.getJob(jobId))?.assets ?? '[]') as Array<Record<string, string>>;

test('finalize worker: free names reproduce today\'s file names', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped');
  await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a1', 'a2', 'a3'] });
  await ctx.processFinalize(jobId);

  const job = await ctx.getJob(jobId);
  assert.equal(job?.status, 'ready');
  const assets = await parsedAssets(jobId);
  assert.deepEqual(assets.map((a) => a['file_name']), ['Red_Potion.png', 'sword.png', 'sword_2.png']);
  assert.ok(assets.every((a) => a['upscaled_url']?.includes('/up/2x/')), 'upscaled at the default 2x');
});

test('finalize worker: Pro pattern with sheet, index and the upscaled size', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', '/api/finalize', user.token, {
    jobId,
    selectedIds: ['a1', 'a2', 'a3'],
    scale: 4,
    namingPattern: '{sheet}_{index:03}_{name}_{w}x{h}@{scale}x',
  });
  assert.equal(res.status, 201);
  ctx.upscaled.length = 0;
  await ctx.processFinalize(jobId);

  assert.deepEqual((await parsedAssets(jobId)).map((a) => a['file_name']), [
    'sprites_001_Red_Potion_512x384@4x.png',
    'sprites_002_sword_256x256@4x.png',
    'sprites_003_sword_256x256@4x.png',
  ]);
  assert.equal(ctx.upscaled.length, 3, 'the (stubbed) storage upscaled every asset');
});

test('finalize worker: only the selected assets are named and numbered', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const jobId = await ctx.createJob(user.id, 'cropped');
  await call('POST', '/api/finalize', user.token, { jobId, selectedIds: ['a3', 'a1'], namingPattern: '{index}_{name}' });
  await ctx.processFinalize(jobId);
  const assets = await parsedAssets(jobId);
  assert.deepEqual(assets.map((a) => a['file_name']), ['1_Red_Potion.png', undefined, '2_sword.png']);
});

test('finalize worker: a skipped upscale names at scale 1', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const jobId = await ctx.createJob(user.id, 'cropped');
  await call('POST', '/api/finalize', user.token, {
    jobId,
    selectedIds: ['a1'],
    skipUpscale: true,
    namingPattern: '{name}_{w}x{h}@{scale}x',
  });
  ctx.upscaled.length = 0;
  await ctx.processFinalize(jobId);
  assert.deepEqual((await parsedAssets(jobId)).map((a) => a['file_name']), ['Red_Potion_128x96@1x.png', undefined, undefined]);
  assert.equal(ctx.upscaled.length, 0);
});

test('finalize worker: a stored pattern that cannot be applied falls back to the default instead of failing', { skip }, async () => {
  const user = await ctx.makeUser();
  const jobId = await ctx.createJob(user.id, 'cropped', { selectedIds: JSON.stringify(['a1', 'a2']), namingPattern: '{broken', upscaleScale: '2' });
  await ctx.processFinalize(jobId);
  assert.equal((await ctx.getJob(jobId))?.status, 'ready');
  assert.deepEqual((await parsedAssets(jobId)).map((a) => a['file_name']), ['Red_Potion.png', 'sword.png', undefined]);
});

// ── Saving to a collection ──────────────────────────────────────────────────

async function makeFolder(token: string): Promise<{ collectionId: string; folderId: string }> {
  const collection = await call('POST', '/api/collections', token, { name: 'Naming pack' });
  assert.equal(collection.status, 201, JSON.stringify(collection.json));
  const collectionId = collection.json.data._id as string;
  const folder = await call('POST', `/api/collections/${collectionId}/folders`, token, { name: 'Assets' });
  assert.equal(folder.status, 201, JSON.stringify(folder.json));
  return { collectionId, folderId: folder.json.data._id as string };
}

const savedNames = (res: { json: any }): string[] => res.json.data.map((i: { name: string }) => i.name);

test('collections: free keeps each asset\'s name exactly as it is', { skip }, async () => {
  const user = await ctx.makeUser();
  const { collectionId, folderId } = await makeFolder(user.token);
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/collections/${collectionId}/folders/${folderId}/images`, user.token, {
    jobId,
    assetIds: ['a1', 'a2', 'a3'],
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(savedNames(res), ['Red Potion', 'sword', 'sword']);
});

test('collections: a free user sending a custom pattern is refused 403 PLAN_REQUIRED and nothing is saved', { skip }, async () => {
  const user = await ctx.makeUser();
  const { collectionId, folderId } = await makeFolder(user.token);
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/collections/${collectionId}/folders/${folderId}/images`, user.token, {
    jobId,
    assetIds: ['a1'],
    namingPattern: '{index}_{name}',
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
  assert.equal(await ctx.Image.countDocuments({ collectionId }), 0);
});

test('collections: Pro names the saved images with the pattern', { skip }, async () => {
  const user = await ctx.makeUser(PRO);
  const { collectionId, folderId } = await makeFolder(user.token);
  const jobId = await ctx.createJob(user.id, 'cropped');
  const res = await call('POST', `/api/collections/${collectionId}/folders/${folderId}/images`, user.token, {
    jobId,
    assetIds: ['a1', 'a2', 'a3'],
    namingPattern: '{sheet}_{index:02}_{name}',
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(savedNames(res), ['sprites_01_Red_Potion', 'sprites_02_sword', 'sprites_03_sword']);
  // The original name is still what the upscale swap and the AI data match on.
  assert.deepEqual(res.json.data.map((i: { sourceAssetName: string }) => i.sourceAssetName), ['Red Potion', 'sword', 'sword']);
});

test('collections: Pro without a pattern in the request uses the saved default; an invalid one is 400', { skip }, async () => {
  const user = await ctx.makeUser({ ...PRO, exportNamingPattern: '{index}-{name}' });
  const { collectionId, folderId } = await makeFolder(user.token);
  const jobId = await ctx.createJob(user.id, 'cropped');
  const path = `/api/collections/${collectionId}/folders/${folderId}/images`;

  const saved = await call('POST', path, user.token, { jobId, assetIds: ['a2', 'a3'] });
  assert.deepEqual(savedNames(saved), ['1-sword', '2-sword']);

  const bad = await call('POST', path, user.token, { jobId, assetIds: ['a1'], namingPattern: '{nope}' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_PATTERN');
});
