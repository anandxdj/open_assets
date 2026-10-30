import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { ApiError } from '../common/utils/ApiError';
import { validate } from '../common/middlewares/validate.middleware';
import { generateAccessToken, generateRefreshToken, hashToken } from '../common/utils/jwt.utils';
import {
  changePasswordSchema,
  deleteAccountSchema,
  objectIdSchema,
  updateProfileSchema,
} from '../modules/account/dto/account.schema';
import { accountRouter } from '../modules/account/account.routes';
import { usageRouter } from '../modules/usage/usage.routes';
import { call, cookieValue, startTestServer } from './http-test-utils';
import type { TestServer } from './http-test-utils';

// The first half needs no database: schemas, the validate middleware and the
// "no valid token" paths (authenticate() rejects before it ever reads a user).
// The second half drives the real routers over HTTP and additionally runs when
// MONGO_URI is set, like the credits race test in usage.test.ts.

/* ------------------------------------------------------------------ *
 * Pure: schemas
 * ------------------------------------------------------------------ */

test('updateProfileSchema trims the name and enforces 2..50 characters', () => {
  assert.equal(updateProfileSchema.parse({ name: '  Ada Lovelace  ' }).name, 'Ada Lovelace');
  assert.throws(() => updateProfileSchema.parse({ name: 'A' }));
  assert.throws(() => updateProfileSchema.parse({ name: '   ' }));
  assert.throws(() => updateProfileSchema.parse({ name: 'x'.repeat(51) }));
  assert.throws(() => updateProfileSchema.parse({}));
});

test('updateProfileSchema strips fields a client must not set', () => {
  const parsed = updateProfileSchema.parse({
    name: 'Ada',
    role: 'admin',
    email: 'evil@example.com',
    plan: 'pro',
    credits: 99999,
    isVerified: true,
  }) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ['name']);
});

test('changePasswordSchema applies the same password rule as registration', () => {
  assert.doesNotThrow(() => changePasswordSchema.parse({ currentPassword: 'x', newPassword: 'Password1' }));
  assert.throws(() => changePasswordSchema.parse({ currentPassword: 'x', newPassword: 'short1A' }), /at least 8/);
  assert.throws(() => changePasswordSchema.parse({ currentPassword: 'x', newPassword: 'alllowercase1' }), /uppercase/);
  assert.throws(() => changePasswordSchema.parse({ currentPassword: 'x', newPassword: 'NoDigitsHere' }), /digit/);
  assert.throws(() => changePasswordSchema.parse({ currentPassword: 'x', newPassword: `A1${'a'.repeat(127)}` }), /at most 128/);
  assert.throws(() => changePasswordSchema.parse({ currentPassword: 'x' }));
});

test('changePasswordSchema allows omitting currentPassword (Google-only accounts) but not blanking it', () => {
  assert.doesNotThrow(() => changePasswordSchema.parse({ newPassword: 'Password1' }));
  assert.throws(() => changePasswordSchema.parse({ currentPassword: '', newPassword: 'Password1' }));
});

test('deleteAccountSchema requires a non-blank confirmation', () => {
  assert.equal(deleteAccountSchema.parse({ confirmation: '  me@example.com ' }).confirmation, 'me@example.com');
  assert.throws(() => deleteAccountSchema.parse({ confirmation: '   ' }));
  assert.throws(() => deleteAccountSchema.parse({}));
});

test('objectIdSchema only accepts 24-hex ids', () => {
  assert.doesNotThrow(() => objectIdSchema.parse('a'.repeat(24)));
  assert.throws(() => objectIdSchema.parse('current'));
  assert.throws(() => objectIdSchema.parse('a'.repeat(23)));
  assert.throws(() => objectIdSchema.parse({ $ne: null }));
});

test('validate() turns a failing account body into a 400 ApiError', () => {
  let received: unknown;
  const req = { body: { currentPassword: 'x', newPassword: 'weak' } } as unknown as Request;
  validate(changePasswordSchema)(req, {} as Response, (err?: unknown) => {
    received = err;
  });
  assert.ok(received instanceof ApiError);
  assert.equal(received.statusCode, 400);
  assert.match(received.message, /newPassword/);
});

/* ------------------------------------------------------------------ *
 * Pure: authentication failures (no database touched)
 * ------------------------------------------------------------------ */

describe('account routes reject unauthenticated callers', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer((app) => {
      app.use('/api/account', accountRouter);
      app.use('/api', usageRouter);
    });
  });
  after(() => server.close());

  const routes: Array<[string, string, unknown?]> = [
    ['GET', '/api/account'],
    ['PUT', '/api/account/profile', { name: 'Ada' }],
    ['PUT', '/api/account/password', { currentPassword: 'x', newPassword: 'Password1' }],
    ['POST', '/api/account/logout-all'],
    ['GET', '/api/account/extension-sessions'],
    ['DELETE', `/api/account/extension-sessions/${'a'.repeat(24)}`],
    ['DELETE', '/api/account', { confirmation: 'me@example.com' }],
    ['GET', '/api/usage/events'],
  ];

  for (const [method, path, body] of routes) {
    test(`${method} ${path.replace(/[a-f0-9]{24}/, ':id')} without a token → 401`, async () => {
      const res = await call(server.url, method, path, { body });
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });
  }

  test('a malformed bearer token → 401', async () => {
    const res = await call(server.url, 'GET', '/api/account', { token: 'not.a.jwt' });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('a token signed with the wrong secret → 401', async () => {
    const forged = jwt.sign({ id: 'a'.repeat(24) }, 'some-other-secret');
    const res = await call(server.url, 'DELETE', '/api/account', { token: forged, body: { confirmation: 'x@y.z' } });
    assert.equal(res.status, 401);
  });

  test('authentication is checked before the body, so an invalid body cannot probe the route', async () => {
    const res = await call(server.url, 'PUT', '/api/account/password', { body: { newPassword: 'weak' } });
    assert.equal(res.status, 401);
  });
});

/* ------------------------------------------------------------------ *
 * With MongoDB: the real routers, end to end over HTTP
 * ------------------------------------------------------------------ */

const needsMongo = !process.env.MONGO_URI && 'requires MONGO_URI';

describe('account API (MongoDB)', { skip: needsMongo }, () => {
  // Imported lazily so the pure tests above never load mongoose models' connection.
  let mongoose: typeof import('mongoose').default;
  let UserModel: typeof import('../modules/auth/auth.model').UserModel;
  let ExtensionSessionModel: typeof import('../modules/auth/extensionSession.model').ExtensionSessionModel;
  let ExtensionAuthorizationModel: typeof import('../modules/auth/extensionAuthorization.model').ExtensionAuthorizationModel;
  let CollectionModel: typeof import('../modules/collections/collection.model').CollectionModel;
  let FolderModel: typeof import('../modules/collections/folder.model').FolderModel;
  let ImageModel: typeof import('../modules/collections/image.model').ImageModel;
  let CollectionLikeModel: typeof import('../modules/collections/collectionLike.model').CollectionLikeModel;
  let UsageEventModel: typeof import('../modules/usage/usage.model').UsageEventModel;
  let AuthService: typeof import('../modules/auth/auth.service').AuthService;
  let storage: typeof import('../lib/storage').storage;
  let server: TestServer;

  const createdUserIds: string[] = [];
  const createdCollectionIds: unknown[] = [];

  before(async () => {
    mongoose = (await import('mongoose')).default;
    ({ UserModel } = await import('../modules/auth/auth.model'));
    ({ ExtensionSessionModel } = await import('../modules/auth/extensionSession.model'));
    ({ ExtensionAuthorizationModel } = await import('../modules/auth/extensionAuthorization.model'));
    ({ CollectionModel } = await import('../modules/collections/collection.model'));
    ({ FolderModel } = await import('../modules/collections/folder.model'));
    ({ ImageModel } = await import('../modules/collections/image.model'));
    ({ CollectionLikeModel } = await import('../modules/collections/collectionLike.model'));
    ({ UsageEventModel } = await import('../modules/usage/usage.model'));
    ({ AuthService } = await import('../modules/auth/auth.service'));
    ({ storage } = await import('../lib/storage'));

    await mongoose.connect(process.env.MONGO_URI as string, process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {});
    server = await startTestServer((app) => {
      app.use('/api/account', accountRouter);
      app.use('/api', usageRouter);
    });
  });

  after(async () => {
    await server?.close();
    // Safety net: remove anything a failed assertion left behind.
    await ExtensionSessionModel.deleteMany({ user: { $in: createdUserIds } });
    await UsageEventModel.deleteMany({ user: { $in: createdUserIds } });
    await CollectionLikeModel.deleteMany({ user: { $in: createdUserIds } });
    await ImageModel.deleteMany({ collectionId: { $in: createdCollectionIds } });
    await FolderModel.deleteMany({ collectionId: { $in: createdCollectionIds } });
    await CollectionModel.deleteMany({ _id: { $in: createdCollectionIds } });
    await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    await mongoose.disconnect();
  });

  async function makeUser(opts: { password?: string | null; name?: string } = {}) {
    const email = `acct-${randomUUID()}@test.local`;
    const password = opts.password === undefined ? 'Original1' : opts.password;
    const user = await UserModel.create({
      email,
      name: opts.name ?? 'Test User',
      isVerified: true,
      ...(password ? { password } : { sub: randomUUID() }), // no password = Google-only
    });
    const id = String(user._id);
    createdUserIds.push(id);
    const token = generateAccessToken({ id: user._id, email, name: user.name, role: 'user' });
    return { id, email, token };
  }

  function addExtensionSession(userId: string, overrides: Record<string, unknown> = {}) {
    return ExtensionSessionModel.create({
      user: userId,
      tokenHash: hashToken(randomUUID()),
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    });
  }

  /* ----------------------------- GET /account ---------------------------- */

  test('GET /api/account returns the profile and never the hash', async () => {
    const u = await makeUser();
    const res = await call(server.url, 'GET', '/api/account', { token: u.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.email, u.email);
    assert.equal(res.body.data.isVerified, true);
    assert.equal(res.body.data.hasPassword, true);
    assert.equal(res.body.data.hasGoogle, false);
    assert.equal('password' in res.body.data, false);
    assert.equal(JSON.stringify(res.body).includes('$2'), false, 'no bcrypt hash anywhere in the response');
  });

  test('GET /api/account reports hasPassword=false for a Google-only account', async () => {
    const u = await makeUser({ password: null });
    const res = await call(server.url, 'GET', '/api/account', { token: u.token });
    assert.equal(res.body.data.hasPassword, false);
    assert.equal(res.body.data.hasGoogle, true);
  });

  /* ---------------------------- PUT /account/profile --------------------- */

  test('PUT /api/account/profile updates only the name', async () => {
    const u = await makeUser();
    const res = await call(server.url, 'PUT', '/api/account/profile', {
      token: u.token,
      body: { name: '  Grace Hopper ', email: 'evil@example.com', role: 'admin' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, 'Grace Hopper');
    const fresh = await UserModel.findById(u.id);
    assert.equal(fresh?.name, 'Grace Hopper');
    assert.equal(fresh?.email, u.email, 'email is read-only');
    assert.equal(fresh?.role, 'user', 'role cannot be set from the body');
  });

  test('PUT /api/account/profile rejects an invalid name with 400', async () => {
    const u = await makeUser();
    for (const body of [{ name: 'A' }, { name: '   ' }, { name: 'x'.repeat(51) }, {}]) {
      const res = await call(server.url, 'PUT', '/api/account/profile', { token: u.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.success, false);
    }
    assert.equal((await UserModel.findById(u.id))?.name, 'Test User');
  });

  /* --------------------------- PUT /account/password --------------------- */

  test('PUT /api/account/password: current password is required when one is set', async () => {
    const u = await makeUser();
    const res = await call(server.url, 'PUT', '/api/account/password', { token: u.token, body: { newPassword: 'Newpass123' } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /current password/i);
  });

  test('PUT /api/account/password: wrong current password → 403 and nothing changes', async () => {
    const u = await makeUser();
    const res = await call(server.url, 'PUT', '/api/account/password', {
      token: u.token,
      body: { currentPassword: 'Wrong-password1', newPassword: 'Newpass123' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.message, 'Current password is incorrect');
    const fresh = await UserModel.findById(u.id).select('+password');
    assert.equal(await fresh?.comparePassword('Original1'), true);
  });

  test('PUT /api/account/password: weak or unchanged new password → 400', async () => {
    const u = await makeUser();
    const weak = await call(server.url, 'PUT', '/api/account/password', {
      token: u.token,
      body: { currentPassword: 'Original1', newPassword: 'weak' },
    });
    assert.equal(weak.status, 400);
    const same = await call(server.url, 'PUT', '/api/account/password', {
      token: u.token,
      body: { currentPassword: 'Original1', newPassword: 'Original1' },
    });
    assert.equal(same.status, 400);
    assert.match(same.body.message, /different/i);
  });

  test('PUT /api/account/password: success hashes the new password, rotates the session and revokes extensions', async () => {
    const u = await makeUser();
    const realOld = generateRefreshToken({ id: u.id, jti: randomUUID() });
    await UserModel.updateOne({ _id: u.id }, { $set: { refreshToken: hashToken(realOld) } });
    const ext = await addExtensionSession(u.id);
    assert.ok((await AuthService.refresh(realOld)).accessToken, 'precondition: old refresh token works');

    const res = await call(server.url, 'PUT', '/api/account/password', {
      token: u.token,
      body: { currentPassword: 'Original1', newPassword: 'Brand-new-pass9' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Password changed');
    assert.equal(typeof res.body.data.accessToken, 'string');
    assert.equal(res.body.data.extensionSessionsRevoked, 1);

    const fresh = await UserModel.findById(u.id).select('+password');
    assert.equal(await fresh?.comparePassword('Brand-new-pass9'), true);
    assert.equal(await fresh?.comparePassword('Original1'), false);
    assert.notEqual(fresh?.password, 'Brand-new-pass9', 'stored hashed');

    // The caller gets a new refresh cookie; every other refresh token is dead.
    const newRefresh = cookieValue(res.setCookies, 'refreshToken');
    assert.ok(newRefresh, 'refresh cookie re-issued');
    assert.ok(res.setCookies.find((c) => c.startsWith('refreshToken='))?.toLowerCase().includes('httponly'));
    await assert.rejects(AuthService.refresh(realOld), (e: unknown) => e instanceof ApiError && e.statusCode === 401);
    assert.ok((await AuthService.refresh(newRefresh)).accessToken);

    const extAfter = await ExtensionSessionModel.findById(ext._id);
    assert.ok(extAfter?.revokedAt, 'extension session revoked');
  });

  test('PUT /api/account/password: a Google-only account can set a first password without one', async () => {
    const u = await makeUser({ password: null });
    const res = await call(server.url, 'PUT', '/api/account/password', { token: u.token, body: { newPassword: 'First-password1' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Password set');
    const fresh = await UserModel.findById(u.id).select('+password');
    assert.equal(await fresh?.comparePassword('First-password1'), true);
    // Setting a password revokes every earlier access token at once (the old `u.token` is dead);
    // the caller carries on with the fresh one from the response.
    assert.equal((await call(server.url, 'GET', '/api/account', { token: u.token })).status, 401);
    const token: string = res.body.data.accessToken;
    // Once set, the account behaves like any other: the current password is now required.
    const again = await call(server.url, 'PUT', '/api/account/password', { token, body: { newPassword: 'Another-pass2' } });
    assert.equal(again.status, 400);
    assert.equal((await call(server.url, 'GET', '/api/account', { token })).body.data.hasPassword, true);
  });

  test('PUT /api/account/password is rate limited per user after 10 failed attempts', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const attempt = () =>
      call(server.url, 'PUT', '/api/account/password', {
        token: u.token,
        body: { currentPassword: 'Guess-guess1', newPassword: 'Newpass123' },
      });
    for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 403, `attempt ${i + 1}`);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.success, false);

    // The correct password is also refused while blocked, and another user is unaffected.
    const correct = await call(server.url, 'PUT', '/api/account/password', {
      token: u.token,
      body: { currentPassword: 'Original1', newPassword: 'Newpass123' },
    });
    assert.equal(correct.status, 429);
    const unaffected = await call(server.url, 'PUT', '/api/account/password', {
      token: other.token,
      body: { currentPassword: 'Original1', newPassword: 'Newpass123' },
    });
    assert.equal(unaffected.status, 200);
  });

  /* ----------------------------- POST /logout-all ------------------------ */

  test('POST /api/account/logout-all invalidates the refresh token and every extension session', async () => {
    const u = await makeUser();
    const refresh = generateRefreshToken({ id: u.id, jti: randomUUID() });
    await UserModel.updateOne({ _id: u.id }, { $set: { refreshToken: hashToken(refresh) } });
    const a = await addExtensionSession(u.id);
    const b = await addExtensionSession(u.id);
    const alreadyRevoked = await addExtensionSession(u.id, { revokedAt: new Date(Date.now() - 1000) });
    const bystander = await makeUser();
    const bystanderExt = await addExtensionSession(bystander.id);

    const res = await call(server.url, 'POST', '/api/account/logout-all', { token: u.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.extensionSessionsRevoked, 2, 'only live sessions are counted');
    assert.ok(res.setCookies.some((c) => c.startsWith('refreshToken=;')), 'refresh cookie cleared');

    await assert.rejects(AuthService.refresh(refresh), (e: unknown) => e instanceof ApiError && e.statusCode === 401);
    assert.ok((await ExtensionSessionModel.findById(a._id))?.revokedAt);
    assert.ok((await ExtensionSessionModel.findById(b._id))?.revokedAt);
    assert.ok((await ExtensionSessionModel.findById(alreadyRevoked._id))?.revokedAt);
    assert.equal((await ExtensionSessionModel.findById(bystanderExt._id))?.revokedAt, undefined, "another user's session is untouched");
  });

  /* ------------------------- extension sessions list/revoke -------------- */

  test('GET /api/account/extension-sessions lists only this user’s live sessions, newest use first', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const older = await addExtensionSession(u.id, { lastUsedAt: new Date('2026-01-01') });
    const newer = await addExtensionSession(u.id, { lastUsedAt: new Date('2026-02-01') });
    await addExtensionSession(u.id, { revokedAt: new Date() });
    await addExtensionSession(u.id, { expiresAt: new Date(Date.now() - 1000) });
    await addExtensionSession(other.id);

    const res = await call(server.url, 'GET', '/api/account/extension-sessions', { token: u.token });
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((s: { id: string }) => s.id),
      [String(newer._id), String(older._id)],
    );
    const first = res.body.data[0];
    assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'expiresAt', 'extensionId', 'id', 'lastUsedAt']);
    assert.equal(JSON.stringify(res.body).includes('tokenHash'), false);
  });

  test('DELETE /api/account/extension-sessions/:id revokes one session', async () => {
    const u = await makeUser();
    const keep = await addExtensionSession(u.id);
    const drop = await addExtensionSession(u.id);

    const res = await call(server.url, 'DELETE', `/api/account/extension-sessions/${drop._id}`, { token: u.token });
    assert.equal(res.status, 200);
    assert.ok((await ExtensionSessionModel.findById(drop._id))?.revokedAt);
    assert.equal((await ExtensionSessionModel.findById(keep._id))?.revokedAt, undefined);

    const list = await call(server.url, 'GET', '/api/account/extension-sessions', { token: u.token });
    assert.deepEqual(list.body.data.map((s: { id: string }) => s.id), [String(keep._id)]);

    const again = await call(server.url, 'DELETE', `/api/account/extension-sessions/${drop._id}`, { token: u.token });
    assert.equal(again.status, 404, 'already revoked');
  });

  test('DELETE /api/account/extension-sessions/:id cannot touch another user’s session (404, still active)', async () => {
    const u = await makeUser();
    const victim = await makeUser();
    const theirs = await addExtensionSession(victim.id);
    const res = await call(server.url, 'DELETE', `/api/account/extension-sessions/${theirs._id}`, { token: u.token });
    assert.equal(res.status, 404);
    assert.equal((await ExtensionSessionModel.findById(theirs._id))?.revokedAt, undefined);
  });

  test('DELETE /api/account/extension-sessions/:id rejects a malformed id with 400', async () => {
    const u = await makeUser();
    for (const id of ['current', '123', encodeURIComponent('{"$ne":null}')]) {
      const res = await call(server.url, 'DELETE', `/api/account/extension-sessions/${id}`, { token: u.token });
      assert.equal(res.status, 400, id);
    }
    assert.equal((await call(server.url, 'DELETE', `/api/account/extension-sessions/${'f'.repeat(24)}`, { token: u.token })).status, 404);
  });

  /* ------------------------------ usage events --------------------------- */

  test('GET /api/usage/events paginates newest first and only returns the caller’s events', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const base = Date.parse('2026-03-01T00:00:00Z');
    for (let i = 0; i < 5; i++) {
      await UsageEventModel.create({
        user: u.id,
        op: 'extend',
        modelId: `model-${i}`,
        units: 1,
        cost: i + 1,
        createdAt: new Date(base + i * 60_000),
      });
    }
    await UsageEventModel.create({ user: other.id, op: 'generate', modelId: 'not-mine', units: 1, cost: 1 });

    const page1 = await call(server.url, 'GET', '/api/usage/events?limit=2', { token: u.token });
    assert.equal(page1.status, 200);
    assert.equal(page1.body.success, true);
    assert.deepEqual(page1.body.data.items.map((e: { modelId: string }) => e.modelId), ['model-4', 'model-3']);
    assert.equal(page1.body.data.total, 5);
    assert.equal(page1.body.data.page, 1);
    assert.equal(page1.body.data.limit, 2);
    assert.equal(page1.body.data.hasMore, true);
    assert.deepEqual(Object.keys(page1.body.data.items[0]).sort(), ['cost', 'createdAt', 'id', 'modelId', 'op', 'status', 'units']);

    const page3 = await call(server.url, 'GET', '/api/usage/events?limit=2&page=3', { token: u.token });
    assert.deepEqual(page3.body.data.items.map((e: { modelId: string }) => e.modelId), ['model-0']);
    assert.equal(page3.body.data.hasMore, false);

    const beyond = await call(server.url, 'GET', '/api/usage/events?limit=2&page=9', { token: u.token });
    assert.deepEqual(beyond.body.data.items, []);

    const defaults = await call(server.url, 'GET', '/api/usage/events', { token: u.token });
    assert.equal(defaults.body.data.limit, 20);
    assert.equal(defaults.body.data.items.length, 5);
    assert.equal(defaults.body.data.items.some((e: { modelId: string }) => e.modelId === 'not-mine'), false);
  });

  test('GET /api/usage/events rejects bad pagination with 400', async () => {
    const u = await makeUser();
    for (const qs of ['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=51', 'limit=1.5', 'page=1&page=2']) {
      const res = await call(server.url, 'GET', `/api/usage/events?${qs}`, { token: u.token });
      assert.equal(res.status, 400, qs);
    }
  });

  /* ----------------------------- DELETE /account ------------------------- */

  test('DELETE /api/account with the wrong confirmation → 400 and nothing is deleted', async () => {
    const u = await makeUser();
    await UsageEventModel.create({ user: u.id, op: 'extend', modelId: 'm', units: 1, cost: 1 });

    for (const confirmation of ['DELETE', 'someone-else@test.local', '']) {
      const res = await call(server.url, 'DELETE', '/api/account', { token: u.token, body: { confirmation } });
      assert.equal(res.status, 400, confirmation);
    }
    const noBody = await call(server.url, 'DELETE', '/api/account', { token: u.token });
    assert.equal(noBody.status, 400);

    assert.ok(await UserModel.exists({ _id: u.id }));
    assert.equal(await UsageEventModel.countDocuments({ user: u.id }), 1);
  });

  test('DELETE /api/account removes the user and everything they own, tolerating storage failures', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const refresh = generateRefreshToken({ id: u.id, jti: randomUUID() });
    await UserModel.updateOne({ _id: u.id }, { $set: { refreshToken: hashToken(refresh) } });

    // The user's pack: 2 folders, 3 images (one shared public id), liked by someone else.
    const pack = await CollectionModel.create({ creator: u.id, name: 'My pack', isPublic: true, status: 'published', likesCount: 1 });
    createdCollectionIds.push(pack._id);
    const folderA = await FolderModel.create({ collectionId: pack._id, name: 'A' });
    const folderB = await FolderModel.create({ collectionId: pack._id, name: 'B' });
    const img = (folderId: unknown, publicId: string) => ({
      folderId, collectionId: pack._id, name: publicId, cloudinaryUrl: `https://x/${publicId}`, cloudinaryPublicId: publicId,
    });
    await ImageModel.insertMany([img(folderA._id, 'pid-1'), img(folderA._id, 'pid-2'), img(folderB._id, 'pid-2')]);
    await CollectionLikeModel.create({ user: other.id, collectionId: pack._id });

    // Another user's pack that the deleted user liked: the like must be taken back.
    const theirs = await CollectionModel.create({ creator: other.id, name: 'Their pack', isPublic: true, status: 'published', likesCount: 3 });
    createdCollectionIds.push(theirs._id);
    const theirsFolder = await FolderModel.create({ collectionId: theirs._id, name: 'T' });
    await ImageModel.insertMany([{ ...img(theirsFolder._id, 'theirs-1'), collectionId: theirs._id }]);
    await CollectionLikeModel.create({ user: u.id, collectionId: theirs._id });

    await UsageEventModel.create({ user: u.id, op: 'extend', modelId: 'm', units: 1, cost: 1 });
    await UsageEventModel.create({ user: u.id, op: 'generate', modelId: 'm', units: 1, cost: 4 });
    await UsageEventModel.create({ user: other.id, op: 'extend', modelId: 'm', units: 1, cost: 1 });
    await addExtensionSession(u.id);
    await ExtensionAuthorizationModel.create({
      user: u.id, codeHash: hashToken(randomUUID()), state: 's'.repeat(16), redirectUri: 'https://x.chromiumapp.org/auth',
      codeChallenge: 'c'.repeat(43), expiresAt: new Date(Date.now() + 60_000),
    });

    // Storage adapter: pid-1 is deleted, pid-2 fails. Neither may block the deletion.
    const deleted: Array<[string, string | undefined]> = [];
    const original = storage.delete;
    storage.delete = async (publicId, resourceType) => {
      deleted.push([publicId, resourceType]);
      if (publicId === 'pid-2') throw new Error('provider unavailable');
    };

    const res = await call(server.url, 'DELETE', '/api/account', {
      token: u.token,
      body: { confirmation: `  ${u.email.toUpperCase()} ` },
    }).finally(() => {
      storage.delete = original;
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, { collections: 1, imagesDeleted: 1, imagesFailed: 1 });
    assert.ok(res.setCookies.some((c) => c.startsWith('refreshToken=;')), 'refresh cookie cleared');

    // Each distinct stored file is asked for once, as an image, and only the user's own files.
    assert.deepEqual(deleted.map(([id]) => id).sort(), ['pid-1', 'pid-2']);
    assert.ok(deleted.every(([, type]) => type === 'image'));

    // Everything the user owned is gone.
    assert.equal(await UserModel.exists({ _id: u.id }), null);
    assert.equal(await CollectionModel.exists({ _id: pack._id }), null);
    assert.equal(await FolderModel.countDocuments({ collectionId: pack._id }), 0);
    assert.equal(await ImageModel.countDocuments({ collectionId: pack._id }), 0);
    assert.equal(await CollectionLikeModel.countDocuments({ collectionId: pack._id }), 0);
    assert.equal(await UsageEventModel.countDocuments({ user: u.id }), 0);
    assert.equal(await ExtensionSessionModel.countDocuments({ user: u.id }), 0);
    assert.equal(await ExtensionAuthorizationModel.countDocuments({ user: u.id }), 0);
    assert.equal(await CollectionLikeModel.countDocuments({ user: u.id }), 0);
    await assert.rejects(AuthService.refresh(refresh), (e: unknown) => e instanceof ApiError && e.statusCode === 401);

    // Other users are untouched, and the like the deleted user gave is taken back.
    assert.ok(await UserModel.exists({ _id: other.id }));
    assert.ok(await CollectionModel.exists({ _id: theirs._id }));
    assert.equal(await ImageModel.countDocuments({ collectionId: theirs._id }), 1);
    assert.equal(await UsageEventModel.countDocuments({ user: other.id }), 1);
    assert.equal((await CollectionModel.findById(theirs._id))?.likesCount, 2);

    // The access token dies with the user.
    const after = await call(server.url, 'GET', '/api/account', { token: u.token });
    assert.equal(after.status, 401);
  });

  test('DELETE /api/account never lets a like counter go below zero', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const theirs = await CollectionModel.create({ creator: other.id, name: 'Their pack', likesCount: 0 });
    createdCollectionIds.push(theirs._id);
    await CollectionLikeModel.create({ user: u.id, collectionId: theirs._id });

    const res = await call(server.url, 'DELETE', '/api/account', { token: u.token, body: { confirmation: u.email } });
    assert.equal(res.status, 200);
    assert.equal((await CollectionModel.findById(theirs._id))?.likesCount, 0);
  });

  test('DELETE /api/account works for an account with no data at all', async () => {
    const u = await makeUser({ password: null });
    const res = await call(server.url, 'DELETE', '/api/account', { token: u.token, body: { confirmation: u.email } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { collections: 0, imagesDeleted: 0, imagesFailed: 0 });
    assert.equal(await UserModel.exists({ _id: u.id }), null);
  });
});
