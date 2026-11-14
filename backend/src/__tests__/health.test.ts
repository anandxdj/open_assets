import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createHealthHandler, runHealthChecks } from '../common/health';

const up = async () => 'PONG';
const down = async () => {
  throw new Error('ECONNREFUSED 10.0.0.5:6379 password=hunter2');
};
const hangs = () => new Promise<never>(() => {});

test('all checks up: status ok', async () => {
  const report = await runHealthChecks({
    checks: [
      { name: 'mongo', run: up },
      { name: 'redis', run: up },
    ],
  });
  assert.equal(report.status, 'ok');
  assert.equal(report.checks['mongo']?.status, 'up');
  assert.equal(report.checks['redis']?.status, 'up');
});

test('one check down: degraded, and the other check is still reported up', async () => {
  const report = await runHealthChecks({
    checks: [
      { name: 'mongo', run: up },
      { name: 'redis', run: down },
    ],
  });
  assert.equal(report.status, 'degraded');
  assert.equal(report.checks['mongo']?.status, 'up');
  assert.equal(report.checks['redis']?.status, 'down');
});

test('a check that never settles is cut off by the timeout', async () => {
  const started = Date.now();
  const report = await runHealthChecks({ checks: [{ name: 'redis', run: hangs }], timeoutMs: 50 });
  assert.equal(report.checks['redis']?.status, 'down');
  assert.ok(Date.now() - started < 1000, 'must not wait for the hung dependency');
});

test('a check that throws synchronously is reported down, not thrown', async () => {
  const report = await runHealthChecks({
    checks: [
      {
        name: 'mongo',
        run: () => {
          throw new Error('sync');
        },
      },
    ],
  });
  assert.equal(report.checks['mongo']?.status, 'down');
});

test('shutting down wins over ok so load balancers drain the instance', async () => {
  const report = await runHealthChecks({ checks: [{ name: 'mongo', run: up }], isShuttingDown: () => true });
  assert.equal(report.status, 'shutting_down');
});

function call(handler: ReturnType<typeof createHealthHandler>) {
  const captured: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
    },
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return handler({} as Request, res).then(() => captured);
}

test('handler answers 200 when healthy and 503 when a dependency is down', async () => {
  const healthy = await call(createHealthHandler({ checks: [{ name: 'redis', run: up }] }));
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers['Cache-Control'], 'no-store');

  const failing = await call(createHealthHandler({ checks: [{ name: 'redis', run: down }], onFailure: () => {} }));
  assert.equal(failing.status, 503);
});

test('error details from a failed check never reach the response body', async () => {
  const { body } = await call(createHealthHandler({ checks: [{ name: 'redis', run: down }], onFailure: () => {} }));
  const text = JSON.stringify(body);
  assert.equal(text.includes('hunter2'), false);
  assert.equal(text.includes('10.0.0.5'), false);
  assert.match(text, /"status":"down"/);
});

test('a failure is logged when a dependency goes down, then not repeated while it stays down', async () => {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args);
  try {
    const handler = createHealthHandler({ checks: [{ name: 'redis', run: down }] });
    await call(handler);
    await call(handler);
    await call(handler);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
});
