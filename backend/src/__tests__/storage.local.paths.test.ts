import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { contentTypeFor, publicUrl, resolveKey, resolveLocalStorageSettings, resolveServedStorageDir, sanitizeSegment, toSegments } from '../lib/storage/local.paths';

const ROOT = path.resolve('/srv/oa-files');

test('resolveKey maps a key into the root', () => {
  assert.equal(resolveKey(ROOT, 'originals/abc.png'), path.join(ROOT, 'originals', 'abc.png'));
  assert.equal(resolveKey(ROOT, 'originals/abc.png.d/nobg.png'), path.join(ROOT, 'originals', 'abc.png.d', 'nobg.png'));
});

test('resolveKey refuses traversal, absolute paths, hidden files and junk', () => {
  const bad = [
    '',
    '../secret',
    'originals/../../secret',
    'originals/..',
    '/etc/passwd',
    'originals//abc.png',
    'originals/./abc.png',
    '.env',
    'originals/.hidden',
    'originals\\..\\secret',
    'originals/abc.png\0.txt',
    'a/'.repeat(400),
  ];
  for (const key of bad) assert.equal(resolveKey(ROOT, key), null, JSON.stringify(key));
  assert.equal(resolveKey(ROOT, undefined as unknown as string), null);
});

test('resolveKey never leaves the root, whatever the key', () => {
  for (const key of ['a/b', 'a/..b', 'a/b..c', '..a/b', 'a/b/..c']) {
    const resolved = resolveKey(ROOT, key);
    if (resolved !== null) assert.ok(resolved.startsWith(ROOT + path.sep), key);
  }
});

test('sanitizeSegment keeps safe names and makes lossy renames unique', () => {
  assert.equal(sanitizeSegment('asset_001'), 'asset_001');
  assert.equal(sanitizeSegment('3f2a-9c.png'), '3f2a-9c.png');
  const spaced = sanitizeSegment('fire sword');
  assert.match(spaced, /^fire_sword-[0-9a-f]{8}$/);
  assert.notEqual(spaced, sanitizeSegment('fire?sword'));
  // A name with nothing safe in it still gets a usable, distinct name.
  assert.match(sanitizeSegment('日本語'), /^x-[0-9a-f]{8}$/);
  assert.notEqual(sanitizeSegment('日本語'), sanitizeSegment('中文'));
  // Never a hidden file or a dot segment.
  for (const name of ['.', '..', '.env', '...x']) assert.ok(!sanitizeSegment(name).startsWith('.'), name);
  assert.ok(sanitizeSegment('a'.repeat(500)).length <= 110);
});

test('toSegments drops empty, dot and dot-dot parts of a public id', () => {
  assert.deepEqual(toSegments('job-1/asset_001'), ['job-1', 'asset_001']);
  assert.deepEqual(toSegments('../../etc/passwd'), ['etc', 'passwd']);
  assert.deepEqual(toSegments('/a//b/./c\\d'), ['a', 'b', 'c', 'd']);
});

test('publicUrl encodes each segment and keeps the slashes', () => {
  const settings = { dir: ROOT, baseUrl: 'http://oa-e2e.localhost:4110' };
  assert.equal(publicUrl(settings, 'crops/job/asset_001.png'), 'http://oa-e2e.localhost:4110/storage/crops/job/asset_001.png');
  assert.equal(publicUrl(settings, 'crops/a b/c#d.png'), 'http://oa-e2e.localhost:4110/storage/crops/a%20b/c%23d.png');
});

test('settings come from the environment, with the PORT-based default URL', () => {
  assert.deepEqual(resolveLocalStorageSettings({}, '/work'), { dir: '/work/.local-storage', baseUrl: 'http://localhost:4000' });
  assert.deepEqual(
    resolveLocalStorageSettings({ LOCAL_STORAGE_DIR: '/data/files', PORT: '4110', LOCAL_STORAGE_BASE_URL: 'https://api.example.com/' }, '/work'),
    { dir: '/data/files', baseUrl: 'https://api.example.com' },
  );
});

test('content types come from the extension; unknown ones are opaque', () => {
  assert.equal(contentTypeFor('a.png'), 'image/png');
  assert.equal(contentTypeFor('a.JPG'), 'image/jpeg');
  assert.equal(contentTypeFor('a.zip'), 'application/zip');
  assert.equal(contentTypeFor('a.svg'), 'application/octet-stream');
  assert.equal(contentTypeFor('a.bin'), 'application/octet-stream');
});

test('the local provider always serves its folder', () => {
  assert.equal(resolveServedStorageDir({ STORAGE_PROVIDER: 'local' }, { cwd: '/work', exists: () => false }), '/work/.local-storage');
});

test('another provider still serves an existing local folder, read-only, so old /storage URLs keep loading', () => {
  for (const provider of ['cloudinary', 'imagekit', undefined]) {
    const env = provider ? { STORAGE_PROVIDER: provider } : {};
    assert.equal(resolveServedStorageDir(env, { cwd: '/work', exists: (d) => d === '/work/.local-storage' }), '/work/.local-storage');
    assert.equal(resolveServedStorageDir(env, { cwd: '/work', exists: () => false }), undefined);
  }
});

test('an explicit LOCAL_STORAGE_DIR is served even before the folder exists', () => {
  assert.equal(
    resolveServedStorageDir({ STORAGE_PROVIDER: 'cloudinary', LOCAL_STORAGE_DIR: '/data/files' }, { cwd: '/work', exists: () => false }),
    '/data/files',
  );
});

test('production serves old local files only with ALLOW_LOCAL_STORAGE=1', () => {
  const base = { NODE_ENV: 'production', STORAGE_PROVIDER: 'cloudinary', LOCAL_STORAGE_DIR: '/data/files' };
  const opts = { cwd: '/work', exists: () => true };
  assert.equal(resolveServedStorageDir(base, opts), undefined);
  assert.equal(resolveServedStorageDir({ ...base, ALLOW_LOCAL_STORAGE: '0' }, opts), undefined);
  assert.equal(resolveServedStorageDir({ ...base, ALLOW_LOCAL_STORAGE: '1' }, opts), '/data/files');
  assert.equal(resolveServedStorageDir({ ...base, ALLOW_LOCAL_STORAGE: 'true' }, opts), '/data/files');
});
