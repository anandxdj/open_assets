import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalStorageAdapter } from '../lib/storage/local.adapter';
import { createLocalStorageRouter } from '../lib/storage/local.router';
import { startTestServer, type TestServer } from './http-test-utils';

let dir: string;
let outside: string;
let server: TestServer;
let adapter: LocalStorageAdapter;
let png: Buffer;

before(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-serve-'));
  dir = path.join(base, 'files');
  outside = path.join(base, 'outside');
  await fs.mkdir(dir);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret');
  adapter = new LocalStorageAdapter({ dir, baseUrl: 'http://x' });
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  server = await startTestServer((app) => app.use('/storage', createLocalStorageRouter(dir)));
});

after(async () => {
  await server.close();
  await fs.rm(path.dirname(dir), { recursive: true, force: true });
});

/** fetch() normalises `..` away before sending, so traversal attempts go through a raw request. */
function raw(requestPath: string, method = 'GET', headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(server.url);
    const req = http.request({ host: url.hostname, port: url.port, path: requestPath, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves a stored image with its content type, nosniff-safe headers and caching validators', async () => {
  const stored = await adapter.upload(png, { folder: 'originals', publicId: 'abc' });
  const res = await fetch(`${server.url}/storage/${stored.publicId}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(res.headers.get('content-disposition'), 'inline');
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.ok(res.headers.get('etag'));
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);

  // fetch() adds Cache-Control: no-cache to a request with If-None-Match, which defeats the 304, so go raw.
  const conditional = await raw(`/storage/${stored.publicId}`, 'GET', { 'if-none-match': res.headers.get('etag') ?? '' });
  assert.equal(conditional.status, 304);
});

test('HEAD works and other methods are refused', async () => {
  const stored = await adapter.upload(png, { folder: 'originals', publicId: 'head' });
  assert.equal((await fetch(`${server.url}/storage/${stored.publicId}`, { method: 'HEAD' })).status, 200);
  const post = await fetch(`${server.url}/storage/${stored.publicId}`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal((await fetch(`${server.url}/storage/${stored.publicId}`, { method: 'DELETE' })).status, 405);
});

test('zips and unknown files download instead of rendering', async () => {
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30)]);
  const stored = await adapter.upload(zip, { folder: 'exports', publicId: 'export_1', resourceType: 'raw' });
  const res = await fetch(`${server.url}/storage/${stored.publicId}`);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment/);

  const svg = await adapter.upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), {
    folder: 'originals',
    publicId: 'evil',
  });
  const served = await fetch(`${server.url}/storage/${svg.publicId}`);
  assert.equal(served.headers.get('content-type'), 'application/octet-stream');
  assert.match(served.headers.get('content-disposition') ?? '', /^attachment/);
});

test('derived files are served too', async () => {
  const stored = await adapter.upload(png, { folder: 'crops', publicId: 'job/asset_001' });
  const up = await adapter.applyUpscale(stored.publicId, 2);
  const res = await fetch(up.replace('http://x', server.url));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width, 128);
});

test('directories are never listed or redirected', async () => {
  await adapter.upload(png, { folder: 'originals', publicId: 'listed' });
  for (const p of ['/storage/', '/storage', '/storage/originals', '/storage/originals/', '/storage/crops/job', '/storage/crops/job/']) {
    const res = await raw(p);
    assert.equal(res.status, 404, p);
    assert.ok(!res.body.includes('listed'), p);
  }
});

test('path traversal in every encoding is a 404 and leaks nothing', async () => {
  const attempts = [
    '/storage/../outside/secret.txt',
    '/storage/%2e%2e/outside/secret.txt',
    '/storage/%2E%2E%2Foutside%2Fsecret.txt',
    '/storage/originals/../../outside/secret.txt',
    '/storage/originals/%2e%2e/%2e%2e/outside/secret.txt',
    '/storage/..%2foutside%2fsecret.txt',
    '/storage/originals/..%5coutside%5csecret.txt',
    '/storage//etc/passwd',
    '/storage/%2fetc%2fpasswd',
    '/storage/originals/abc.png%00.txt',
    '/storage/%',
    '/storage/%e0%a4%a',
  ];
  for (const attempt of attempts) {
    const res = await raw(attempt);
    assert.ok(res.status === 404 || res.status === 400, `${attempt} -> ${res.status}`);
    assert.ok(!res.body.includes('top secret'), attempt);
  }
});

test('hidden files are not served', async () => {
  await fs.writeFile(path.join(dir, '.env'), 'SECRET=1');
  await fs.mkdir(path.join(dir, 'originals'), { recursive: true });
  await fs.writeFile(path.join(dir, 'originals', '.hidden.png'), png);
  for (const p of ['/storage/.env', '/storage/originals/.hidden.png']) {
    const res = await raw(p);
    assert.equal(res.status, 404, p);
  }
});

test('a symlink that points outside the storage directory is not followed', async () => {
  await fs.mkdir(path.join(dir, 'originals'), { recursive: true });
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(dir, 'originals', 'link.png'));
  await fs.symlink(outside, path.join(dir, 'linked-dir'));
  for (const p of ['/storage/originals/link.png', '/storage/linked-dir/secret.txt']) {
    const res = await raw(p);
    assert.equal(res.status, 404, p);
    assert.ok(!res.body.includes('top secret'), p);
  }
});

test('a missing file is a bare 404', async () => {
  const res = await raw('/storage/originals/nope.png');
  assert.equal(res.status, 404);
  assert.equal(res.body, '');
});

test('createApp serves old files read-only when the provider is cloudinary', async () => {
  const stored = await adapter.upload(png, { folder: 'originals', publicId: 'legacy' });
  const previous = { provider: process.env['STORAGE_PROVIDER'], dir: process.env['LOCAL_STORAGE_DIR'], env: process.env['NODE_ENV'] };
  process.env['STORAGE_PROVIDER'] = 'cloudinary';
  process.env['LOCAL_STORAGE_DIR'] = dir;
  delete process.env['NODE_ENV'];
  let app: TestServer | undefined;
  try {
    const { createApp } = await import('../app');
    const instance = createApp();
    app = await startTestServer((root) => root.use(instance));
    const ok = await fetch(`${app.url}/storage/${stored.publicId}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), png);
    // Read-only and traversal-safe, exactly like the local provider.
    assert.equal((await fetch(`${app.url}/storage/${stored.publicId}`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${app.url}/storage/..%2Foutside%2Fsecret.txt`)).status, 404);
  } finally {
    await app?.close();
    for (const [key, value] of [['STORAGE_PROVIDER', previous.provider], ['LOCAL_STORAGE_DIR', previous.dir], ['NODE_ENV', previous.env]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
