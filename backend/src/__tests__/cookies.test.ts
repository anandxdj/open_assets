import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookieOptions, clearSessionCookieOptions } from '../common/config/cookies';

// Each test file runs in its own process, so the env changes below cannot leak into other files.

const KEYS = ['NODE_ENV', 'COOKIE_SECURE', 'COOKIE_SAMESITE', 'COOKIE_DOMAIN'] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('production cookies are httpOnly, Secure and SameSite=None by default', () => {
  setEnv({ NODE_ENV: 'production' });
  const options = sessionCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'none');
  assert.equal(options.path, '/');
  assert.equal(options.maxAge, 7 * 24 * 60 * 60 * 1000);
  assert.equal('domain' in options, false);
});

test('development cookies work over plain http: not Secure, SameSite=Lax', () => {
  setEnv({ NODE_ENV: 'development' });
  const options = sessionCookieOptions();
  assert.equal(options.secure, false);
  assert.equal(options.sameSite, 'lax');
});

test('COOKIE_SAMESITE, COOKIE_SECURE and COOKIE_DOMAIN override the defaults', () => {
  setEnv({ NODE_ENV: 'production', COOKIE_SAMESITE: 'lax', COOKIE_DOMAIN: '.example.com' });
  const options = sessionCookieOptions();
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.secure, true);
  assert.equal(options.domain, '.example.com');
});

test('the clearing options match the set options except maxAge, so the browser actually deletes the cookie', () => {
  setEnv({ NODE_ENV: 'production', COOKIE_DOMAIN: '.example.com' });
  const { maxAge, ...expected } = sessionCookieOptions();
  assert.ok(maxAge);
  assert.deepEqual(clearSessionCookieOptions(), expected);
});
