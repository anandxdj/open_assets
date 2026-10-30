import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../common/utils/ApiError';
import {
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  parseListQuery,
} from '../modules/jobs/job.list';
import { originalFileName } from '../modules/upload/fileName';

// Pure-function guards for GET /api/jobs paging and the stored file name. They
// need no DB or Redis; the endpoints themselves are covered by
// jobs.history.test.ts.

const badRequest = (e: unknown) => e instanceof ApiError && e.statusCode === 400;

test('cursor survives an encode/decode round trip', () => {
  const cursor = { score: 1_761_800_000_123, id: '3f1c2d9e-6b7a-4c1e-9a52-0b8f6d2e4a10' };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
});

test('decodeCursor rejects anything encodeCursor could not have produced', () => {
  const good = encodeCursor({ score: 5, id: 'abc' });
  const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
  for (const bad of [
    '',
    'not a cursor',
    good + 'A', // not the canonical encoding
    encode('5|'), // no id
    encode('|abc'), // no score
    encode('-5|abc'), // negative score
    encode('5|a b'), // id outside the job id alphabet
    encode('99999999999999999|abc'), // score too long
    encode('5|abc|extra'),
    'x'.repeat(500),
  ]) {
    assert.equal(decodeCursor(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('isAfterCursor orders by time, then id, both descending', () => {
  const cursor = { score: 100, id: 'm' };
  assert.equal(isAfterCursor({ score: 99, id: 'z' }, cursor), true, 'older job comes after');
  assert.equal(isAfterCursor({ score: 101, id: 'a' }, cursor), false, 'newer job comes before');
  assert.equal(isAfterCursor({ score: 100, id: 'a' }, cursor), true, 'same time, smaller id comes after');
  assert.equal(isAfterCursor({ score: 100, id: 'z' }, cursor), false, 'same time, larger id comes before');
  assert.equal(isAfterCursor(cursor, cursor), false, 'the cursor job itself is not after itself');
});

test('parseListQuery defaults and bounds', () => {
  assert.deepEqual(parseListQuery({}), { limit: LIST_DEFAULT_LIMIT });
  assert.deepEqual(parseListQuery({ limit: '1' }), { limit: 1 });
  assert.deepEqual(parseListQuery({ limit: String(LIST_MAX_LIMIT) }), { limit: LIST_MAX_LIMIT });
  for (const limit of ['0', '-1', String(LIST_MAX_LIMIT + 1), '2.5', 'ten', '', ['1', '2'], { a: '1' }]) {
    assert.throws(() => parseListQuery({ limit }), badRequest, `limit ${JSON.stringify(limit)}`);
  }
});

test('parseListQuery decodes a valid cursor and rejects a bad one', () => {
  const cursor = { score: 42, id: 'job-1' };
  assert.deepEqual(parseListQuery({ limit: '10', cursor: encodeCursor(cursor) }), { limit: 10, cursor });
  assert.throws(() => parseListQuery({ cursor: 'garbage!' }), badRequest);
  assert.throws(() => parseListQuery({ cursor: ['a', 'b'] }), badRequest);
});

// ── stored file name ────────────────────────────────────────────────────────

/** What multer 1.x hands over for a UTF-8 name: the UTF-8 bytes read as latin1. */
const asMulterSendsIt = (name: string) => Buffer.from(name, 'utf8').toString('latin1');

test('originalFileName repairs UTF-8 names that multer decoded as latin1', () => {
  assert.equal(originalFileName(asMulterSendsIt('スプライト.png')), 'スプライト.png');
  assert.equal(originalFileName(asMulterSendsIt('café sheet.png')), 'café sheet.png');
});

test('originalFileName leaves names that are already right alone', () => {
  assert.equal(originalFileName('sprites.png'), 'sprites.png');
  assert.equal(originalFileName('スプライト.png'), 'スプライト.png');
  assert.equal(originalFileName('é.png'), 'é.png', 'a latin1-range name that is not valid UTF-8 bytes');
});

test('originalFileName strips control characters and caps the length', () => {
  assert.equal(originalFileName('  a\u0000b\nc\u007f.png  '), 'abc.png');
  assert.equal(originalFileName('x'.repeat(400)).length, 255);
  assert.equal(originalFileName(''), '');
});
