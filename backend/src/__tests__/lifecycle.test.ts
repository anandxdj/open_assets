import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShutdown } from '../common/lifecycle';
import { createCorsOptions, isOriginAllowed } from '../common/config/cors';
import { checkEnv } from '../common/config/env';

function harness(timeoutMs = 1000) {
  const events: string[] = [];
  const exits: number[] = [];
  const shutdown = createShutdown({
    timeoutMs,
    log: (message) => void events.push(message),
    exit: (code) => void exits.push(code),
  });
  return { shutdown, events, exits };
}

test('closers run in registration order, then the process exits 0', async () => {
  const { shutdown, exits } = harness();
  const order: string[] = [];
  shutdown.register('server', async () => void order.push('server'));
  shutdown.register('workers', async () => void order.push('workers'));
  shutdown.register('redis', () => void order.push('redis'));

  await shutdown.run('SIGTERM');

  assert.deepEqual(order, ['server', 'workers', 'redis']);
  assert.deepEqual(exits, [0]);
});

test('a failing closer does not stop the rest and makes the exit code non-zero', async () => {
  const { shutdown, exits, events } = harness();
  const order: string[] = [];
  shutdown.register('workers', async () => {
    throw new Error('stuck job');
  });
  shutdown.register('redis', async () => void order.push('redis'));

  await shutdown.run('SIGTERM');

  assert.deepEqual(order, ['redis']);
  assert.deepEqual(exits, [1]);
  assert.ok(events.some((line) => line.includes('workers') && line.includes('stuck job')));
});

test('a closer that hangs is abandoned when the time budget runs out', async () => {
  const { shutdown, exits } = harness(100);
  const order: string[] = [];
  shutdown.register('workers', () => new Promise<never>(() => {}));
  shutdown.register('redis', async () => void order.push('redis'));

  const started = Date.now();
  await shutdown.run('SIGTERM');

  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(exits, [1]);
  // The budget is spent on the hung closer, so later ones are skipped rather than blocking exit.
  assert.deepEqual(order, []);
});

test('run is idempotent: a second signal does not run the closers again', async () => {
  const { shutdown, exits } = harness();
  let calls = 0;
  shutdown.register('server', async () => void calls++);

  await Promise.all([shutdown.run('SIGTERM'), shutdown.run('SIGINT')]);

  assert.equal(calls, 1);
  assert.deepEqual(exits, [0]);
});

test('isShuttingDown flips as soon as shutdown starts', async () => {
  const { shutdown } = harness();
  assert.equal(shutdown.isShuttingDown(), false);
  const done = shutdown.run('SIGTERM');
  assert.equal(shutdown.isShuttingDown(), true);
  await done;
});

test('an explicit exit code (crash path) is kept even when every closer succeeds', async () => {
  const { shutdown, exits } = harness();
  shutdown.register('server', async () => {});
  await shutdown.run('uncaught exception', 1);
  assert.deepEqual(exits, [1]);
});

// ── CORS ────────────────────────────────────────────────────────────────────

const prod = checkEnv({
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://x',
  FRONTEND_URL: 'https://app.example.com',
  EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  CORS_ORIGINS: 'https://admin.example.com',
}).config;
const dev = checkEnv({ MONGO_URI: 'mongodb://x', FRONTEND_URL: 'https://app.example.com' }).config;

test('production CORS allows only the configured origins', () => {
  assert.equal(isOriginAllowed('https://app.example.com', prod), true);
  assert.equal(isOriginAllowed('https://admin.example.com', prod), true);
  assert.equal(isOriginAllowed('chrome-extension://abcdefghijklmnopabcdefghijklmnop', prod), true);
  assert.equal(isOriginAllowed('https://evil.example.net', prod), false);
  assert.equal(isOriginAllowed('http://app.example.com', prod), false, 'scheme must match');
});

test('production CORS rejects localhost and unknown extensions', () => {
  assert.equal(isOriginAllowed('http://localhost:3000', prod), false);
  assert.equal(isOriginAllowed('http://127.0.0.1:3000', prod), false);
  assert.equal(isOriginAllowed('chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba', prod), false);
});

test('development CORS also allows localhost on any port and unpacked extensions', () => {
  assert.equal(isOriginAllowed('http://localhost:3104', dev), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:3000', dev), true);
  assert.equal(isOriginAllowed('chrome-extension://abcdefghijklmnopabcdefghijklmnop', dev), true);
  assert.equal(isOriginAllowed('https://evil.example.net', dev), false);
});

test('the CORS callback passes requests without an Origin and turns a denied origin into a 403 ApiError', () => {
  const options = createCorsOptions(prod);
  const origin = options.origin as (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;

  let result: { err: Error | null; allow?: boolean } | undefined;
  origin(undefined, (err, allow) => void (result = { err, allow }));
  assert.deepEqual(result, { err: null, allow: true });

  origin('https://evil.example.net', (err, allow) => void (result = { err, allow }));
  assert.equal((result?.err as { statusCode?: number } | null)?.statusCode, 403);
  assert.equal(options.credentials, true);
});
