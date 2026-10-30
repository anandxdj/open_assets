import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { generateApiKey, hashApiKey, looksLikeApiKey, KEY_PREFIX } from '../modules/apikeys/apiKey.service';
import { apiKeyRouter } from '../modules/apikeys/apiKey.routes';
import { generateAccessToken } from '../common/utils/jwt.utils';
import { call, startTestServer } from './http-test-utils';
import type { TestServer } from './http-test-utils';

// API key management (GET/POST/DELETE /api/api-keys). The first block needs no
// database; the second drives the real router against MongoDB and runs when
// MONGO_URI is set.

/* ------------------------------------------------------------------ *
 * Pure: key generation and hashing
 * ------------------------------------------------------------------ */

test('a key is oa_live_ plus 48 hex characters, and its prefix is its first 12', () => {
  const { key, prefix } = generateApiKey();
  assert.match(key, /^oa_live_[0-9a-f]{48}$/);
  assert.equal(prefix, key.slice(0, 12));
  assert.equal(prefix.startsWith(KEY_PREFIX), true);
  assert.equal(looksLikeApiKey(key), true);
});

test('keys are random: 200 generated keys are all different', () => {
  const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
  assert.equal(keys.size, 200);
});

test('the stored hash is the SHA-256 of the whole key and does not contain it', () => {
  const { key, keyHash } = generateApiKey();
  assert.equal(keyHash, createHash('sha256').update(key).digest('hex'));
  assert.equal(keyHash, hashApiKey(key));
  assert.match(keyHash, /^[0-9a-f]{64}$/);
  assert.equal(keyHash.includes(key.slice(KEY_PREFIX.length)), false);
});

test('looksLikeApiKey rejects session tokens, truncated keys and look-alikes', () => {
  assert.equal(looksLikeApiKey(generateAccessToken({ id: 'a'.repeat(24) })), false);
  assert.equal(looksLikeApiKey('oa_live_abc'), false);
  assert.equal(looksLikeApiKey(`oa_test_${'a'.repeat(48)}`), false);
  assert.equal(looksLikeApiKey(`oa_live_${'A'.repeat(48)}`), false, 'uppercase is not what we issue');
  assert.equal(looksLikeApiKey(`oa_live_${'a'.repeat(48)}x`), false);
  assert.equal(looksLikeApiKey(''), false);
});

describe('key routes reject callers without a web session', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer((app) => app.use('/api/api-keys', apiKeyRouter));
  });
  after(() => server.close());

  for (const [method, path, body] of [
    ['GET', '/api/api-keys'],
    ['POST', '/api/api-keys', { name: 'ci' }],
    ['DELETE', `/api/api-keys/${'a'.repeat(24)}`],
  ] as Array<[string, string, unknown?]>) {
    test(`${method} ${path.replace(/[a-f0-9]{24}/, ':id')} without a token is 401`, async () => {
      const res = await call(server.url, method, path, { body });
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });
  }

  test('an API key is not a session: it cannot list, create or revoke keys', async () => {
    const { key } = generateApiKey();
    assert.equal((await call(server.url, 'GET', '/api/api-keys', { token: key })).status, 401);
    assert.equal((await call(server.url, 'POST', '/api/api-keys', { token: key, body: { name: 'x' } })).status, 401);
  });
});

/* ------------------------------------------------------------------ *
 * With MongoDB: the real router
 * ------------------------------------------------------------------ */

const needsMongo = !process.env.MONGO_URI && 'requires MONGO_URI';
const DAY = 24 * 60 * 60 * 1000;

describe('API keys (MongoDB)', { skip: needsMongo }, () => {
  let mongoose: typeof import('mongoose').default;
  let UserModel: typeof import('../modules/auth/auth.model').UserModel;
  let ApiKeyModel: typeof import('../modules/apikeys/apiKey.model').ApiKeyModel;
  let server: TestServer;
  const userIds: string[] = [];

  before(async () => {
    mongoose = (await import('mongoose')).default;
    ({ UserModel } = await import('../modules/auth/auth.model'));
    ({ ApiKeyModel } = await import('../modules/apikeys/apiKey.model'));
    await mongoose.connect(process.env.MONGO_URI as string, {
      dbName: `${process.env.MONGO_DB_NAME ?? 'open_assets'}_test`,
    });
    await ApiKeyModel.init();
    server = await startTestServer((app) => app.use('/api/api-keys', apiKeyRouter));
  });

  after(async () => {
    await server?.close();
    await ApiKeyModel.deleteMany({ userId: { $in: userIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
  });

  async function makeUser(extra: Record<string, unknown> = {}) {
    const email = `apikeys-${randomUUID()}@test.local`;
    const user = await UserModel.create({ email, name: 'Key Tester', isVerified: true, ...extra });
    const id = String(user._id);
    userIds.push(id);
    return { id, email, token: generateAccessToken({ id: user._id, email, name: user.name, role: 'user' }) };
  }
  const makePro = () => makeUser({ plan: 'pro', planSource: 'admin' });
  const create = (token: string, name = 'CI export') => call(server.url, 'POST', '/api/api-keys', { token, body: { name } });
  const list = (token: string) => call(server.url, 'GET', '/api/api-keys', { token });

  test('creating a key returns the full key once; only its hash and prefix are stored', async () => {
    const u = await makePro();
    const res = await create(u.token, '  Nightly build  ');
    assert.equal(res.status, 201);

    const { key, id, name, prefix, createdAt, lastUsedAt } = res.body.data;
    assert.match(key, /^oa_live_[0-9a-f]{48}$/);
    assert.equal(name, 'Nightly build', 'the name is trimmed');
    assert.equal(prefix, key.slice(0, 12));
    assert.equal(lastUsedAt, null);
    assert.ok(Date.parse(createdAt));

    const stored = await ApiKeyModel.collection.find({ userId: new mongoose.Types.ObjectId(u.id) }).toArray();
    assert.equal(stored.length, 1);
    const raw = JSON.stringify(stored[0]);
    assert.equal(raw.includes(key), false, 'the plaintext key is nowhere in the document');
    assert.equal(raw.includes(key.slice(KEY_PREFIX.length)), false, 'nor is the secret part');
    assert.equal(stored[0]?.['keyHash'], hashApiKey(key));
    assert.equal(String(stored[0]?._id), id);

    // And it is not shown again.
    const listed = await list(u.token);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 1);
    assert.deepEqual(Object.keys(listed.body.data[0]).sort(), ['createdAt', 'id', 'lastUsedAt', 'name', 'prefix']);
    assert.equal(JSON.stringify(listed.body).includes(key), false);
    assert.equal(JSON.stringify(listed.body).includes(hashApiKey(key)), false);
  });

  test('free accounts cannot create a key: 403 PLAN_REQUIRED, nothing stored; listing is an empty list', async () => {
    const u = await makeUser();
    const res = await create(u.token);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'PLAN_REQUIRED');
    assert.equal(res.body.details.entitlement, 'apiKeys');
    assert.equal(await ApiKeyModel.countDocuments({ userId: u.id }), 0);

    const listed = await list(u.token);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data, []);
  });

  test('Pro holds 5 active keys; the 6th is 403 PLAN_LIMIT, and revoking one frees a slot', async () => {
    const u = await makePro();
    const ids: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const res = await create(u.token, `key ${i}`);
      assert.equal(res.status, 201, `key ${i}`);
      ids.push(res.body.data.id);
    }

    const sixth = await create(u.token, 'key 6');
    assert.equal(sixth.status, 403);
    assert.equal(sixth.body.code, 'PLAN_LIMIT');
    assert.equal(sixth.body.details.limit, 5);
    assert.equal(sixth.body.details.requested, 6);
    assert.equal(await ApiKeyModel.countDocuments({ userId: u.id }), 5);

    const revoked = await call(server.url, 'DELETE', `/api/api-keys/${ids[0]}`, { token: u.token });
    assert.equal(revoked.status, 200);
    assert.equal((await create(u.token, 'key 7')).status, 201, 'a revoked key no longer counts');
    assert.equal((await create(u.token, 'key 8')).status, 403);
  });

  test('simultaneous creates cannot overshoot the limit: exactly 5 survive', async () => {
    const u = await makePro();
    const results = await Promise.all(Array.from({ length: 9 }, (_, i) => create(u.token, `parallel ${i}`)));
    assert.equal(results.filter((r) => r.status === 201).length, 5, results.map((r) => r.status).join(','));
    assert.equal(results.filter((r) => r.status === 403 && r.body.code === 'PLAN_LIMIT').length, 4);
    assert.equal(await ApiKeyModel.countDocuments({ userId: u.id, revokedAt: { $exists: false } }), 5);
    assert.equal((await list(u.token)).body.data.length, 5);
  });

  test('revoking: the key leaves the list, a second revoke is 404, other accounts cannot revoke it', async () => {
    const owner = await makePro();
    const other = await makePro();
    const { id } = (await create(owner.token)).body.data;

    const stranger = await call(server.url, 'DELETE', `/api/api-keys/${id}`, { token: other.token });
    assert.equal(stranger.status, 404);
    assert.equal((await list(owner.token)).body.data.length, 1, "someone else's revoke changed nothing");

    const revoked = await call(server.url, 'DELETE', `/api/api-keys/${id}`, { token: owner.token });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.id, id);
    assert.ok(Date.parse(revoked.body.data.revokedAt));
    assert.deepEqual((await list(owner.token)).body.data, []);
    assert.ok((await ApiKeyModel.findById(id))?.revokedAt, 'the row is kept, marked revoked');

    assert.equal((await call(server.url, 'DELETE', `/api/api-keys/${id}`, { token: owner.token })).status, 404);
    assert.equal((await call(server.url, 'DELETE', `/api/api-keys/${'f'.repeat(24)}`, { token: owner.token })).status, 404);
    assert.equal((await call(server.url, 'DELETE', '/api/api-keys/not-an-id', { token: owner.token })).status, 400);
  });

  test('a lapsed Pro period: keys stay listed and can be revoked, but no new key can be made', async () => {
    const u = await makeUser({
      plan: 'pro',
      planSource: 'trial',
      trialStartedAt: new Date(Date.now() - 20 * DAY),
      trialEndsAt: new Date(Date.now() - 6 * DAY),
    });
    // Keys made while the plan was active.
    const a = generateApiKey();
    const b = generateApiKey();
    const [docA] = await ApiKeyModel.create([
      { userId: u.id, name: 'from the trial', prefix: a.prefix, keyHash: a.keyHash },
      { userId: u.id, name: 'also from the trial', prefix: b.prefix, keyHash: b.keyHash },
    ]);

    const listed = await list(u.token);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 2, 'keys stay listed');

    const created = await create(u.token);
    assert.equal(created.status, 403);
    assert.equal(created.body.code, 'PLAN_REQUIRED');

    const revoked = await call(server.url, 'DELETE', `/api/api-keys/${docA?._id}`, { token: u.token });
    assert.equal(revoked.status, 200, 'a lapsed account can still revoke');
    assert.equal((await list(u.token)).body.data.length, 1);
  });

  test('a key needs a name of 1 to 60 characters', async () => {
    const u = await makePro();
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(61) }, { name: 5 }]) {
      const res = await call(server.url, 'POST', '/api/api-keys', { token: u.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal((await create(u.token, 'x'.repeat(60))).status, 201);
    assert.equal(await ApiKeyModel.countDocuments({ userId: u.id }), 1);
  });

  test('another account sees none of my keys', async () => {
    const a = await makePro();
    const b = await makePro();
    await create(a.token);
    assert.deepEqual((await list(b.token)).body.data, []);
  });

  test('deleting the account deletes its keys, and only its keys', async () => {
    const { deleteAccount } = await import('../modules/account/account.service');
    const gone = await makePro();
    const stays = await makePro();
    await create(gone.token, 'one');
    await create(gone.token, 'two');
    const revoked = (await create(gone.token, 'three')).body.data.id;
    await call(server.url, 'DELETE', `/api/api-keys/${revoked}`, { token: gone.token });
    await create(stays.token, 'untouched');

    await deleteAccount(gone.id, gone.email);

    assert.equal(await ApiKeyModel.countDocuments({ userId: gone.id }), 0, 'active and revoked keys are gone');
    assert.equal(await ApiKeyModel.countDocuments({ userId: stays.id }), 1);
    assert.equal(await UserModel.countDocuments({ _id: gone.id }), 0);
  });
});
