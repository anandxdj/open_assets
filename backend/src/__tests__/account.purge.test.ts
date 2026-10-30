import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { purgeUserRedisData } from '../modules/account/account.purge';
import { jobKey, userJobsKey } from '../modules/jobs/job.keys';
import { aiEnhanceKey } from '../modules/enhance/aiEnhance.store';

// What account deletion removes from Redis: the history index, the user's job
// hashes, their AI enhance jobs, and the stored files behind them. Uses Redis DB
// 15 on the server REDIS_URL points at, with random ids, and cleans up after.

const redisBase = process.env['REDIS_URL'];
const skip = !redisBase && 'requires REDIS_URL';

let client: Redis;
const keys: string[] = [];

before(() => {
  if (skip) return;
  client = new Redis(`${(redisBase as string).replace(/\/\d+$/, '')}/15`, { maxRetriesPerRequest: null });
  client.on('error', () => undefined);
});

after(async () => {
  if (skip) return;
  if (keys.length) await client.del(...keys);
  await client.quit();
});

async function seedJob(userId: string, owner: string, publicId: string, assetIds: string[], inIndexOf = userId) {
  const id = randomUUID();
  const key = jobKey(id);
  keys.push(key, userJobsKey(inIndexOf));
  await client.hset(key, {
    userId: owner,
    publicId,
    assets: JSON.stringify(assetIds.map((public_id) => ({ id: public_id, name: public_id, cropped_url: 'x', public_id }))),
  });
  await client.zadd(userJobsKey(inIndexOf), Date.now(), id);
  return id;
}

async function seedEnhance(owner: string, sourcePublicId: string) {
  const id = randomUUID();
  keys.push(aiEnhanceKey(id));
  await client.hset(aiEnhanceKey(id), { id, userId: owner, sourcePublicId, status: 'ready' });
  return id;
}

test('purge removes the user\'s history index, job hashes and enhance jobs, and deletes their files', { skip }, async () => {
  const a = `purge-a-${randomUUID()}`;
  const b = `purge-b-${randomUUID()}`;

  const a1 = await seedJob(a, a, 'orig-a1', ['crop-a1-1', 'crop-a1-2']);
  const a2 = await seedJob(a, a, 'orig-a2', []);
  const b1 = await seedJob(b, b, 'orig-b1', ['crop-b1']);
  // A stale entry: A's index points at a job that belongs to B. It must not be touched.
  const wrong = await seedJob(a, b, 'orig-wrong', ['crop-wrong'], a);
  const ea = await seedEnhance(a, 'enh-src-a');
  const eb = await seedEnhance(b, 'enh-src-b');

  const deleted: string[] = [];
  const result = await purgeUserRedisData(a, {
    client,
    deleteFile: async (publicId) => {
      deleted.push(publicId);
      if (publicId === 'crop-a1-2') throw new Error('provider unavailable'); // must not stop the rest
    },
  });

  assert.deepEqual(result, { jobs: 2, enhanceJobs: 1, filesDeleted: 4, filesFailed: 1 });
  assert.deepEqual(deleted.sort(), ['crop-a1-1', 'crop-a1-2', 'enh-src-a', 'orig-a1', 'orig-a2']);

  // A's data is gone.
  assert.equal(await client.exists(userJobsKey(a)), 0);
  assert.equal(await client.exists(jobKey(a1), jobKey(a2)), 0);
  assert.equal(await client.exists(aiEnhanceKey(ea)), 0);

  // B's data, and the job A's stale entry pointed at, are untouched.
  assert.equal(await client.exists(jobKey(b1)), 1);
  assert.equal(await client.exists(jobKey(wrong)), 1);
  assert.equal(await client.exists(aiEnhanceKey(eb)), 1);
  assert.equal(await client.zcard(userJobsKey(b)), 1);
});

test('purge for a user with nothing stored is a no-op', { skip }, async () => {
  const deleted: string[] = [];
  const result = await purgeUserRedisData(`purge-none-${randomUUID()}`, {
    client,
    deleteFile: async (id) => void deleted.push(id),
  });
  assert.deepEqual(result, { jobs: 0, enhanceJobs: 0, filesDeleted: 0, filesFailed: 0 });
  assert.deepEqual(deleted, []);
});

test('purge never throws when Redis is unreachable, and does not hang', async () => {
  const saved = process.env['REDIS_URL'];
  process.env['REDIS_URL'] = 'redis://127.0.0.1:1'; // nothing listens here
  try {
    const result = await purgeUserRedisData('someone', { deleteFile: async () => undefined });
    assert.deepEqual(result, { jobs: 0, enhanceJobs: 0, filesDeleted: 0, filesFailed: 0 });
  } finally {
    if (saved === undefined) delete process.env['REDIS_URL'];
    else process.env['REDIS_URL'] = saved;
  }
});
