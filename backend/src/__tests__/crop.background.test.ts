import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { describeBackground, removeSheetBackground } from '../modules/workers/cropBackground';
import type { BackgroundDeps, BackgroundInput } from '../modules/workers/cropBackground';
import type { BackgroundMethod, BackgroundRemovalMode, JobBackground } from '../lib/background';

/*
 * How the crop worker picks a background method: a mocked storage adapter records every call, so each test
 * can assert that the paid AI method is NOT called for flat and chroma-key sheets and IS called for complex
 * ones, and measures the alpha of the PNG that was uploaded for the crops to be cut from.
 */

const SIZE = 160;
const AI_URL = 'https://cdn.test/ai/sheet.png';
const ORIGINAL_URL = 'https://cdn.test/originals/job-1.png';

async function sheetFromSvg(body: string): Promise<Buffer> {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${body}</svg>`))
    .png()
    .toBuffer();
}

/** A round dark logo with a ring-shaped hole in it (like a letter O), centred on the sheet. */
const LOGO = '<circle cx="80" cy="80" r="40" fill="none" stroke="#1a1a1a" stroke-width="20"/>';

const flat = (fill: string) => sheetFromSvg(`<rect width="${SIZE}" height="${SIZE}" fill="${fill}"/>${LOGO}`);
const whiteSheet = () => flat('#ffffff');
const offWhiteSheet = () => flat('#f6f5f0');
const greenSheet = () => flat('#00ff00');
const magentaSheet = () => flat('#ff00ff');
const gradientSheet = () =>
  sheetFromSvg(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#202020"/><stop offset="1" stop-color="#f0f0f0"/></linearGradient></defs><rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>${LOGO}`,
  );
const transparentSheet = () => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${LOGO}</svg>`)).png().toBuffer();

interface Recorder {
  uploads: { size: number; folder: string; publicId: string; buffer: Buffer }[];
  aiCalls: string[];
  downloads: number;
  deps: BackgroundDeps;
}

function recorder(sheet: Buffer, opts: { supportsAi: boolean; aiFails?: boolean }): Recorder {
  const rec: Recorder = {
    uploads: [],
    aiCalls: [],
    downloads: 0,
    deps: {
      supportsAi: opts.supportsAi,
      fetchOriginal: async () => {
        rec.downloads++;
        return sheet;
      },
      storage: {
        async upload(buffer, options) {
          rec.uploads.push({ size: buffer.length, folder: options.folder, publicId: options.publicId, buffer });
          return { url: `https://cdn.test/${options.folder}/${options.publicId}.png`, publicId: `${options.folder}/${options.publicId}` };
        },
        async applyBackgroundRemoval(publicId) {
          rec.aiCalls.push(publicId);
          if (opts.aiFails) throw new Error('Cloudinary transform failed (HTTP 400)');
          return AI_URL;
        },
      },
    },
  };
  return rec;
}

function input(extra: Partial<BackgroundInput> = {}): BackgroundInput {
  return { jobId: 'job-1', publicId: 'open_assets/originals/job-1', originalUrl: ORIGINAL_URL, ...extra };
}

async function alpha(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[(y * info.width + x) * 4 + 3] as number;
  return {
    at,
    corners: [at(0, 0), at(info.width - 1, 0), at(0, info.height - 1), at(info.width - 1, info.height - 1)],
    stroke: at(80, 80 - 40), // on the ring
    hole: at(80, 80), // inside the ring: reachable only through the art
  };
}

const FLAT: JobBackground = { kind: 'flat', color: '#ffffff' };
const CHROMA: JobBackground = { kind: 'chroma', color: '#00ff00' };
const COMPLEX: JobBackground = { kind: 'complex' };

/* ---------------- flat and chroma: our keyer, no AI, any provider ---------------- */

for (const provider of [
  { name: 'Cloudinary/ImageKit (AI available)', supportsAi: true },
  { name: 'local (no AI)', supportsAi: false },
]) {
  test(`auto on a white sheet, ${provider.name}: keyed on our server, the AI method is never called, corners 0 and art opaque`, async () => {
    const rec = recorder(await whiteSheet(), provider);
    const out = await removeSheetBackground(input({ background: FLAT }), rec.deps);

    assert.equal(out.method, 'server');
    assert.equal(out.reason, undefined);
    assert.deepEqual(rec.aiCalls, [], 'no AI call');
    assert.equal(rec.uploads.length, 1);
    assert.equal(rec.uploads[0]?.folder, 'originals');
    assert.equal(rec.uploads[0]?.publicId, 'job-1_nobg');
    assert.equal(out.workingUrl, 'https://cdn.test/originals/job-1_nobg.png', 'the crops are cut from the keyed upload');
    assert.equal(out.workingPublicId, 'originals/job-1_nobg');

    const a = await alpha((rec.uploads[0] as { buffer: Buffer }).buffer);
    assert.deepEqual(a.corners, [0, 0, 0, 0]);
    assert.equal(a.stroke, 255, 'the art is opaque');
    assert.equal(a.hole, 255, 'the enclosed hole stays with the switch off (the default)');
  });

  test(`auto on a green chroma sheet, ${provider.name}: keyed everywhere including the enclosed hole, no AI`, async () => {
    const rec = recorder(await greenSheet(), provider);
    const out = await removeSheetBackground(input({ background: CHROMA }), rec.deps);
    assert.equal(out.method, 'server');
    assert.deepEqual(rec.aiCalls, []);
    const a = await alpha((rec.uploads[0] as { buffer: Buffer }).buffer);
    assert.deepEqual(a.corners, [0, 0, 0, 0]);
    assert.equal(a.stroke, 255);
    assert.equal(a.hole, 0, 'chroma colour is not art, so the hole goes too');
  });
}

test('auto on a magenta chroma sheet: keyed on our server, no AI', async () => {
  const rec = recorder(await magentaSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input({ background: { kind: 'chroma', color: '#ff00ff' } }), rec.deps);
  assert.equal(out.method, 'server');
  assert.deepEqual(rec.aiCalls, []);
  assert.deepEqual((await alpha((rec.uploads[0] as { buffer: Buffer }).buffer)).corners, [0, 0, 0, 0]);
});

test('removeEnclosedBackground applies whenever the server keyer runs, on a provider with AI too', async () => {
  const rec = recorder(await whiteSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input({ background: FLAT, removeEnclosed: true }), rec.deps);
  assert.equal(out.method, 'server');
  assert.deepEqual(rec.aiCalls, []);
  const a = await alpha((rec.uploads[0] as { buffer: Buffer }).buffer);
  assert.deepEqual(a.corners, [0, 0, 0, 0]);
  assert.equal(a.stroke, 255);
  assert.equal(a.hole, 0, 'the enclosed hole is transparent with the switch on');
});

test('a mode of flat on a white sheet is the same free keying', async () => {
  const rec = recorder(await offWhiteSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input({ mode: 'flat', background: { kind: 'flat', color: '#f6f5f0' } }), rec.deps);
  assert.equal(out.method, 'server');
  assert.deepEqual(rec.aiCalls, []);
  assert.deepEqual((await alpha((rec.uploads[0] as { buffer: Buffer }).buffer)).corners, [0, 0, 0, 0]);
});

/* ---------------- complex: the provider's AI, in auto and ai ---------------- */

for (const mode of [undefined, 'auto', 'ai'] as (BackgroundRemovalMode | undefined)[]) {
  test(`mode ${mode ?? '(absent)'} on a gradient sheet with AI available: the AI method is called once, nothing is keyed or uploaded`, async () => {
    const rec = recorder(await gradientSheet(), { supportsAi: true });
    const out = await removeSheetBackground(input({ mode, background: COMPLEX }), rec.deps);
    assert.equal(out.method, 'ai');
    assert.equal(out.workingUrl, AI_URL);
    assert.deepEqual(rec.aiCalls, ['open_assets/originals/job-1']);
    assert.deepEqual(rec.uploads, []);
    assert.equal(rec.downloads, 0, 'the sheet is not even downloaded when the job already says it is complex');
  });
}

test('ai mode on a flat white sheet is honoured: the user asked for AI, so the AI method runs', async () => {
  const rec = recorder(await whiteSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input({ mode: 'ai', background: FLAT }), rec.deps);
  assert.equal(out.method, 'ai');
  assert.equal(rec.aiCalls.length, 1);
});

test('an AI failure fails the job (it is a real error, not a fallback)', async () => {
  const rec = recorder(await gradientSheet(), { supportsAi: true, aiFails: true });
  await assert.rejects(removeSheetBackground(input({ background: COMPLEX }), rec.deps), /Cloudinary transform failed/);
});

/* ---------------- fallbacks: keep the background, say why, never fail ---------------- */

test('auto on a gradient with no AI (local storage): the background is kept and the reason says AI is unavailable', async () => {
  const rec = recorder(await gradientSheet(), { supportsAi: false });
  const out = await removeSheetBackground(input({ background: COMPLEX }), rec.deps);
  assert.equal(out.method, 'none');
  assert.equal(out.workingUrl, ORIGINAL_URL, 'the crops are cut from the original sheet');
  assert.match(out.reason ?? '', /gradient or texture/);
  assert.match(out.reason ?? '', /AI removal is not available on this server/);
  assert.deepEqual(rec.aiCalls, []);
  assert.deepEqual(rec.uploads, []);
});

test('ai mode with no AI: the background is kept with a readable reason', async () => {
  const rec = recorder(await whiteSheet(), { supportsAi: false });
  const out = await removeSheetBackground(input({ mode: 'ai', background: FLAT }), rec.deps);
  assert.equal(out.method, 'none');
  assert.match(out.reason ?? '', /AI background removal is not available on this server/);
  assert.deepEqual(rec.aiCalls, []);
});

test('flat mode on a complex sheet: the keyer refuses, the background is kept, the AI method is NOT called', async () => {
  const rec = recorder(await gradientSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input({ mode: 'flat', background: COMPLEX }), rec.deps);
  assert.equal(out.method, 'none');
  assert.equal(out.workingUrl, ORIGINAL_URL);
  assert.match(out.reason ?? '', /one plain background colour/);
  assert.match(out.reason ?? '', /AI removal can handle it/, 'with AI available the reason says so');
  assert.deepEqual(rec.aiCalls, [], 'flat never spends AI credits');
  assert.deepEqual(rec.uploads, []);

  const local = recorder(await gradientSheet(), { supportsAi: false });
  const kept = await removeSheetBackground(input({ mode: 'flat', background: COMPLEX }), local.deps);
  assert.equal(kept.method, 'none');
  assert.doesNotMatch(kept.reason ?? '', /AI removal can handle it/);
});

test('flat mode when the job says flat but the sheet really is a gradient: the keyer refuses and the background is kept', async () => {
  // A stale or wrong classification must not fail the job or spend credits.
  const rec = recorder(await gradientSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input({ mode: 'flat', background: FLAT }), rec.deps);
  assert.equal(out.method, 'none');
  assert.match(out.reason ?? '', /flat, single-colour background/);
  assert.match(out.reason ?? '', /background was kept/);
  assert.deepEqual(rec.aiCalls, []);
});

test('none keeps the background without downloading or calling anything', async () => {
  const rec = recorder(await whiteSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input({ mode: 'none', background: FLAT }), rec.deps);
  assert.equal(out.method, 'none');
  assert.equal(out.workingUrl, ORIGINAL_URL);
  assert.match(out.reason ?? '', /kept/);
  assert.deepEqual(rec.aiCalls, []);
  assert.deepEqual(rec.uploads, []);
  assert.equal(rec.downloads, 0);
});

test('a transparent sheet needs nothing, in every mode', async () => {
  for (const mode of [undefined, 'auto', 'flat', 'ai', 'none'] as (BackgroundRemovalMode | undefined)[]) {
    const rec = recorder(await transparentSheet(), { supportsAi: true });
    const out = await removeSheetBackground(input({ mode, background: { kind: 'transparent' } }), rec.deps);
    assert.equal(out.method, 'none', String(mode));
    assert.equal(out.workingUrl, ORIGINAL_URL);
    assert.deepEqual(rec.aiCalls, [], String(mode));
    assert.deepEqual(rec.uploads, [], String(mode));
  }
  assert.match((await removeSheetBackground(input({ background: { kind: 'transparent' } }), recorder(await transparentSheet(), { supportsAi: true }).deps)).reason ?? '', /already transparent/);
});

/* ---------------- jobs queued before the classification existed ---------------- */

test('a job with no stored classification and no mode (queued by an older server) is classified from its sheet: white is keyed, no AI', async () => {
  const rec = recorder(await whiteSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input(), rec.deps);
  assert.equal(out.method, 'server');
  assert.deepEqual(out.background, { kind: 'flat', color: '#ffffff' }, 'the classification made here is returned so the worker can store it');
  assert.deepEqual(rec.aiCalls, []);
  assert.equal(rec.downloads, 1);
});

test('the same legacy job on a gradient goes to AI, and on local storage keeps the background', async () => {
  const withAi = recorder(await gradientSheet(), { supportsAi: true });
  assert.equal((await removeSheetBackground(input(), withAi.deps)).method, 'ai');
  assert.equal(withAi.aiCalls.length, 1);

  const local = recorder(await gradientSheet(), { supportsAi: false });
  const kept = await removeSheetBackground(input(), local.deps);
  assert.equal(kept.method, 'none');
  assert.deepEqual(kept.background, { kind: 'complex' });
});

test('a legacy job on a transparent sheet needs nothing', async () => {
  const rec = recorder(await transparentSheet(), { supportsAi: true });
  const out = await removeSheetBackground(input(), rec.deps);
  assert.equal(out.method, 'none');
  assert.deepEqual(out.background, { kind: 'transparent' });
});

/* ---------------- the owner's sheet: 5 x 6 round logos on off-white ---------------- */

test('a 5 x 6 grid of round logos on off-white is keyed for free: corners 0, every logo opaque, no AI', async () => {
  const cols = 6;
  const rows = 5;
  const cell = 90;
  const circles: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hue = (r * cols + c) * 12;
      circles.push(`<circle cx="${cell / 2 + c * cell}" cy="${cell / 2 + r * cell}" r="32" fill="hsl(${hue},70%,45%)"/>`);
    }
  }
  const sheet = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}"><rect width="100%" height="100%" fill="#f7f6f2"/>${circles.join('')}</svg>`,
    ),
  )
    .png()
    .toBuffer();
  const rec = recorder(sheet, { supportsAi: true });
  const out = await removeSheetBackground(input(), rec.deps);
  assert.equal(out.method, 'server');
  assert.deepEqual(out.background, { kind: 'flat', color: '#f7f6f2' });
  assert.deepEqual(rec.aiCalls, []);

  const { data, info } = await sharp((rec.uploads[0] as { buffer: Buffer }).buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3] as number;
  assert.deepEqual([alphaAt(0, 0), alphaAt(info.width - 1, 0), alphaAt(0, info.height - 1), alphaAt(info.width - 1, info.height - 1)], [0, 0, 0, 0]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) assert.equal(alphaAt(cell / 2 + c * cell, cell / 2 + r * cell), 255, `logo ${r},${c}`);
  }
  // The gaps between logos are background too.
  assert.equal(alphaAt(cell, cell), 0);
});

/* ---------------- the log line ---------------- */

test('the log line names the classification, mode, method and whether AI was called', async () => {
  const flatOut = await removeSheetBackground(input({ background: FLAT }), recorder(await whiteSheet(), { supportsAi: true }).deps);
  const line = describeBackground('job-1', input({ background: FLAT }), flatOut);
  assert.match(line, /^\[crop\.worker\] Job job-1: background flat #ffffff, mode auto -> method server \(AI call: no\)$/);

  const aiOut = await removeSheetBackground(input({ mode: 'ai', background: COMPLEX }), recorder(await gradientSheet(), { supportsAi: true }).deps);
  assert.match(describeBackground('job-2', input({ mode: 'ai', background: COMPLEX }), aiOut), /background complex, mode ai -> method ai \(AI call: yes\)$/);

  const keptOut = await removeSheetBackground(input({ mode: 'flat', background: COMPLEX, removeEnclosed: true }), recorder(await gradientSheet(), { supportsAi: false }).deps);
  const keptLine = describeBackground('job-3', input({ mode: 'flat', background: COMPLEX, removeEnclosed: true }), keptOut);
  assert.match(keptLine, /method none \(AI call: no\), enclosed pockets on: Flat colour removal needs one plain/);
});

test('the methods the outcome can name are exactly none, server and ai', async () => {
  const seen = new Set<BackgroundMethod>();
  for (const [sheet, bg, supportsAi, mode] of [
    [await whiteSheet(), FLAT, true, undefined],
    [await gradientSheet(), COMPLEX, true, undefined],
    [await gradientSheet(), COMPLEX, false, undefined],
  ] as const) {
    seen.add((await removeSheetBackground(input({ background: bg, mode }), recorder(sheet, { supportsAi }).deps)).method);
  }
  assert.deepEqual([...seen].sort(), ['ai', 'none', 'server']);
});
