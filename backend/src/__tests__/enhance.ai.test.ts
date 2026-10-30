import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { Resvg } from '@resvg/resvg-js';
import { ApiError } from '../common/utils/ApiError';
import { probeImage } from '../modules/enhance/imageProbe';
import {
  getAiEnhanceLimits,
  outputSize,
  parseAiEnhanceOptions,
  validateAiEnhance,
} from '../modules/enhance/aiEnhance.limits';
import {
  buildRecipe,
  describeProviderFailure,
  runAiEnhanceJob,
  submitAiEnhance,
  toJobResponse,
  STORAGE_NOT_CONFIGURED,
  STORAGE_UNSUPPORTED,
} from '../modules/enhance/aiEnhance.service';
import { StorageTransformUnsupportedError } from '../lib/storage/local.transforms';
import type { AiEnhanceDeps } from '../modules/enhance/aiEnhance.service';
import type { AiEnhanceOptions } from '../modules/enhance/enhance.types';
import { getStorageStatus } from '../lib/storage/status';
import { CloudinaryAdapter } from '../lib/storage/cloudinary.adapter';
import { ImageKitAdapter } from '../lib/storage/imagekit.adapter';
import {
  MemoryStore,
  MockStorage,
  fakeAnimatedPng,
  fakeJpeg,
  fakePng,
  fakeWebpExtended,
  fakeWebpLossless,
  fakeWebpLossy,
} from './helpers/enhanceFixtures';

// These run with no DB, Redis or provider credentials: pure functions, an
// in-memory job store and a mocked storage adapter.

const cloudinary = getAiEnhanceLimits('cloudinary');
const imagekit = getAiEnhanceLimits('imagekit');

function image(width: number, height: number, bytes = 100_000, animated = false) {
  return { width, height, bytes, animated };
}

function assertApiError(status: number, message: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError, 'expected an ApiError');
    assert.equal(error.statusCode, status);
    assert.match(error.message, message);
    return true;
  };
}

// ── image probe ─────────────────────────────────────────────────────────────

test('probeImage reads a real PNG', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="red"/></svg>';
  const png = Buffer.from(new Resvg(svg).render().asPng());
  assert.deepEqual(probeImage(png), { format: 'png', width: 48, height: 32, animated: false });
});

test('probeImage reads JPEG and the three WebP encodings', () => {
  assert.deepEqual(probeImage(fakeJpeg(640, 480)), { format: 'jpeg', width: 640, height: 480, animated: false });
  assert.deepEqual(probeImage(fakeWebpLossy(321, 123)), { format: 'webp', width: 321, height: 123, animated: false });
  assert.deepEqual(probeImage(fakeWebpLossless(1000, 2000)), { format: 'webp', width: 1000, height: 2000, animated: false });
  assert.deepEqual(probeImage(fakeWebpExtended(4096, 100)), { format: 'webp', width: 4096, height: 100, animated: false });
});

test('probeImage flags animated PNG and WebP', () => {
  assert.equal(probeImage(fakeAnimatedPng(64, 64))?.animated, true);
  assert.equal(probeImage(fakeWebpExtended(64, 64, true))?.animated, true);
});

test('probeImage rejects non-images, SVG, GIF and truncated headers', () => {
  assert.equal(probeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(probeImage(Buffer.from('GIF89a\x01\x00\x01\x00')), null);
  assert.equal(probeImage(Buffer.from('plain text pretending to be a png')), null);
  assert.equal(probeImage(Buffer.alloc(0)), null);
  assert.equal(probeImage(fakePng(10, 10).subarray(0, 20)), null);
  assert.equal(probeImage(Buffer.from([0xff, 0xd8, 0xff])), null);
});

// ── options ─────────────────────────────────────────────────────────────────

test('parseAiEnhanceOptions accepts upscale, background removal, or both', () => {
  assert.deepEqual(parseAiEnhanceOptions({ scale: '2' }), { scale: 2, removeBackground: false });
  assert.deepEqual(parseAiEnhanceOptions({ scale: '4', removeBackground: 'true' }), { scale: 4, removeBackground: true });
  assert.deepEqual(parseAiEnhanceOptions({ removeBackground: 'true' }), { scale: null, removeBackground: true });
  assert.deepEqual(parseAiEnhanceOptions({ scale: '1', removeBackground: 'true' }), { scale: null, removeBackground: true });
});

test('parseAiEnhanceOptions rejects an empty request and unknown values', () => {
  assert.throws(() => parseAiEnhanceOptions({}), assertApiError(400, /upscale, remove the background, or both/));
  assert.throws(() => parseAiEnhanceOptions(undefined), assertApiError(400, /upscale, remove the background/));
  assert.throws(() => parseAiEnhanceOptions({ scale: '1', removeBackground: 'false' }), assertApiError(400, /upscale/));
  assert.throws(() => parseAiEnhanceOptions({ scale: '3' }), assertApiError(400, /scale must be 2 or 4/));
  assert.throws(() => parseAiEnhanceOptions({ scale: '8', removeBackground: 'true' }), assertApiError(400, /scale/));
  assert.throws(() => parseAiEnhanceOptions({ scale: '2', removeBackground: 'yes' }), assertApiError(400, /removeBackground/));
});

// ── limits ──────────────────────────────────────────────────────────────────

test('Cloudinary: upscale input is capped at 2048 x 2048 pixels', () => {
  const upscale2: AiEnhanceOptions = { scale: 2, removeBackground: false };
  assert.doesNotThrow(() => validateAiEnhance(image(2048, 2048), upscale2, cloudinary));
  assert.doesNotThrow(() => validateAiEnhance(image(4000, 1000), upscale2, cloudinary));
  assert.throws(() => validateAiEnhance(image(2049, 2048), upscale2, cloudinary), assertApiError(400, /Cloudinary upscales images under 4\.2 megapixels/));
  assert.throws(() => validateAiEnhance(image(3000, 3000), { scale: 4, removeBackground: false }, cloudinary), assertApiError(400, /3,000 × 3,000 \(9\.0 megapixels\)/));
});

test('Cloudinary: background removal runs after upscale, so the upscaled size is what is capped', () => {
  // 1536 x 1536 at 4x is exactly 6144 per side.
  assert.doesNotThrow(() => validateAiEnhance(image(1536, 1536), { scale: 4, removeBackground: true }, cloudinary));
  assert.throws(
    () => validateAiEnhance(image(1600, 1000), { scale: 4, removeBackground: true }, cloudinary),
    assertApiError(400, /6,144 px per side\. At 4× this image would be 6,400 × 4,000/),
  );
  // The same image is fine at 2x, or without background removal.
  assert.doesNotThrow(() => validateAiEnhance(image(1600, 1000), { scale: 2, removeBackground: true }, cloudinary));
  assert.doesNotThrow(() => validateAiEnhance(image(1600, 1000), { scale: 4, removeBackground: false }, cloudinary));
});

test('Cloudinary: background removal alone accepts up to 6144 px and is not bound by the upscale cap', () => {
  const removeOnly: AiEnhanceOptions = { scale: null, removeBackground: true };
  assert.doesNotThrow(() => validateAiEnhance(image(6144, 6144, 9_000_000), removeOnly, cloudinary));
  assert.throws(() => validateAiEnhance(image(6145, 100), removeOnly, cloudinary), assertApiError(400, /6,144 px per side\. This image is 6,145 × 100/));
});

test('ImageKit: upscale input must be under 16 MP and output at most 16 MP', () => {
  assert.doesNotThrow(() => validateAiEnhance(image(2000, 2000), { scale: 2, removeBackground: true }, imagekit));
  assert.throws(() => validateAiEnhance(image(3000, 3000), { scale: 2, removeBackground: false }, imagekit), assertApiError(400, /ImageKit upscales to at most 16\.0 megapixels/));
  assert.throws(() => validateAiEnhance(image(4000, 4000), { scale: 2, removeBackground: false }, imagekit), assertApiError(400, /ImageKit upscales images under 16\.0 megapixels\. This one is 4,000 × 4,000 \(16\.0 megapixels\)/));
  assert.throws(() => validateAiEnhance(image(2000, 2000), { scale: 4, removeBackground: false }, imagekit), assertApiError(400, /At 4× this image would be 8,000 × 8,000/));
  // No documented background-removal cap on ImageKit.
  assert.doesNotThrow(() => validateAiEnhance(image(9000, 9000, 15_000_000), { scale: null, removeBackground: true }, imagekit));
});

test('validateAiEnhance rejects animated, oversized, tiny and huge images', () => {
  const options: AiEnhanceOptions = { scale: 2, removeBackground: false };
  assert.throws(() => validateAiEnhance(image(64, 64, 1000, true), options, cloudinary), assertApiError(400, /Animated/));
  assert.throws(() => validateAiEnhance(image(64, 64, 10 * 1024 * 1024 + 1), options, cloudinary), assertApiError(413, /limit is 10\.0 MB/));
  assert.throws(() => validateAiEnhance(image(15, 200), options, cloudinary), assertApiError(400, /at least 16 px/));
  assert.throws(() => validateAiEnhance(image(12_001, 100), { scale: null, removeBackground: true }, imagekit), assertApiError(400, /at most 12,000 px/));
  assert.throws(() => validateAiEnhance(image(64, 64), { scale: null, removeBackground: false }, cloudinary), assertApiError(400, /upscale, remove the background, or both/));
});

test('ImageKit allows bigger uploads than Cloudinary', () => {
  assert.equal(cloudinary.maxBytes, 10 * 1024 * 1024);
  assert.equal(imagekit.maxBytes, 20 * 1024 * 1024);
});

test('outputSize multiplies each side by the scale', () => {
  assert.deepEqual(outputSize({ width: 300, height: 200 }, 4), { width: 1200, height: 800 });
  assert.deepEqual(outputSize({ width: 300, height: 200 }, null), { width: 300, height: 200 });
});

// ── storage status ──────────────────────────────────────────────────────────

test('getStorageStatus reports missing Cloudinary credentials', () => {
  assert.deepEqual(getStorageStatus({}), {
    provider: 'cloudinary',
    configured: false,
    missing: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    supportsAi: true,
  });
  const partial = getStorageStatus({ CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: '  ', CLOUDINARY_API_SECRET: 's' });
  assert.equal(partial.configured, false);
  assert.deepEqual(partial.missing, ['CLOUDINARY_API_KEY']);
});

test('getStorageStatus checks ImageKit variables when STORAGE_PROVIDER=imagekit', () => {
  assert.deepEqual(getStorageStatus({ STORAGE_PROVIDER: 'imagekit' }).missing, ['IMAGEKIT_PRIVATE_KEY', 'IMAGEKIT_URL_ENDPOINT']);
  const ok = getStorageStatus({ STORAGE_PROVIDER: 'imagekit', IMAGEKIT_PRIVATE_KEY: 'k', IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/demo' });
  assert.deepEqual(ok, { provider: 'imagekit', configured: true, missing: [], supportsAi: true });
  assert.equal(getStorageStatus({ CLOUDINARY_CLOUD_NAME: 'a', CLOUDINARY_API_KEY: 'b', CLOUDINARY_API_SECRET: 'c' }).configured, true);
});

test('local storage is configured without keys but has no AI transforms', () => {
  assert.deepEqual(getStorageStatus({ STORAGE_PROVIDER: 'local' }), { provider: 'local', configured: true, missing: [], supportsAi: false });
});

test('submitAiEnhance fails with STORAGE_UNSUPPORTED on local storage and never touches storage', async () => {
  const { deps, storage, queued } = makeDeps({
    getStorageStatus: () => ({ provider: 'local', configured: true, missing: [], supportsAi: false }),
  });
  await assert.rejects(submitAiEnhance(deps, submitInput(64, 64, { scale: 2, removeBackground: false })), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, STORAGE_UNSUPPORTED);
    assert.match(error.message, /isn't supported by Local storage/);
    assert.match(error.message, /Cloudinary or ImageKit/);
    return true;
  });
  assert.equal(storage.uploads.length, 0);
  assert.equal(queued.length, 0);
});

test('a provider that reports an unsupported transform becomes STORAGE_UNSUPPORTED, not a generic failure', () => {
  const error = new StorageTransformUnsupportedError('AI enhance is not supported by local storage.');
  assert.deepEqual(describeProviderFailure(error), { message: 'AI enhance is not supported by local storage.', code: STORAGE_UNSUPPORTED });
});

// ── submit and worker, with a mocked storage adapter ─────────────────────────

function makeDeps(overrides: Partial<AiEnhanceDeps> = {}) {
  const storage = new MockStorage();
  const store = new MemoryStore();
  const queued: string[] = [];
  const deps: AiEnhanceDeps = {
    storage,
    store,
    async enqueue(jobId) {
      queued.push(jobId);
    },
    getStorageStatus: () => ({ provider: 'cloudinary', configured: true, missing: [], supportsAi: true }),
    ...overrides,
  };
  return { deps, storage, store, queued };
}

function submitInput(width: number, height: number, options: AiEnhanceOptions, userId = 'user-1') {
  const buffer = fakePng(width, height);
  const probe = probeImage(buffer);
  assert.ok(probe);
  return { userId, buffer, probe, options };
}

test('submitAiEnhance stores the source in the enhance folder and queues the job', async () => {
  const { deps, storage, store, queued } = makeDeps();
  const record = await submitAiEnhance(deps, submitInput(800, 600, { scale: 4, removeBackground: true }));

  assert.equal(storage.uploads.length, 1);
  assert.equal(storage.uploads[0]?.options.folder, 'enhance');
  assert.equal(storage.uploads[0]?.options.publicId, record.id);
  assert.deepEqual(queued, [record.id]);
  assert.equal(record.status, 'queued');
  assert.equal(record.userId, 'user-1');
  assert.deepEqual(store.jobs.get(record.id)?.options, { scale: 4, removeBackground: true });
  assert.deepEqual(toJobResponse(record).recipe, {
    tool: 'ai',
    provider: 'cloudinary',
    operations: [{ op: 'upscale', scale: 4 }, { op: 'background_removal' }],
    source: { width: 800, height: 600 },
    output: { width: 3200, height: 2400 },
  });
});

test('submitAiEnhance validates before anything is uploaded', async () => {
  const { deps, storage, queued } = makeDeps();
  await assert.rejects(submitAiEnhance(deps, submitInput(3000, 3000, { scale: 2, removeBackground: false })), assertApiError(400, /4\.2 megapixels/));
  assert.equal(storage.uploads.length, 0);
  assert.equal(queued.length, 0);
});

test('submitAiEnhance fails with STORAGE_NOT_CONFIGURED and never touches storage', async () => {
  const { deps, storage } = makeDeps({
    getStorageStatus: () => ({ provider: 'cloudinary', configured: false, missing: ['CLOUDINARY_CLOUD_NAME'], supportsAi: true }),
  });
  await assert.rejects(submitAiEnhance(deps, submitInput(64, 64, { scale: 2, removeBackground: false })), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, STORAGE_NOT_CONFIGURED);
    assert.match(error.message, /Cloudinary/);
    return true;
  });
  assert.equal(storage.uploads.length, 0);
});

test('submitAiEnhance re-validates with the dimensions the provider reports and cleans up on a mismatch', async () => {
  const { deps, storage, queued } = makeDeps();
  // Header said 1000 x 1000, the provider decoded 3000 x 3000.
  storage.uploadResult = { width: 3000, height: 3000 };
  await assert.rejects(submitAiEnhance(deps, submitInput(1000, 1000, { scale: 2, removeBackground: false })), assertApiError(400, /9\.0 megapixels/));
  assert.equal(storage.deleted.length, 1);
  assert.equal(queued.length, 0);
});

test('submitAiEnhance removes the stored source when the job cannot be queued', async () => {
  const { deps, storage } = makeDeps({
    async enqueue() {
      throw new Error('redis down');
    },
  });
  await assert.rejects(submitAiEnhance(deps, submitInput(64, 64, { scale: 2, removeBackground: false })), /redis down/);
  assert.equal(storage.deleted.length, 1);
});

async function queuedJob(options: AiEnhanceOptions, size = { width: 800, height: 600 }) {
  const ctx = makeDeps();
  const record = await submitAiEnhance(ctx.deps, submitInput(size.width, size.height, options));
  return { ...ctx, record };
}

test('the worker applies upscale and background removal in one transform and stores the result URL', async () => {
  const { deps, storage, store, record } = await queuedJob({ scale: 2, removeBackground: true });
  await runAiEnhanceJob(deps, record.id);

  assert.equal(storage.enhanceCalls.length, 1);
  assert.deepEqual(storage.enhanceCalls[0], {
    publicId: record.sourcePublicId,
    transform: { upscale: { scale: 2, sourceWidth: 800 }, removeBackground: true },
  });
  const done = store.jobs.get(record.id);
  assert.equal(done?.status, 'ready');
  assert.equal(done?.resultUrl, 'https://res.example.test/enhanced.png');
  assert.equal(toJobResponse(done!).resultUrl, 'https://res.example.test/enhanced.png');
  assert.equal(storage.deleted.length, 0, 'the source must stay: the result is a derived URL of it');
});

test('the worker asks only for what was requested', async () => {
  const upscaleOnly = await queuedJob({ scale: 4, removeBackground: false });
  await runAiEnhanceJob(upscaleOnly.deps, upscaleOnly.record.id);
  assert.deepEqual(upscaleOnly.storage.enhanceCalls[0]?.transform, {
    upscale: { scale: 4, sourceWidth: 800 },
    removeBackground: false,
  });

  const removeOnly = await queuedJob({ scale: null, removeBackground: true });
  await runAiEnhanceJob(removeOnly.deps, removeOnly.record.id);
  assert.deepEqual(removeOnly.storage.enhanceCalls[0]?.transform, { upscale: undefined, removeBackground: true });
});

test('a provider failure becomes a failed job with a readable reason and the source is deleted', async () => {
  const { deps, storage, store, record } = await queuedJob({ scale: 2, removeBackground: false });
  storage.enhanceError = new Error('Cloudinary transform failed (HTTP 403). Ensure the AI add-on is enabled. URL: https://secret.example/x');
  const log = mock.method(console, 'error', () => undefined); // the worker logs the full error
  try {
    await runAiEnhanceJob(deps, record.id);
  } finally {
    log.mock.restore();
  }

  const failed = store.jobs.get(record.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.errorCode, 'PROVIDER_REJECTED');
  assert.match(failed?.error ?? '', /AI add-ons are enabled/);
  assert.doesNotMatch(failed?.error ?? '', /secret\.example/, 'provider URLs must not reach the user');
  assert.deepEqual(storage.deleted, [record.sourcePublicId]);
  assert.equal(toJobResponse(failed!).resultUrl, undefined);
});

test('the worker is idempotent for finished jobs and ignores unknown ones', async () => {
  const { deps, storage, record } = await queuedJob({ scale: 2, removeBackground: false });
  await runAiEnhanceJob(deps, record.id);
  await runAiEnhanceJob(deps, record.id);
  await runAiEnhanceJob(deps, 'missing');
  assert.equal(storage.enhanceCalls.length, 1);
});

test('describeProviderFailure maps timeouts, rejections and unknown errors', () => {
  assert.equal(describeProviderFailure(new Error('Cloudinary transform timed out after 120s (HTTP 423).')).code, 'PROVIDER_TIMEOUT');
  assert.equal(describeProviderFailure(new Error('ImageKit transform failed (HTTP 404)')).code, 'PROVIDER_REJECTED');
  assert.equal(describeProviderFailure(new Error('ImageKit transform failed (HTTP 500)')).code, 'PROVIDER_FAILED');
  assert.equal(describeProviderFailure('boom').code, 'ENHANCE_FAILED');
});

test('buildRecipe orders upscale before background removal', async () => {
  const { record } = await queuedJob({ scale: 4, removeBackground: true });
  assert.deepEqual(buildRecipe(record).operations.map((operation) => operation.op), ['upscale', 'background_removal']);
});

// ── adapters: transform order and size ───────────────────────────────────────

function stubReady() {
  return mock.method(axios, 'get', async () => ({ status: 200, data: new ArrayBuffer(0) }));
}

test('Cloudinary adapter chains upscale, then resize for 2x, then background removal, as PNG', async () => {
  process.env['CLOUDINARY_CLOUD_NAME'] = 'demo';
  process.env['CLOUDINARY_API_KEY'] = 'key';
  process.env['CLOUDINARY_API_SECRET'] = 'secret';
  const get = stubReady();
  try {
    const adapter = new CloudinaryAdapter();

    const both2x = await adapter.applyEnhance('open_assets/enhance/abc', {
      upscale: { scale: 2, sourceWidth: 500 },
      removeBackground: true,
    });
    assert.match(both2x, /\/e_upscale\/c_scale,w_1000\/e_background_removal\/f_png\//);

    const upscale4x = await adapter.applyEnhance('open_assets/enhance/abc', {
      upscale: { scale: 4, sourceWidth: 500 },
    });
    assert.match(upscale4x, /\/e_upscale\/f_png\//);
    assert.doesNotMatch(upscale4x, /background_removal|c_scale/);

    const removeOnly = await adapter.applyEnhance('open_assets/enhance/abc', { removeBackground: true });
    assert.match(removeOnly, /\/e_background_removal\/f_png\//);
    assert.doesNotMatch(removeOnly, /e_upscale/);

    await assert.rejects(adapter.applyEnhance('open_assets/enhance/abc', {}), /upscale, a background removal, or both/);
    assert.equal(get.mock.callCount(), 3, 'each result URL is polled until the provider returns 200');
  } finally {
    get.mock.restore();
  }
});

test('ImageKit adapter chains upscale, an exact resize, then background removal, as PNG', async () => {
  process.env['IMAGEKIT_URL_ENDPOINT'] = 'https://ik.imagekit.io/demo';
  process.env['IMAGEKIT_PRIVATE_KEY'] = 'private_test';
  const get = stubReady();
  try {
    const adapter = new ImageKitAdapter();
    const publicId = 'file123::/open_assets/enhance/abc';

    const both4x = await adapter.applyEnhance(publicId, {
      upscale: { scale: 4, sourceWidth: 250 },
      removeBackground: true,
    });
    assert.match(both4x, /\/open_assets\/enhance\/abc\?tr=e-upscale:w-1000:e-bgremove:f-png$/);

    const upscale2x = await adapter.applyEnhance(publicId, { upscale: { scale: 2, sourceWidth: 250 } });
    assert.match(upscale2x, /\?tr=e-upscale:w-500:f-png$/);

    const removeOnly = await adapter.applyEnhance(publicId, { removeBackground: true });
    assert.match(removeOnly, /\?tr=e-bgremove:f-png$/);
  } finally {
    get.mock.restore();
  }
});

test('a provider that never returns 200 surfaces as an error instead of a result URL', async () => {
  process.env['CLOUDINARY_CLOUD_NAME'] = 'demo';
  const get = mock.method(axios, 'get', async () => ({ status: 403, data: new ArrayBuffer(0) }));
  try {
    const adapter = new CloudinaryAdapter();
    await assert.rejects(adapter.applyEnhance('open_assets/enhance/abc', { removeBackground: true }), /HTTP 403/);
  } finally {
    get.mock.restore();
  }
});
