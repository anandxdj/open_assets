import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken, hashToken, isAccessTokenRevoked } from '../common/utils/jwt.utils';
import { accountRouter } from '../modules/account/account.routes';
import { call, cookieValue, startTestServer } from './http-test-utils';
import type { TestServer } from './http-test-utils';

// Instant revocation: "sign out everywhere" and password changes kill access
// tokens issued before them (user.tokensValidAfter), without killing the
// caller's own fresh session. The first block needs no database.

/* ------------------------------------------------------------------ *
 * Pure
 * ------------------------------------------------------------------ */

test('access tokens carry their issue time in milliseconds', () => {
  const at = new Date('2026-05-01T10:00:00.123Z');
  const decoded = jwt.decode(generateAccessToken({ id: 'u' }, at)) as { iatMs: number; iat: number; id: string };
  assert.equal(decoded.iatMs, at.getTime());
  assert.equal(decoded.id, 'u');
  const now = jwt.decode(generateAccessToken({ id: 'u' })) as { iatMs: number };
  assert.ok(Math.abs(now.iatMs - Date.now()) < 2000);
});

test('isAccessTokenRevoked: no cut-off means nothing is revoked', () => {
  assert.equal(isAccessTokenRevoked({ iatMs: 1 }, undefined), false);
  assert.equal(isAccessTokenRevoked({ iatMs: 1 }, null), false);
});

test('isAccessTokenRevoked compares to the millisecond, so the same second is not ambiguous', () => {
  const cutoff = new Date('2026-05-01T10:00:00.500Z');
  assert.equal(isAccessTokenRevoked({ iatMs: cutoff.getTime() - 1 }, cutoff), true, 'issued 1 ms before: dead');
  assert.equal(isAccessTokenRevoked({ iatMs: cutoff.getTime() }, cutoff), false, 'issued at the cut-off: the caller\'s fresh token');
  assert.equal(isAccessTokenRevoked({ iatMs: cutoff.getTime() + 1 }, cutoff), false);
  assert.equal(isAccessTokenRevoked({ iatMs: cutoff.getTime() - 86_400_000 }, cutoff), true);
});

test('isAccessTokenRevoked: a token from before iatMs existed falls back to iat, rounding down', () => {
  const cutoff = new Date('2026-05-01T10:00:00.500Z');
  const second = Math.floor(cutoff.getTime() / 1000);
  assert.equal(isAccessTokenRevoked({ iat: second }, cutoff), true, 'same second, earlier half: treated as revoked');
  assert.equal(isAccessTokenRevoked({ iat: second + 1 }, cutoff), false);
  assert.equal(isAccessTokenRevoked({}, cutoff), true, 'no timestamp at all: not trusted once a cut-off exists');
});

/* ------------------------------------------------------------------ *
 * With MongoDB: the real authenticate() middleware
 * ------------------------------------------------------------------ */

const needsMongo = !process.env.MONGO_URI && 'requires MONGO_URI';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('token revocation (MongoDB)', { skip: needsMongo }, () => {
  let mongoose: typeof import('mongoose').default;
  let UserModel: typeof import('../modules/auth/auth.model').UserModel;
  let AuthService: typeof import('../modules/auth/auth.service').AuthService;
  let ExtensionSessionModel: typeof import('../modules/auth/extensionSession.model').ExtensionSessionModel;
  let server: TestServer;
  const userIds: string[] = [];

  before(async () => {
    mongoose = (await import('mongoose')).default;
    ({ UserModel } = await import('../modules/auth/auth.model'));
    ({ AuthService } = await import('../modules/auth/auth.service'));
    ({ ExtensionSessionModel } = await import('../modules/auth/extensionSession.model'));
    await mongoose.connect(process.env.MONGO_URI as string, {
      dbName: `${process.env.MONGO_DB_NAME ?? 'open_assets'}_test`,
    });
    server = await startTestServer((app) => app.use('/api/account', accountRouter));
  });

  after(async () => {
    await server?.close();
    await ExtensionSessionModel.deleteMany({ user: { $in: userIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
  });

  async function makeUser(extra: Record<string, unknown> = {}) {
    const email = `revoke-${randomUUID()}@test.local`;
    const user = await UserModel.create({ email, name: 'Revoke Tester', isVerified: true, password: 'Original1', ...extra });
    const id = String(user._id);
    userIds.push(id);
    const refresh = generateRefreshToken({ id, jti: randomUUID() });
    await UserModel.updateOne({ _id: id }, { $set: { refreshToken: hashToken(refresh) } });
    return {
      id,
      email,
      refresh,
      mint: () => generateAccessToken({ id: user._id, email, name: user.name, role: 'user' }),
    };
  }
  const whoami = (token: string) => call(server.url, 'GET', '/api/account', { token });

  test('a user who never signed out everywhere is unaffected', async () => {
    const u = await makeUser();
    assert.equal((await whoami(u.mint())).status, 200);
  });

  test('sign out everywhere: tokens issued before it stop working at once, with no waiting for expiry', async () => {
    const u = await makeUser();
    const bystander = await makeUser();
    const phone = u.mint();
    const laptop = u.mint();
    const other = bystander.mint();
    assert.equal((await whoami(phone)).status, 200);
    await sleep(5);

    const out = await call(server.url, 'POST', '/api/account/logout-all', { token: laptop });
    assert.equal(out.status, 200);

    for (const token of [phone, laptop]) {
      const res = await whoami(token);
      assert.equal(res.status, 401, 'an unexpired access token is dead right away');
      assert.equal(res.body.success, false);
    }
    assert.equal((await whoami(other)).status, 200, 'other accounts are untouched');

    assert.ok((await UserModel.findById(u.id))?.tokensValidAfter instanceof Date);
    await assert.rejects(AuthService.refresh(u.refresh), 'the refresh token is gone too, so no new access token can be minted');

    // Signing in again works: a token minted after the cut-off is accepted.
    await sleep(5);
    assert.equal((await whoami(u.mint())).status, 200);
  });

  test('password change: other sessions die at once, the caller keeps working on the fresh token', async () => {
    const u = await makeUser();
    const phone = u.mint();
    const laptop = u.mint();
    assert.equal((await whoami(phone)).status, 200);
    await sleep(5);

    const res = await call(server.url, 'PUT', '/api/account/password', {
      token: laptop,
      body: { currentPassword: 'Original1', newPassword: 'Brand-new-pass9' },
    });
    assert.equal(res.status, 200);
    const fresh: string = res.body.data.accessToken;

    assert.equal((await whoami(phone)).status, 401, 'the other device is out immediately');
    assert.equal((await whoami(laptop)).status, 401, 'so is the token the caller changed the password with');
    assert.equal((await whoami(fresh)).status, 200, 'the access token the response carries is valid on the very next request');

    // The rotated refresh cookie mints tokens that are valid too.
    const newRefresh = cookieValue(res.setCookies, 'refreshToken');
    assert.ok(newRefresh);
    await sleep(5);
    const refreshed = (await AuthService.refresh(newRefresh)).accessToken;
    assert.equal((await whoami(refreshed)).status, 200);
    await assert.rejects(AuthService.refresh(u.refresh), 'the old refresh token no longer works');
  });

  test('two password changes in a row: each one retires the previous fresh token', async () => {
    const u = await makeUser();
    const first = await call(server.url, 'PUT', '/api/account/password', {
      token: u.mint(),
      body: { currentPassword: 'Original1', newPassword: 'Second-pass2' },
    });
    const firstToken: string = first.body.data.accessToken;
    assert.equal((await whoami(firstToken)).status, 200);

    const second = await call(server.url, 'PUT', '/api/account/password', {
      token: firstToken,
      body: { currentPassword: 'Second-pass2', newPassword: 'Third-pass3' },
    });
    assert.equal(second.status, 200);
    assert.equal((await whoami(firstToken)).status, 401);
    assert.equal((await whoami(second.body.data.accessToken)).status, 200);
  });

  test('a failed password change revokes nothing', async () => {
    const u = await makeUser();
    const token = u.mint();
    const res = await call(server.url, 'PUT', '/api/account/password', {
      token,
      body: { currentPassword: 'Wrong-password1', newPassword: 'Newpass123' },
    });
    assert.equal(res.status, 403);
    assert.equal((await whoami(token)).status, 200);
    assert.equal((await UserModel.findById(u.id))?.tokensValidAfter, undefined);
  });

  test('a token minted before iatMs existed is revoked too', async () => {
    const u = await makeUser();
    const secret = process.env['JWT_ACCESS_SECRET'] || process.env['JWT_SECRET'] || 'access-secret';
    const legacy = jwt.sign({ id: u.id, email: u.email, role: 'user' }, secret, { expiresIn: '15m' });
    assert.equal((await whoami(legacy)).status, 200, 'accepted until a cut-off exists');
    await sleep(1100); // iat has whole-second precision
    await call(server.url, 'POST', '/api/account/logout-all', { token: u.mint() });
    assert.equal((await whoami(legacy)).status, 401);
  });

  test('resetting a forgotten password also signs everything out', async () => {
    const raw = randomUUID();
    const u = await makeUser({ resetPasswordToken: hashToken(raw), resetPasswordExpires: new Date(Date.now() + 60_000) });
    const old = u.mint();
    const ext = await ExtensionSessionModel.create({
      user: u.id,
      tokenHash: hashToken(randomUUID()),
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    assert.equal((await whoami(old)).status, 200);
    await sleep(5);

    await AuthService.resetPassword(raw, 'Reset-pass9');

    assert.equal((await whoami(old)).status, 401);
    await assert.rejects(AuthService.refresh(u.refresh), 'the refresh token is gone');
    assert.ok((await ExtensionSessionModel.findById(ext._id))?.revokedAt, 'the extension is signed out');
    const login = await AuthService.login({ email: u.email, password: 'Reset-pass9' });
    await sleep(5);
    assert.equal((await whoami(login.accessToken)).status, 200, 'signing in with the new password works');
  });
});
