import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

// Job history over HTTP: GET /api/jobs, DELETE /api/jobs/:jobId/history and
// DELETE /api/jobs/history, against a real Redis. Like the credits race test in
// usage.test.ts these only run when the environment points at one:
//
//   REDIS_URL=redis://127.0.0.1:6379/6 pnpm test
//
// Every test works on its own random user ids and deletes what it created, so
// a shared development database is safe. MongoDB is not needed: the one thing
// auth.middleware asks it, "does this user exist?", is answered by a stub.

const REDIS_URL = process.env['REDIS_URL'];
const skip = !REDIS_URL && 'requires REDIS_URL';

type Store = typeof import('../modules/jobs/job.store');
type RedisClient = typeof import('../common/config/redis')['redis'];

let store: Store;
let redis: RedisClient;
let server: Server;
let baseUrl: string;

let signToken: (userId: string) => string;

const users = new Set<string>();
const jobIds = new Set<string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  if (skip) return;
  const { generateAccessToken } = await import('../common/utils/jwt.utils');
  const { UserModel } = await import('../modules/auth/auth.model');
  const { jobRouter } = await import('../modules/jobs/job.routes');
  const { errorHandler } = await import('../common/middlewares/errorHandler');
  ({ redis } = await import('../common/config/redis'));
  store = await import('../modules/jobs/job.store');
  signToken = (id) => generateAccessToken({ id });

  mock.method(UserModel, 'findById', async (id: string) =>
    users.has(id) ? { _id: id, email: `${id}@test.local`, name: 'Test', role: 'user' } : null,
  );

  const app = express();
  app.use(express.json());
  app.use('/api', jobRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  if (skip) return;
  mock.restoreAll();
  server.closeAllConnections();
  server.close();
  const keys = [...jobIds].map((id) => `job:${id}`);
  for (const user of users) keys.push(`user:${user}:jobs`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

function newUser(): string {
  const id = randomUUID();
  users.add(id);
  return id;
}

/** What the upload controller does: createJob() for the signed-in user. */
async function upload(userId: string, fileName: string): Promise<string> {
  const jobId = randomUUID();
  jobIds.add(jobId);
  await store.createJob(jobId, {
    cloudinaryUrl: `https://img.test/${jobId}.png`,
    publicId: `originals/${jobId}`,
    userId,
    fileName,
  });
  await sleep(3); // distinct creation times, so "newest first" is unambiguous
  return jobId;
}

interface Page {
  jobs: { jobId: string; status: string; fileName?: string; assetCount: number; createdAt: string; imageUrl: string; error?: string }[];
  nextCursor: string | null;
}

async function call(method: string, path: string, userId?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: userId ? { Authorization: `Bearer ${signToken(userId)}` } : undefined,
  });
  const body = (await res.json()) as { success: boolean; message: string; data: unknown };
  return { status: res.status, body };
}

async function list(userId: string, query = ''): Promise<Page> {
  const res = await call('GET', `/jobs${query}`, userId);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as Page;
}

const ids = (page: Page) => page.jobs.map((job) => job.jobId);

// ── auth ────────────────────────────────────────────────────────────────────

test('every history endpoint requires authentication', { skip }, async () => {
  for (const [method, path] of [
    ['GET', '/jobs'],
    ['DELETE', '/jobs/history'],
    ['DELETE', `/jobs/${randomUUID()}/history`],
  ] as const) {
    const res = await call(method, path);
    assert.equal(res.status, 401, `${method} ${path} without a token`);
    assert.equal(res.body.success, false);
  }

  const forged = await fetch(`${baseUrl}/jobs`, { headers: { Authorization: 'Bearer not-a-real-token' } });
  assert.equal(forged.status, 401, 'a bad token');

  const stranger = await call('GET', '/jobs', randomUUID()); // valid token shape, user not in the DB
  assert.equal(stranger.status, 401, 'a token for a user that does not exist');
});

// ── listing ─────────────────────────────────────────────────────────────────

test('lists only the signed-in user\'s jobs, newest first', { skip }, async () => {
  const alice = newUser();
  const bob = newUser();
  const a1 = await upload(alice, 'first.png');
  const b1 = await upload(bob, 'bobs.png');
  const a2 = await upload(alice, 'second.png');
  const a3 = await upload(alice, 'third.png');

  const forAlice = await list(alice);
  assert.deepEqual(ids(forAlice), [a3, a2, a1]);
  assert.equal(forAlice.nextCursor, null);
  assert.deepEqual(ids(await list(bob)), [b1]);
  assert.deepEqual(await list(newUser()), { jobs: [], nextCursor: null }, 'a user with no uploads');

  const first = forAlice.jobs[2];
  assert.ok(first);
  assert.equal(first.status, 'uploaded');
  assert.equal(first.fileName, 'first.png');
  assert.equal(first.assetCount, 0);
  assert.equal(first.imageUrl, `https://img.test/${a1}.png`);
  assert.equal(first.error, undefined);
  assert.ok(!Number.isNaN(Date.parse(first.createdAt)));
  assert.deepEqual(
    forAlice.jobs.map((job) => Date.parse(job.createdAt)),
    forAlice.jobs.map((job) => Date.parse(job.createdAt)).sort((x, y) => y - x),
  );
});

test('a job id planted in another user\'s index is never listed, and is pruned', { skip }, async () => {
  const alice = newUser();
  const bob = newUser();
  const bobs = await upload(bob, 'private.png');
  const mine = await upload(alice, 'mine.png');
  await redis.zadd(`user:${alice}:jobs`, Date.now() + 1000, bobs);

  assert.deepEqual(ids(await list(alice)), [mine]);
  assert.equal(await redis.zscore(`user:${alice}:jobs`, bobs), null, 'pruned from the wrong index');
  assert.deepEqual(ids(await list(bob)), [bobs], 'and still in the right one');
});

test('shows live status, error, file name and asset count', { skip }, async () => {
  const user = newUser();
  const ok = await upload(user, 'sheet.png');
  const boxesOnly = await upload(user, 'boxes.png');
  const bad = await upload(user, 'bad.png');

  await store.updateJob(ok, { status: 'ready', assets: JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) });
  await store.updateJob(boxesOnly, { status: 'detected', boxes: JSON.stringify([{ id: 'x' }, { id: 'y' }]) });
  await store.updateJob(bad, { status: 'failed', error: 'detector crashed' });

  const byId = new Map((await list(user)).jobs.map((job) => [job.jobId, job]));
  assert.deepEqual(
    [byId.get(ok)?.status, byId.get(ok)?.assetCount],
    ['ready', 3],
    'assets win once there are any',
  );
  assert.deepEqual([byId.get(boxesOnly)?.status, byId.get(boxesOnly)?.assetCount], ['detected', 2]);
  assert.deepEqual([byId.get(bad)?.status, byId.get(bad)?.error], ['failed', 'detector crashed']);
});

test('GET /jobs/:jobId returns the stored file name too', { skip }, async () => {
  const user = newUser();
  const job = await upload(user, 'named.png');
  const res = await call('GET', `/jobs/${job}`, user);
  assert.equal(res.status, 200);
  assert.equal((res.body.data as { fileName?: string }).fileName, 'named.png');
});

// ── pagination ──────────────────────────────────────────────────────────────

test('pages through the list with a cursor: no gaps, no repeats, no empty last page', { skip }, async () => {
  const user = newUser();
  const created: string[] = [];
  for (let i = 0; i < 5; i++) created.unshift(await upload(user, `p${i}.png`)); // newest first

  const p1 = await list(user, '?limit=2');
  assert.deepEqual(ids(p1), created.slice(0, 2));
  assert.ok(p1.nextCursor);
  const p2 = await list(user, `?limit=2&cursor=${p1.nextCursor}`);
  assert.deepEqual(ids(p2), created.slice(2, 4));
  assert.ok(p2.nextCursor);
  const p3 = await list(user, `?limit=2&cursor=${p2.nextCursor}`);
  assert.deepEqual(ids(p3), created.slice(4));
  assert.equal(p3.nextCursor, null);

  // A list that fills the last page exactly must not advertise another one.
  const even = newUser();
  for (let i = 0; i < 4; i++) await upload(even, `e${i}.png`);
  const e1 = await list(even, '?limit=2');
  const e2 = await list(even, `?limit=2&cursor=${e1.nextCursor}`);
  assert.equal(e2.jobs.length, 2);
  assert.equal(e2.nextCursor, null);

  assert.equal((await list(user, '?limit=5')).nextCursor, null, 'limit equal to the size');
  assert.equal((await list(user, '?limit=100')).jobs.length, 5);
});

test('jobs created in the same millisecond page without loss or repeats', { skip }, async () => {
  const user = newUser();
  const members: string[] = [];
  const now = Date.now();
  for (let i = 0; i < 7; i++) {
    const id = randomUUID();
    jobIds.add(id);
    members.push(id);
    await redis.hset(`job:${id}`, { status: 'queued', userId: user, createdAt: new Date(now).toISOString() });
    await redis.expire(`job:${id}`, 60);
    await redis.zadd(`user:${user}:jobs`, now, id); // one score for all
  }

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: Page = await list(user, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
    seen.push(...ids(page));
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 10);

  assert.equal(pages, 3);
  assert.deepEqual(seen, [...members].sort().reverse(), 'Redis breaks score ties by member, reversed');
});

test('a cursor stays valid when its job is removed between pages', { skip }, async () => {
  const user = newUser();
  const created: string[] = [];
  for (let i = 0; i < 4; i++) created.unshift(await upload(user, `c${i}.png`));

  const p1 = await list(user, '?limit=2');
  const lastOnPage = ids(p1)[1] as string;
  assert.equal((await call('DELETE', `/jobs/${lastOnPage}/history`, user)).status, 200);

  const p2 = await list(user, `?limit=2&cursor=${p1.nextCursor}`);
  assert.deepEqual(ids(p2), created.slice(2), 'continues right after where the last page ended');
});

test('rejects a bad limit or cursor with 400', { skip }, async () => {
  const user = newUser();
  for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?limit=1.5', '?cursor=nope', '?limit=2&cursor=']) {
    const res = await call('GET', `/jobs${query}`, user);
    assert.equal(res.status, 400, query);
  }
});

// ── expiry ──────────────────────────────────────────────────────────────────

test('jobs whose hash has expired drop out of the list and the index', { skip }, async () => {
  const user = newUser();
  const old = await upload(user, 'old.png');
  const keep = await upload(user, 'keep.png');
  const dying = await upload(user, 'dying.png');
  await redis.pexpire(`job:${dying}`, 40); // a real TTL running out, not a delete
  await sleep(120);

  assert.deepEqual(ids(await list(user)), [keep, old]);
  assert.equal(await redis.zcard(`user:${user}:jobs`), 2, 'dead entry pruned on read');
});

test('dead entries do not shorten a page or fake a next page', { skip }, async () => {
  const user = newUser();
  const created: string[] = [];
  for (let i = 0; i < 6; i++) created.unshift(await upload(user, `d${i}.png`)); // newest first
  // Expire the two newest and one in the middle.
  for (const gone of [created[0], created[1], created[3]]) await redis.del(`job:${gone as string}`);
  const live = [created[2], created[4], created[5]] as string[];

  const p1 = await list(user, '?limit=2');
  assert.deepEqual(ids(p1), live.slice(0, 2), 'filled from older jobs');
  assert.ok(p1.nextCursor);
  const p2 = await list(user, `?limit=2&cursor=${p1.nextCursor}`);
  assert.deepEqual(ids(p2), live.slice(2));
  assert.equal(p2.nextCursor, null);

  // Only dead entries left past the page: no next page.
  const only = newUser();
  const keep = await upload(only, 'keep.png');
  const dead = await upload(only, 'dead.png');
  await redis.del(`job:${dead}`);
  const page = await list(only, '?limit=1');
  assert.deepEqual(ids(page), [keep]);
  assert.equal(page.nextCursor, null);
});

test('a hash recreated without an owner after expiry is not listed', { skip }, async () => {
  // A worker that finishes after the job expired makes updateJob() write a bare hash.
  const user = newUser();
  const job = await upload(user, 'late.png');
  await redis.del(`job:${job}`);
  await store.updateJob(job, { status: 'ready' });
  assert.deepEqual((await list(user)).jobs, []);
});

// ── how many Redis calls a list costs ───────────────────────────────────────

test('a page is one index read plus one pipeline, not a call per job', { skip }, async () => {
  const user = newUser();
  for (let i = 0; i < 8; i++) await upload(user, `n${i}.png`);

  const pipeline = mock.method(redis, 'pipeline');
  const hmget = mock.method(redis, 'hmget');
  const hgetall = mock.method(redis, 'hgetall');
  const zrevrange = mock.method(redis, 'zrevrange');
  try {
    assert.equal((await list(user, '?limit=8')).jobs.length, 8);
    assert.equal(pipeline.mock.callCount(), 1, 'one pipeline for all eight jobs');
    assert.equal(zrevrange.mock.callCount(), 1);
    assert.equal(hmget.mock.callCount(), 0, 'no unpipelined HMGET');
    assert.equal(hgetall.mock.callCount(), 0, 'whole job hashes are never loaded');
  } finally {
    pipeline.mock.restore();
    hmget.mock.restore();
    hgetall.mock.restore();
    zrevrange.mock.restore();
  }
});

test('the index is capped, dropping the oldest entries', { skip }, async () => {
  const user = newUser();
  const first = await upload(user, 'oldest.png');
  for (let i = 0; i < store.USER_JOBS_MAX; i++) await upload(user, `cap${i}.png`);

  assert.equal(await redis.zcard(`user:${user}:jobs`), store.USER_JOBS_MAX);
  assert.equal(await redis.zscore(`user:${user}:jobs`, first), null);
  const ttl = await redis.ttl(`user:${user}:jobs`);
  assert.ok(ttl > 0, 'the index expires if the user goes quiet');
  assert.equal((await list(user, '?limit=100')).jobs.length, store.USER_JOBS_MAX);
});

// ── remove one / clear all ──────────────────────────────────────────────────

test('removing a job takes it off the list and nothing else', { skip }, async () => {
  const user = newUser();
  const keep = await upload(user, 'keep.png');
  const drop = await upload(user, 'drop.png');

  const res = await call('DELETE', `/jobs/${drop}/history`, user);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { removed: 1 });
  assert.deepEqual(ids(await list(user)), [keep]);

  // The job is not deleted: still readable by its owner, and still in Redis.
  assert.equal((await call('GET', `/jobs/${drop}`, user)).status, 200);
  assert.equal(await redis.exists(`job:${drop}`), 1);
  // Later updates from the pipeline do not bring it back.
  await store.updateJob(drop, { status: 'ready' });
  assert.deepEqual(ids(await list(user)), [keep]);

  // Removing again, or removing an unknown id, is fine and reports nothing removed.
  assert.deepEqual((await call('DELETE', `/jobs/${drop}/history`, user)).body.data, { removed: 0 });
  assert.deepEqual((await call('DELETE', `/jobs/${randomUUID()}/history`, user)).body.data, { removed: 0 });
});

test('removing another user\'s job id changes nothing for them', { skip }, async () => {
  const alice = newUser();
  const bob = newUser();
  const bobs = await upload(bob, 'bobs.png');

  const res = await call('DELETE', `/jobs/${bobs}/history`, alice);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { removed: 0 });
  assert.deepEqual(ids(await list(bob)), [bobs]);
});

test('clearing empties the user\'s list only', { skip }, async () => {
  const alice = newUser();
  const bob = newUser();
  const a1 = await upload(alice, 'a1.png');
  await upload(alice, 'a2.png');
  const b1 = await upload(bob, 'b1.png');

  const res = await call('DELETE', '/jobs/history', alice);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { removed: 2 });
  assert.deepEqual(await list(alice), { jobs: [], nextCursor: null });
  assert.deepEqual(ids(await list(bob)), [b1], "Bob's list is untouched");
  assert.equal(await redis.exists(`job:${a1}`), 1, 'the jobs themselves stay until they expire');

  assert.deepEqual((await call('DELETE', '/jobs/history', alice)).body.data, { removed: 0 }, 'clearing twice');

  const next = await upload(alice, 'after.png');
  assert.deepEqual(ids(await list(alice)), [next], 'new uploads are listed again');
});
