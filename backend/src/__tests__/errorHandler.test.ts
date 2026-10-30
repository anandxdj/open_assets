import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { errorHandler } from '../common/middlewares/errorHandler';
import { ApiError } from '../common/utils/ApiError';

// Exercises the real handler against a minimal fake response.

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
}

function run(error: unknown, headersSent = false) {
  const captured: Captured = {};
  const nextCalls: unknown[] = [];
  const res = {
    headersSent,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  const req = { method: 'GET', originalUrl: '/api/thing?token=secret' } as Request;
  errorHandler(error, req, res, (arg?: unknown) => void nextCalls.push(arg));
  return { ...captured, nextCalls };
}

const original = { env: process.env.NODE_ENV, error: console.error };
let logged: unknown[][] = [];

beforeEach(() => {
  logged = [];
  console.error = (...args: unknown[]) => void logged.push(args);
});

afterEach(() => {
  console.error = original.error;
  if (original.env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original.env;
});

test('an unexpected error is a generic 500 in production with no stack or message', () => {
  process.env.NODE_ENV = 'production';
  const { status, body } = run(new Error('connect ECONNREFUSED 10.0.0.5:27017'));
  assert.equal(status, 500);
  assert.deepEqual(body, { success: false, message: 'Internal Server Error' });
  assert.equal(JSON.stringify(body).includes('ECONNREFUSED'), false);
});

test('the full error with stack is still logged on the server', () => {
  process.env.NODE_ENV = 'production';
  const error = new Error('boom');
  run(error);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.[1], error);
  // The query string (which can carry tokens) is not logged.
  assert.equal(String(logged[0]?.[0]).includes('secret'), false);
});

test('outside production a 500 includes the stack to help debugging', () => {
  process.env.NODE_ENV = 'development';
  const { status, body } = run(new Error('boom'));
  assert.equal(status, 500);
  assert.equal(body?.['message'], 'Internal Server Error');
  assert.match(String(body?.['stack']), /boom/);
});

test('production never includes a stack on any status', () => {
  process.env.NODE_ENV = 'production';
  for (const error of [new Error('x'), ApiError.internal('secret config name'), ApiError.badRequest('bad')]) {
    assert.equal('stack' in (run(error).body ?? {}), false);
  }
});

test('ApiError 4xx keeps its status and message', () => {
  process.env.NODE_ENV = 'production';
  const { status, body } = run(ApiError.forbidden('Origin not allowed'));
  assert.equal(status, 403);
  assert.deepEqual(body, { success: false, message: 'Origin not allowed' });
  assert.equal(logged.length, 0, 'client errors are not logged as unhandled');
});

test('ApiError 5xx messages are masked (they are written for logs, not users)', () => {
  process.env.NODE_ENV = 'production';
  const { status, body } = run(ApiError.internal('INTERNAL_SERVICE_TOKEN not configured'));
  assert.equal(status, 500);
  assert.equal(body?.['message'], 'Internal Server Error');
});

test('body-parser errors map to 413 and 400', () => {
  process.env.NODE_ENV = 'production';
  const tooLarge = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 });
  assert.equal(run(tooLarge).status, 413);

  const badJson = Object.assign(new SyntaxError('Unexpected token } in JSON at position 4'), { type: 'entity.parse.failed', status: 400 });
  const result = run(badJson);
  assert.equal(result.status, 400);
  assert.equal(result.body?.['message'], 'Request body is not valid JSON');
});

test('multer errors map to client statuses', () => {
  process.env.NODE_ENV = 'production';
  const tooBig = Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
  assert.equal(run(tooBig).status, 413);
  const unexpected = Object.assign(new Error('Unexpected field'), { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' });
  assert.equal(run(unexpected).status, 400);
});

test('Mongoose cast, validation and duplicate-key errors are client errors', () => {
  process.env.NODE_ENV = 'production';
  assert.equal(run(Object.assign(new Error('Cast to ObjectId failed for value "x"'), { name: 'CastError' })).status, 400);
  assert.equal(run(Object.assign(new Error('x validation failed'), { name: 'ValidationError' })).status, 400);
  assert.equal(run(Object.assign(new Error('E11000 duplicate key error collection: db.users'), { code: 11000 })).status, 409);
});

test('a 4xx from an unknown library uses a fixed message, not its own text', () => {
  process.env.NODE_ENV = 'production';
  const { status, body } = run(Object.assign(new Error('internal path /srv/app/x.ts missing'), { statusCode: 404 }));
  assert.equal(status, 404);
  assert.equal(body?.['message'], 'Not found');
});

test('when headers are already sent the error is passed to Express and nothing is written', () => {
  process.env.NODE_ENV = 'production';
  const error = new Error('late');
  const result = run(error, true);
  assert.equal(result.status, undefined);
  assert.deepEqual(result.nextCalls, [error]);
});
