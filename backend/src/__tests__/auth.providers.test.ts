import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthProviders, providersRouter } from '../modules/auth/providers.route';
import { startTestServer, type TestServer } from './http-test-utils';

const FULL = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_CALLBACK_URL: 'https://api.example.com/api/auth/google/callback' };

test('Google needs a client id, a secret and a callback URL together', () => {
  assert.equal(getAuthProviders({ ...FULL }).google, true);
  assert.equal(getAuthProviders({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'https://x/cb' }).google, true);
  assert.equal(getAuthProviders({}).google, false);
  assert.equal(getAuthProviders({ ...FULL, GOOGLE_CLIENT_ID: '' }).google, false);
  assert.equal(getAuthProviders({ ...FULL, GOOGLE_CLIENT_SECRET: '  ' }).google, false);
  assert.equal(getAuthProviders({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).google, false);
});

let server: TestServer;
const saved = Object.fromEntries(Object.keys(FULL).map((k) => [k, process.env[k]]));

before(async () => {
  server = await startTestServer((app) => app.use('/api/auth', providersRouter));
});

after(async () => {
  await server.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('GET /api/auth/providers is public, cacheable and reports the server env, never its values', async () => {
  for (const key of Object.keys(FULL)) delete process.env[key];
  delete process.env['GOOGLE_REDIRECT_URI'];
  const off = await fetch(`${server.url}/api/auth/providers`);
  assert.equal(off.status, 200);
  assert.match(off.headers.get('cache-control') ?? '', /public, max-age=\d+/);
  assert.deepEqual(((await off.json()) as { data: unknown }).data, { google: false });

  Object.assign(process.env, FULL);
  const on = await fetch(`${server.url}/api/auth/providers`);
  const text = await on.text();
  assert.deepEqual(JSON.parse(text).data, { google: true });
  assert.doesNotMatch(text, /secret|example\.com/);
});
