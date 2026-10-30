import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { ApiError } from '../common/utils/ApiError';
import { errorHandler } from '../common/middlewares/errorHandler';
import { enhanceAiLimiter } from '../common/middlewares/rateLimit';
import { createEnhanceRouter } from '../modules/enhance/enhance.routes';
import type { AiEnhanceDeps } from '../modules/enhance/aiEnhance.service';
import type { AiEnhanceJobRecord } from '../modules/enhance/enhance.types';
import type { AuthRequest } from '../modules/auth/auth.middleware';
import { MemoryStore, MockStorage, fakeAnimatedPng, fakeJpeg, fakePng } from './helpers/enhanceFixtures';

// HTTP-level checks for the AI enhance routes: auth, rate limiting, request
// validation and the not-configured path. Storage, the job store and the queue
// are mocks, so no Mongo, Redis or provider credentials are needed.

const servers: http.Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

/** Stand-in for the JWT check: `x-test-user` is the signed-in user's id. */
const fakeAuth: RequestHandler = (req, _res, next) => {
  const id = req.headers['x-test-user'];
  if (typeof id !== 'string') {
    next(ApiError.unauthorized('Not authenticated'));
    return;
  }
  (req as AuthRequest).user = { id, email: `${id}@example.test`, name: id, role: 'user' };
  next();
};

function makeDeps(configured = true) {
  const storage = new MockStorage();
  const store = new MemoryStore();
  const queued: string[] = [];
  const deps: AiEnhanceDeps = {
    storage,
    store,
    async enqueue(jobId) {
      queued.push(jobId);
    },
    getStorageStatus: () =>
      configured
        ? { provider: 'cloudinary', configured: true, missing: [] }
        : { provider: 'cloudinary', configured: false, missing: ['CLOUDINARY_CLOUD_NAME'] },
  };
  return { deps, storage, store, queued };
}

async function serve(app: express.Express): Promise<string> {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function appWith(options: Parameters<typeof createEnhanceRouter>[0]): Promise<string> {
  const app = express();
  app.use('/api', createEnhanceRouter(options));
  app.use(errorHandler);
  return serve(app);
}

/** Router with the fake auth and a limiter that never trips. */
async function start(configured = true) {
  const ctx = makeDeps(configured);
  const base = await appWith({
    getDeps: async () => ctx.deps,
    authenticate: fakeAuth,
    aiLimiter: (_req, _res, next) => next(),
  });
  return { ...ctx, base };
}

function form(file: Buffer | null, fields: Record<string, string> = {}, type = 'image/png', name = 'art.png') {
  const data = new FormData();
  if (file) data.append('image', new Blob([new Uint8Array(file)], { type }), name);
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function post(base: string, body: FormData, user: string | null = 'user-1') {
  const response = await fetch(`${base}/api/enhance/ai`, {
    method: 'POST',
    body,
    headers: user ? { 'x-test-user': user } : {},
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

// ── authentication ──────────────────────────────────────────────────────────

test('every AI enhance route rejects a request with no token (real authenticate middleware)', async () => {
  const ctx = makeDeps();
  const base = await appWith({ getDeps: async () => ctx.deps, aiLimiter: (_req, _res, next) => next() });

  const submit = await fetch(`${base}/api/enhance/ai`, { method: 'POST', body: form(fakePng(64, 64), { scale: '2' }) });
  const capabilities = await fetch(`${base}/api/enhance/capabilities`);
  const job = await fetch(`${base}/api/enhance/ai/some-job`);
  const result = await fetch(`${base}/api/enhance/ai/some-job/result`);
  for (const response of [submit, capabilities, job, result]) {
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { success: boolean }).success, false);
  }
  assert.equal(ctx.storage.uploads.length, 0, 'nothing is uploaded for an unauthenticated request');
});

test('a forged or garbage bearer token is rejected before any work happens', async () => {
  const ctx = makeDeps();
  const base = await appWith({ getDeps: async () => ctx.deps, aiLimiter: (_req, _res, next) => next() });
  const response = await fetch(`${base}/api/enhance/ai`, {
    method: 'POST',
    body: form(fakePng(64, 64), { scale: '2' }),
    headers: { Authorization: 'Bearer not.a.real.token' },
  });
  assert.equal(response.status, 401);
  assert.equal(ctx.storage.uploads.length, 0);
});

test('the submit route is wired to the shared rate limiter, ahead of authentication and the upload', () => {
  const router = createEnhanceRouter({ getDeps: async () => makeDeps().deps });
  const layer = (router as any).stack.find((entry: any) => entry.route?.path === '/enhance/ai' && entry.route.methods.post);
  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  assert.equal(handlers[0], enhanceAiLimiter, 'the limiter runs first so floods never reach auth or multer');
  assert.ok(handlers.length >= 5, 'limiter, auth, storage guard, upload, handler');
});

test('rate limiting answers 429 once the cap is reached', async () => {
  const ctx = makeDeps();
  const base = await appWith({
    getDeps: async () => ctx.deps,
    authenticate: fakeAuth,
    aiLimiter: rateLimit({
      windowMs: 60_000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'AI enhance limit reached, please try again in a few minutes.' },
    }),
  });
  const codes: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const response = await fetch(`${base}/api/enhance/ai`, { method: 'POST', body: form(fakePng(64, 64), { scale: '2' }), headers: { 'x-test-user': 'u' } });
    codes.push(response.status);
  }
  assert.deepEqual(codes, [202, 202, 429]);
});

// ── not configured ──────────────────────────────────────────────────────────

test('without storage credentials the capabilities route says so instead of failing', async () => {
  const { base } = await start(false);
  const response = await fetch(`${base}/api/enhance/capabilities`, { headers: { 'x-test-user': 'user-1' } });
  assert.equal(response.status, 200);
  const { data } = (await response.json()) as { data: Record<string, any> };
  assert.equal(data.available, false);
  assert.equal(data.reason, 'STORAGE_NOT_CONFIGURED');
  assert.equal(data.provider, 'cloudinary');
  assert.match(data.message, /isn't configured/);
  assert.deepEqual(data.missing, ['CLOUDINARY_CLOUD_NAME']);
  assert.equal(data.limits.maxUpscaleInputPixels, 2048 * 2048);
});

test('without storage credentials a submit answers 503 STORAGE_NOT_CONFIGURED and uploads nothing', async () => {
  const { base, storage, queued } = await start(false);
  const { status, body } = await post(base, form(fakePng(64, 64), { scale: '2' }));
  assert.equal(status, 503);
  assert.equal(body.success, false);
  assert.equal(body.code, 'STORAGE_NOT_CONFIGURED');
  assert.match(body.message, /Cloudinary/);
  assert.equal(storage.uploads.length, 0);
  assert.equal(queued.length, 0);
});

test('capabilities lists the supported operations and limits when configured', async () => {
  const { base } = await start();
  const response = await fetch(`${base}/api/enhance/capabilities`, { headers: { 'x-test-user': 'user-1' } });
  const { data } = (await response.json()) as { data: Record<string, any> };
  assert.equal(data.available, true);
  assert.equal(data.reason, undefined);
  assert.deepEqual(data.operations, { upscale: { scales: [2, 4] }, backgroundRemoval: true });
  assert.equal(data.limits.maxBackgroundRemovalSide, 6144);
  assert.equal(data.limits.maxBytes, 10 * 1024 * 1024);
});

// ── validation ──────────────────────────────────────────────────────────────

test('a submit with no file is a 400', async () => {
  const { base, storage } = await start();
  const { status, body } = await post(base, form(null, { scale: '2' }));
  assert.equal(status, 400);
  assert.match(body.message, /PNG, JPEG or WebP/);
  assert.equal(storage.uploads.length, 0);
});

test('SVG, GIF and other non-images are rejected with a reason', async () => {
  const { base, storage } = await start();
  const svg = await post(base, form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { scale: '2' }, 'image/svg+xml', 'a.svg'));
  assert.equal(svg.status, 400);
  assert.match(svg.body.message, /doesn't take SVG\. Use Cleanup/);

  const gif = await post(base, form(Buffer.from('GIF89a'), { scale: '2' }, 'image/gif', 'a.gif'));
  assert.equal(gif.status, 400);
  assert.match(gif.body.message, /PNG, JPEG or WebP/);

  // The declared type is not trusted: a text file called .png is caught by its bytes.
  const liar = await post(base, form(Buffer.from('definitely not a png'), { scale: '2' }, 'image/png', 'a.png'));
  assert.equal(liar.status, 400);
  assert.match(liar.body.message, /PNG, JPEG or WebP/);
  assert.equal(storage.uploads.length, 0);
});

test('invalid options are a 400 before storage is touched', async () => {
  const { base, storage } = await start();
  const none = await post(base, form(fakePng(64, 64)));
  assert.equal(none.status, 400);
  assert.match(none.body.message, /upscale, remove the background, or both/);

  const badScale = await post(base, form(fakePng(64, 64), { scale: '3' }));
  assert.equal(badScale.status, 400);
  assert.match(badScale.body.message, /scale must be 2 or 4/);
  assert.equal(storage.uploads.length, 0);
});

test('dimensions over the provider limit are a 400 that explains the cap', async () => {
  const { base, storage } = await start();
  const big = await post(base, form(fakePng(3000, 3000), { scale: '2' }));
  assert.equal(big.status, 400);
  assert.match(big.body.message, /Cloudinary upscales images under 4\.2 megapixels/);

  const bg = await post(base, form(fakePng(1600, 1000), { scale: '4', removeBackground: 'true' }));
  assert.equal(bg.status, 400);
  assert.match(bg.body.message, /6,144 px per side/);

  const animated = await post(base, form(fakeAnimatedPng(64, 64), { scale: '2' }));
  assert.equal(animated.status, 400);
  assert.match(animated.body.message, /Animated/);
  assert.equal(storage.uploads.length, 0);
});

test('a file over the size limit is a 413 with a readable message', async () => {
  const { base, storage } = await start();
  const { status, body } = await post(base, form(fakePng(64, 64, 11 * 1024 * 1024), { scale: '2' }));
  assert.equal(status, 413);
  assert.match(body.message, /larger than 10 MB/);
  assert.equal(storage.uploads.length, 0);
});

// ── the happy path and job ownership ────────────────────────────────────────

test('a valid submit is a 202 with a job to poll, and the source goes to the enhance folder', async () => {
  const { base, storage, store, queued } = await start();
  const { status, body } = await post(base, form(fakeJpeg(800, 600), { scale: '4', removeBackground: 'true' }, 'image/jpeg', 'photo.jpg'));
  assert.equal(status, 202);
  assert.equal(body.success, true);
  assert.equal(body.data.kind, 'ai');
  assert.equal(body.data.status, 'queued');
  assert.deepEqual(body.data.recipe.operations, [{ op: 'upscale', scale: 4 }, { op: 'background_removal' }]);
  assert.deepEqual(body.data.recipe.output, { width: 3200, height: 2400 });
  assert.equal(body.data.resultUrl, undefined);

  assert.equal(storage.uploads[0]?.options.folder, 'enhance');
  assert.deepEqual(queued, [body.data.jobId]);
  assert.equal(store.jobs.get(body.data.jobId)?.userId, 'user-1');
});

async function seedJob(store: MemoryStore, patch: Partial<AiEnhanceJobRecord> = {}): Promise<AiEnhanceJobRecord> {
  const record: AiEnhanceJobRecord = {
    id: 'job-1',
    userId: 'user-1',
    status: 'processing',
    provider: 'cloudinary',
    options: { scale: 2, removeBackground: false },
    source: { width: 100, height: 100, bytes: 1000, format: 'png' },
    sourceUrl: 'https://res.example.test/job-1',
    sourcePublicId: 'open_assets/enhance/job-1',
    resultUrl: '',
    error: '',
    errorCode: '',
    createdAt: new Date().toISOString(),
    ...patch,
  };
  await store.create(record);
  return record;
}

test('only the owner can read a job; strangers get 403 and unknown ids 404', async () => {
  const { base, store } = await start();
  await seedJob(store);

  const own = await fetch(`${base}/api/enhance/ai/job-1`, { headers: { 'x-test-user': 'user-1' } });
  assert.equal(own.status, 200);
  const { data } = (await own.json()) as { data: Record<string, any> };
  assert.equal(data.status, 'processing');
  assert.equal(data.resultUrl, undefined, 'no result URL until the job is ready');

  const stranger = await fetch(`${base}/api/enhance/ai/job-1`, { headers: { 'x-test-user': 'user-2' } });
  assert.equal(stranger.status, 403);
  const strangerResult = await fetch(`${base}/api/enhance/ai/job-1/result`, { headers: { 'x-test-user': 'user-2' } });
  assert.equal(strangerResult.status, 403);

  const missing = await fetch(`${base}/api/enhance/ai/nope`, { headers: { 'x-test-user': 'user-1' } });
  assert.equal(missing.status, 404);
});

test('a failed job reports its reason and a ready job reports its result URL', async () => {
  const { base, store } = await start();
  await seedJob(store, { id: 'bad', status: 'failed', error: 'The provider took too long.', errorCode: 'PROVIDER_TIMEOUT' });
  await seedJob(store, { id: 'good', status: 'ready', resultUrl: 'https://res.example.test/out.png' });

  const bad = (await (await fetch(`${base}/api/enhance/ai/bad`, { headers: { 'x-test-user': 'user-1' } })).json()) as { data: Record<string, any> };
  assert.equal(bad.data.status, 'failed');
  assert.equal(bad.data.errorCode, 'PROVIDER_TIMEOUT');
  assert.equal(bad.data.resultUrl, undefined);

  const good = (await (await fetch(`${base}/api/enhance/ai/good`, { headers: { 'x-test-user': 'user-1' } })).json()) as { data: Record<string, any> };
  assert.equal(good.data.resultUrl, 'https://res.example.test/out.png');
});

test('the result route refuses unfinished jobs and streams a finished PNG', async () => {
  const { base, store } = await start();
  const png = fakePng(8, 8);
  const provider = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
    res.end(png);
  });
  servers.push(provider);
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/out.png`;

  await seedJob(store, { id: 'pending', status: 'processing' });
  await seedJob(store, { id: 'done', status: 'ready', resultUrl: providerUrl });
  await seedJob(store, { id: 'gone', status: 'ready', resultUrl: 'http://127.0.0.1:9/never' });

  const notReady = await fetch(`${base}/api/enhance/ai/pending/result`, { headers: { 'x-test-user': 'user-1' } });
  assert.equal(notReady.status, 400);

  const done = await fetch(`${base}/api/enhance/ai/done/result`, { headers: { 'x-test-user': 'user-1' } });
  assert.equal(done.status, 200);
  assert.equal(done.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await done.arrayBuffer()), png);

  const gone = await fetch(`${base}/api/enhance/ai/gone/result`, { headers: { 'x-test-user': 'user-1' } });
  assert.equal(gone.status, 502);
});
