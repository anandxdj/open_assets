import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { generateAccessToken, generateRefreshToken, hashToken } from '../common/utils/jwt.utils';
import { describeUserAgent, MAX_REFRESH_SESSIONS } from '../modules/auth/refreshSessions';
import { accountRouter } from '../modules/account/account.routes';
import { AuthController } from '../modules/auth/auth.controller';
import { call, cookieValue, startTestServer } from './http-test-utils';
import type { TestServer } from './http-test-utils';

// Several browsers signed in at once. Signing in somewhere new used to replace
// the user's single stored refresh token and silently sign every other browser
// out at its next refresh. Each sign-in is now its own session
// (user.refreshSessions), so they come and go independently.

/* ------------------------------------------------------------------ *
 * Pure
 * ------------------------------------------------------------------ */

test('describeUserAgent gives a coarse label and never echoes the raw header', () => {
  assert.equal(
    describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'),
    'Chrome on Linux',
  );
  assert.equal(
    describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'),
    'Safari on iOS',
  );
  assert.equal(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'), 'Firefox on Windows');
  assert.equal(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0'), 'Edge on Windows');
  assert.equal(describeUserAgent('curl/8.5.0'), 'curl');
  assert.equal(describeUserAgent(''), 'Unknown device');
  assert.equal(describeUserAgent(undefined), 'Unknown device');
  assert.equal(describeUserAgent('something-odd/1.0'), 'Unknown device');
});

test('refresh tokens issued in the same second are still distinct', () => {
  const a = generateRefreshToken({ id: 'u1' });
  const b = generateRefreshToken({ id: 'u1' });
  assert.notEqual(a, b);
  assert.notEqual(hashToken(a), hashToken(b));
});

/* ------------------------------------------------------------------ *
 * With MongoDB: the real controllers and services
 * ------------------------------------------------------------------ */

const needsMongo = !process.env.MONGO_URI && 'requires MONGO_URI';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CHROME_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('refresh sessions (MongoDB)', { skip: needsMongo }, () => {
  let mongoose: typeof import('mongoose').default;
  let UserModel: typeof import('../modules/auth/auth.model').UserModel;
  let ExtensionSessionModel: typeof import('../modules/auth/extensionSession.model').ExtensionSessionModel;
  let AuthService: typeof import('../modules/auth/auth.service').AuthService;
  let server: TestServer;
  const userIds: string[] = [];

  before(async () => {
    mongoose = (await import('mongoose')).default;
    ({ UserModel } = await import('../modules/auth/auth.model'));
    ({ ExtensionSessionModel } = await import('../modules/auth/extensionSession.model'));
    ({ AuthService } = await import('../modules/auth/auth.service'));
    await mongoose.connect(process.env.MONGO_URI as string, {
      dbName: `${process.env.MONGO_DB_NAME ?? 'open_assets'}_test`,
    });
    // The auth router minus its rate limiter, so a test can sign in as often as it likes.
    const auth = Router();
    auth.post('/login', AuthController.login as never);
    auth.post('/refresh-token', AuthController.refreshToken as never);
    auth.post('/logout', AuthController.logout as never);
    server = await startTestServer((app) => {
      app.use('/api/auth', auth);
      app.use('/api/account', accountRouter);
    });
  });

  after(async () => {
    await server?.close();
    await ExtensionSessionModel.deleteMany({ user: { $in: userIds } });
    await UserModel.deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
  });

  async function makeUser(password = 'Original1') {
    const email = `sess-${randomUUID()}@test.local`;
    const user = await UserModel.create({ email, name: 'Session Tester', isVerified: true, password });
    userIds.push(String(user._id));
    return { id: String(user._id), email, password };
  }

  /** Signs in over HTTP like a browser: returns its refresh cookie and access token. */
  async function signIn(u: { email: string; password: string }, userAgent = CHROME_LINUX) {
    const res = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    assert.equal(res.status, 200, 'sign-in succeeds');
    const cookie = cookieValue(res.headers.getSetCookie(), 'refreshToken');
    assert.ok(cookie, 'refresh cookie set');
    const body = (await res.json()) as { data: { accessToken: string } };
    return { refresh: cookie as string, access: body.data.accessToken };
  }

  async function refresh(refreshToken: string) {
    const res = await fetch(`${server.url}/api/auth/refresh-token`, {
      method: 'POST',
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
    return { status: res.status, body: (await res.json()) as { data?: { accessToken: string } } };
  }

  async function signOut(refreshToken: string) {
    const res = await fetch(`${server.url}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
    assert.equal(res.status, 200);
  }

  const sessionsOf = async (id: string) => (await UserModel.findById(id).select('+refreshSessions +refreshToken'))!;

  test('two sign-ins both keep refreshing (the reported bug)', async () => {
    const u = await makeUser();
    const first = await signIn(u);
    const second = await signIn(u);
    assert.notEqual(first.refresh, second.refresh);

    assert.equal((await refresh(first.refresh)).status, 200, 'the first browser is not signed out by the second sign-in');
    assert.equal((await refresh(second.refresh)).status, 200);
    assert.equal((await refresh(first.refresh)).status, 200, 'and again, after the second one refreshed');
    assert.equal((await sessionsOf(u.id)).refreshSessions?.length, 2);
  });

  test('sessions store only hashes, a coarse label and timestamps', async () => {
    const u = await makeUser();
    const { refresh: token } = await signIn(u);
    const user = await sessionsOf(u.id);
    const [session] = user.refreshSessions ?? [];
    assert.equal(user.refreshSessions?.length, 1);
    assert.equal(session?.tokenHash, hashToken(token));
    assert.equal(session?.userAgent, 'Chrome on Linux');
    assert.ok(session?.createdAt instanceof Date && session?.lastUsedAt instanceof Date);
    assert.equal(JSON.stringify(user.toObject()).includes(token), false, 'the raw token is nowhere in the document');
    assert.equal(user.refreshToken, undefined, 'the legacy field is not written any more');
  });

  test('a refresh stamps only its own session and does not rotate or touch the others', async () => {
    const u = await makeUser();
    const a = await signIn(u);
    const b = await signIn(u);
    const before = await sessionsOf(u.id);
    const aBefore = before.refreshSessions!.find((s) => s.tokenHash === hashToken(a.refresh))!;
    const bBefore = before.refreshSessions!.find((s) => s.tokenHash === hashToken(b.refresh))!;
    await sleep(15);

    assert.equal((await refresh(a.refresh)).status, 200);

    const after = await sessionsOf(u.id);
    const aAfter = after.refreshSessions!.find((s) => s.tokenHash === hashToken(a.refresh))!;
    const bAfter = after.refreshSessions!.find((s) => s.tokenHash === hashToken(b.refresh))!;
    assert.ok(aAfter.lastUsedAt.getTime() > aBefore.lastUsedAt.getTime(), 'its own lastUsedAt moved');
    assert.equal(aAfter.createdAt.getTime(), aBefore.createdAt.getTime());
    assert.equal(bAfter.lastUsedAt.getTime(), bBefore.lastUsedAt.getTime(), "the other session's stamp is untouched");
    assert.equal(after.refreshSessions!.length, 2, 'no session was added or removed');
  });

  test('a refresh token that matches no session is rejected', async () => {
    const u = await makeUser();
    await signIn(u);
    const forged = generateRefreshToken({ id: u.id }); // validly signed, never issued by a sign-in
    assert.equal((await refresh(forged)).status, 401);
    assert.equal((await refresh('not-a-jwt')).status, 401);
  });

  test("sign-out removes only this browser's session", async () => {
    const u = await makeUser();
    const pane = await signIn(u);
    const curl = await signIn(u, 'curl/8.5.0');

    await signOut(pane.refresh);

    assert.equal((await refresh(pane.refresh)).status, 401, 'the browser that signed out is out');
    assert.equal((await refresh(curl.refresh)).status, 200, 'the other session still refreshes');
    const sessions = (await sessionsOf(u.id)).refreshSessions!;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.userAgent, 'curl');
  });

  test('signing out twice, or with an unknown token, is harmless', async () => {
    const u = await makeUser();
    const a = await signIn(u);
    const b = await signIn(u);
    await signOut(a.refresh);
    await signOut(a.refresh);
    await signOut(generateRefreshToken({ id: u.id }));
    assert.equal((await refresh(b.refresh)).status, 200);
  });

  test('sign out of all devices clears every session', async () => {
    const u = await makeUser();
    const a = await signIn(u);
    const b = await signIn(u);
    const out = await call(server.url, 'POST', '/api/account/logout-all', { token: a.access });
    assert.equal(out.status, 200);

    assert.equal((await refresh(a.refresh)).status, 401);
    assert.equal((await refresh(b.refresh)).status, 401);
    assert.deepEqual((await sessionsOf(u.id)).refreshSessions, []);
  });

  test('a password change clears every other session and keeps the caller on a fresh one', async () => {
    const u = await makeUser();
    const a = await signIn(u);
    const b = await signIn(u);
    await sleep(5);

    const res = await call(server.url, 'PUT', '/api/account/password', {
      token: a.access,
      body: { currentPassword: u.password, newPassword: 'Brand-new-pass9' },
    });
    assert.equal(res.status, 200);
    const callerRefresh = cookieValue(res.setCookies, 'refreshToken');
    assert.ok(callerRefresh);

    assert.equal((await refresh(a.refresh)).status, 401);
    assert.equal((await refresh(b.refresh)).status, 401);
    assert.equal((await refresh(callerRefresh as string)).status, 200);
    assert.equal((await sessionsOf(u.id)).refreshSessions?.length, 1);
  });

  test('a password reset clears every session', async () => {
    const raw = randomUUID();
    const u = await makeUser();
    await UserModel.updateOne(
      { _id: u.id },
      { $set: { resetPasswordToken: hashToken(raw), resetPasswordExpires: new Date(Date.now() + 60_000) } },
    );
    const a = await signIn(u);
    const b = await signIn(u);

    await AuthService.resetPassword(raw, 'Reset-pass9');

    assert.equal((await refresh(a.refresh)).status, 401);
    assert.equal((await refresh(b.refresh)).status, 401);
    assert.deepEqual((await sessionsOf(u.id)).refreshSessions, []);
    const again = await signIn({ email: u.email, password: 'Reset-pass9' });
    assert.equal((await refresh(again.refresh)).status, 200, 'signing in with the new password starts a fresh session');
  });

  test('deleting the account removes every session with it', async () => {
    const u = await makeUser();
    const a = await signIn(u);
    const b = await signIn(u);
    const res = await call(server.url, 'DELETE', '/api/account', { token: a.access, body: { confirmation: u.email } });
    assert.equal(res.status, 200);
    assert.equal(await UserModel.exists({ _id: u.id }), null);
    assert.equal((await refresh(a.refresh)).status, 401);
    assert.equal((await refresh(b.refresh)).status, 401);
  });

  test(`past ${MAX_REFRESH_SESSIONS} sessions the least recently used one is dropped`, async () => {
    const u = await makeUser();
    const tokens: string[] = [];
    for (let i = 0; i < MAX_REFRESH_SESSIONS; i++) {
      tokens.push((await signIn(u)).refresh);
      await sleep(3);
    }
    assert.equal((await sessionsOf(u.id)).refreshSessions?.length, MAX_REFRESH_SESSIONS);

    // Use the oldest one, so the second-oldest becomes the least recently used.
    await sleep(3);
    assert.equal((await refresh(tokens[0] as string)).status, 200);
    await sleep(3);
    const newest = await signIn(u);

    const sessions = (await sessionsOf(u.id)).refreshSessions!;
    assert.equal(sessions.length, MAX_REFRESH_SESSIONS, 'still capped');
    assert.equal((await refresh(tokens[1] as string)).status, 401, 'the least recently used session was evicted');
    assert.equal((await refresh(tokens[0] as string)).status, 200, 'a session that was used recently survives');
    assert.equal((await refresh(newest.refresh)).status, 200);
    assert.equal((await refresh(tokens[MAX_REFRESH_SESSIONS - 1] as string)).status, 200);
  });

  test('a legacy single-token user keeps their session and is migrated on first refresh', async () => {
    const u = await makeUser();
    const legacy = generateRefreshToken({ id: u.id });
    // The state every existing user is in on deploy: only the old field.
    await UserModel.updateOne({ _id: u.id }, { $set: { refreshToken: hashToken(legacy) } });
    const before = await sessionsOf(u.id);
    assert.equal(before.refreshToken, hashToken(legacy));
    assert.equal(before.refreshSessions, undefined);

    const first = await refresh(legacy);
    assert.equal(first.status, 200, 'no forced sign-out on deploy');
    assert.ok(first.body.data?.accessToken);

    const migrated = await sessionsOf(u.id);
    assert.equal(migrated.refreshToken, undefined, 'the old field is removed');
    assert.equal(migrated.refreshSessions?.length, 1);
    assert.equal(migrated.refreshSessions?.[0]?.tokenHash, hashToken(legacy));
    assert.equal((await refresh(legacy)).status, 200, 'and it keeps working as a normal session');
    assert.equal((await sessionsOf(u.id)).refreshSessions?.length, 1, 'not migrated twice');
  });

  test('a legacy user can sign in elsewhere without losing the old session', async () => {
    const u = await makeUser();
    const legacy = generateRefreshToken({ id: u.id });
    await UserModel.updateOne({ _id: u.id }, { $set: { refreshToken: hashToken(legacy) } });

    const phone = await signIn(u);
    assert.equal((await refresh(legacy)).status, 200, 'the pre-deploy browser survives a new sign-in');
    assert.equal((await refresh(phone.refresh)).status, 200);
    assert.equal((await sessionsOf(u.id)).refreshSessions?.length, 2);
  });

  test('two tabs presenting the same legacy cookie at once both succeed', async () => {
    const u = await makeUser();
    const legacy = generateRefreshToken({ id: u.id });
    await UserModel.updateOne({ _id: u.id }, { $set: { refreshToken: hashToken(legacy) } });
    const results = await Promise.all([refresh(legacy), refresh(legacy), refresh(legacy)]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
    assert.equal((await sessionsOf(u.id)).refreshSessions?.length, 1, 'migrated exactly once');
  });

  test('sign-out and sign-out-all also clear a legacy token that was never migrated', async () => {
    const one = await makeUser();
    const legacyOne = generateRefreshToken({ id: one.id });
    await UserModel.updateOne({ _id: one.id }, { $set: { refreshToken: hashToken(legacyOne) } });
    await signOut(legacyOne);
    assert.equal((await refresh(legacyOne)).status, 401);

    const all = await makeUser();
    const legacyAll = generateRefreshToken({ id: all.id });
    await UserModel.updateOne({ _id: all.id }, { $set: { refreshToken: hashToken(legacyAll) } });
    const session = await signIn(all);
    await call(server.url, 'POST', '/api/account/logout-all', { token: session.access });
    assert.equal((await refresh(legacyAll)).status, 401);
    assert.equal((await sessionsOf(all.id)).refreshToken, undefined);
  });

  test("extension device sessions are independent of browser sessions", async () => {
    const u = await makeUser();
    const browser = await signIn(u);
    await ExtensionSessionModel.create({
      user: u.id,
      tokenHash: hashToken(randomUUID()),
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await signOut(browser.refresh);
    const extension = await ExtensionSessionModel.findOne({ user: u.id });
    assert.equal(extension?.revokedAt, undefined, 'a browser sign-out leaves the extension connected');

    const again = await signIn(u);
    await call(server.url, 'POST', '/api/account/logout-all', { token: again.access });
    assert.ok((await ExtensionSessionModel.findOne({ user: u.id }))?.revokedAt, 'sign out of all devices disconnects it');
  });

  test('access tokens are unaffected: authenticate() still works for each session', async () => {
    const u = await makeUser();
    const a = await signIn(u);
    const b = await signIn(u);
    const refreshed = (await refresh(a.refresh)).body.data?.accessToken as string;
    for (const token of [a.access, b.access, refreshed]) {
      assert.equal((await call(server.url, 'GET', '/api/account', { token })).status, 200);
    }
    // And generateAccessToken tokens minted directly still pass, as before.
    assert.equal(
      (await call(server.url, 'GET', '/api/account', { token: generateAccessToken({ id: u.id, email: u.email, role: 'user' }) })).status,
      200,
    );
  });
});
