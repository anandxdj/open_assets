import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertOwner } from '../common/utils/authz';
import { ApiError } from '../common/utils/ApiError';
import { registerSchema } from '../modules/auth/dto/register.schema';

// Regression guards for the P0 security fixes. These run with no DB/Redis — they
// exercise pure functions only.

test('assertOwner allows the resource owner', () => {
  assert.doesNotThrow(() => assertOwner('user-1', 'user-1'));
});

test('assertOwner (#2 IDOR) blocks a different user with 403', () => {
  assert.throws(
    () => assertOwner('user-1', 'user-2'),
    (e: unknown) => e instanceof ApiError && e.statusCode === 403,
  );
});

test('assertOwner fails closed when requester id is missing', () => {
  assert.throws(
    () => assertOwner('user-1', undefined),
    (e: unknown) => e instanceof ApiError && e.statusCode === 403,
  );
});

test('assertOwner fails closed when resource owner is missing', () => {
  assert.throws(
    () => assertOwner(undefined, 'user-1'),
    (e: unknown) => e instanceof ApiError && e.statusCode === 403,
  );
});

test('registerSchema (#1) strips a client-supplied role', () => {
  const parsed = registerSchema.parse({
    name: 'Ada',
    email: 'Ada@Example.com',
    password: 'Password1',
    role: 'admin',
  }) as Record<string, unknown>;
  assert.equal('role' in parsed, false, 'role must never survive registration parsing');
  assert.equal(parsed['email'], 'ada@example.com');
});

test('registerSchema rejects a weak password', () => {
  assert.throws(() =>
    registerSchema.parse({ name: 'Ada', email: 'a@b.com', password: 'weak' }),
  );
});
