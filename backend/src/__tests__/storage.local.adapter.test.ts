import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalStorageAdapter } from '../lib/storage/local.adapter';
import { keyOutFlatBackground, LocalTransformError, StorageTransformUnsupportedError } from '../lib/storage/local.transforms';

const BASE = 'http://oa-e2e.localhost:4110';
let dir: string;
let adapter: LocalStorageAdapter;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-local-'));
  adapter = new LocalStorageAdapter({ dir, baseUrl: BASE });
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A white sheet with a red 20x20 square at (10,10) and a white 6x6 hole inside it. */
async function whiteSheet(width = 64, height = 48): Promise<Buffer> {
  const hole = await sharp({ create: { width: 6, height: 6, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const square = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff0000' } })
    .composite([{ input: hole, left: 7, top: 7 }])
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([{ input: square, left: 10, top: 10 }])
    .png()
    .toBuffer();
}

async function transparentSheet(): Promise<Buffer> {
  const square = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00ff00' } }).png().toBuffer();
  return sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: square, left: 10, top: 10 }])
    .png()
    .toBuffer();
}

async function pixels(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const alphaAt = (img: { data: Buffer; width: number }, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

test('upload stores the file under its folder and reports what the decoder found', async () => {
  const png = await whiteSheet();
  const result = await adapter.upload(png, { folder: 'originals', publicId: 'job-1', resourceType: 'image' });
  assert.equal(result.publicId, 'originals/job-1.png');
  assert.equal(result.url, `${BASE}/storage/originals/job-1.png`);
  assert.equal(result.format, 'png');
  assert.equal(result.width, 64);
  assert.equal(result.height, 48);
  assert.equal(result.bytes, png.length);
  assert.deepEqual(await fs.readFile(path.join(dir, 'originals', 'job-1.png')), png);
});

test('upload keeps jpeg as .jpg and keeps nested public ids as folders', async () => {
  const jpeg = await sharp({ create: { width: 70, height: 70, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  const result = await adapter.upload(jpeg, { folder: 'crops', publicId: 'job-2/asset_001' });
  assert.equal(result.publicId, 'crops/job-2/asset_001.jpg');
  assert.equal(result.format, 'jpeg');
});

test('upload cannot be steered out of the storage directory by its public id', async () => {
  const png = await whiteSheet();
  const result = await adapter.upload(png, { folder: 'crops', publicId: '../../../escape/../..//etc/evil' });
  assert.ok(result.publicId.startsWith('crops/'));
  assert.ok(!result.publicId.includes('..'));
  const onDisk = path.join(dir, result.publicId);
  assert.ok((await fs.stat(onDisk)).isFile());
  // Nothing was written next to the storage directory.
  assert.deepEqual((await fs.readdir(path.dirname(dir))).filter((name) => name === 'escape' || name === 'etc'), []);
});

test('different names that sanitise alike do not overwrite each other', async () => {
  const png = await whiteSheet();
  const a = await adapter.upload(png, { folder: 'crops', publicId: 'job-3/fire sword' });
  const b = await adapter.upload(png, { folder: 'crops', publicId: 'job-3/fire?sword' });
  assert.notEqual(a.publicId, b.publicId);
});

test('a raw zip is kept as .zip; anything else is a download-only .bin', async () => {
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30)]);
  const zipped = await adapter.upload(zip, { folder: 'exports', publicId: 'export_1', resourceType: 'raw' });
  assert.equal(zipped.publicId, 'exports/export_1.zip');
  assert.equal(zipped.format, 'zip');

  const notImage = await adapter.upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), {
    folder: 'originals',
    publicId: 'not-an-image',
  });
  assert.match(notImage.publicId, /\.bin$/);
  assert.notEqual(notImage.format, 'png');
});

test('delete removes the file, its derived copies and an emptied job folder, and ignores unknown ids', async () => {
  const png = await whiteSheet();
  const stored = await adapter.upload(png, { folder: 'crops', publicId: 'job-4/asset_001' });
  await adapter.applyUpscale(stored.publicId, 2);
  assert.ok((await fs.readdir(path.join(dir, 'crops', 'job-4'))).includes('asset_001.png.d'));

  await adapter.delete(stored.publicId);
  await assert.rejects(fs.stat(path.join(dir, 'crops', 'job-4')));
  // The top-level folder stays, so a concurrent upload never loses it.
  assert.ok((await fs.stat(path.join(dir, 'crops'))).isDirectory());

  await adapter.delete('open_assets/crops/some-cloudinary-id');
  await adapter.delete('../../etc/passwd');
  await adapter.delete('');
});

test('delete never removes a directory', async () => {
  const png = await whiteSheet();
  await adapter.upload(png, { folder: 'crops', publicId: 'job-5/asset_001' });
  await adapter.delete('crops/job-5');
  await adapter.delete('crops');
  assert.ok((await fs.stat(path.join(dir, 'crops', 'job-5', 'asset_001.png'))).isFile());
});

test('overwriting a file drops its stale derived copies', async () => {
  const first = await adapter.upload(await whiteSheet(), { folder: 'originals', publicId: 'job-6' });
  await adapter.applyUpscale(first.publicId, 2);
  await adapter.upload(await whiteSheet(32, 32), { folder: 'originals', publicId: 'job-6' });
  await assert.rejects(fs.stat(path.join(dir, 'originals', 'job-6.png.d')));
});

test('applyUpscale resizes to scale x the source width and keeps the alpha channel', async () => {
  const stored = await adapter.upload(await transparentSheet(), { folder: 'crops', publicId: 'job-7/asset_001' });
  const url = await adapter.applyUpscale(stored.publicId, 2, 64);
  assert.match(url, /^http:\/\/oa-e2e\.localhost:4110\/storage\/crops\/job-7\/asset_001\.png\.d\//);
  const key = decodeURIComponent(url.slice(`${BASE}/storage/`.length));
  const out = await sharp(await fs.readFile(path.join(dir, key))).metadata();
  assert.equal(out.width, 128);
  assert.equal(out.height, 96);
  assert.equal(out.hasAlpha, true);
  const img = await pixels(await fs.readFile(path.join(dir, key)));
  assert.equal(alphaAt(img, 0, 0), 0);
  assert.equal(alphaAt(img, 40, 40), 255);

  // Asking again reuses the derived file.
  assert.equal(await adapter.applyUpscale(stored.publicId, 2, 64), url);

  const four = await adapter.applyUpscale(stored.publicId, 4);
  const fourKey = decodeURIComponent(four.slice(`${BASE}/storage/`.length));
  assert.equal((await sharp(await fs.readFile(path.join(dir, fourKey))).metadata()).width, 256);
});

test('applyUpscale of a missing file fails with a 404-style message', async () => {
  await assert.rejects(adapter.applyUpscale('crops/nope/asset.png', 2), /HTTP 404/);
});

test('flat background: border-connected white goes transparent, the artwork and its enclosed hole stay', async () => {
  const stored = await adapter.upload(await whiteSheet(), { folder: 'originals', publicId: 'job-8' });
  const url = await adapter.applyBackgroundRemoval(stored.publicId);
  assert.notEqual(url, stored.url);
  const key = decodeURIComponent(url.slice(`${BASE}/storage/`.length));
  const img = await pixels(await fs.readFile(path.join(dir, key)));
  assert.equal(alphaAt(img, 0, 0), 0, 'corner is background');
  assert.equal(alphaAt(img, 63, 47), 0, 'far corner is background');
  assert.equal(alphaAt(img, 5, 5), 0, 'gap beside the sprite is background');
  assert.equal(alphaAt(img, 12, 12), 255, 'sprite stays');
  assert.equal(alphaAt(img, 20, 20), 255, 'white hole enclosed by the sprite stays');
});

test('an already transparent image is returned as it is', async () => {
  const stored = await adapter.upload(await transparentSheet(), { folder: 'originals', publicId: 'job-9' });
  assert.equal(await adapter.applyBackgroundRemoval(stored.publicId), stored.url);
  await assert.rejects(fs.stat(path.join(dir, 'originals', 'job-9.png.d')));
});

test('a background that is not flat is refused with a message that says what to do', async () => {
  const gradient = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#ffffff' },
  })
    .composite([
      {
        input: await sharp(Buffer.from(Array.from({ length: 64 * 48 * 3 }, (_, i) => Math.floor(i / 3 / 64) * 5)), {
          raw: { width: 64, height: 48, channels: 3 },
        })
          .png()
          .toBuffer(),
      },
    ])
    .png()
    .toBuffer();
  const stored = await adapter.upload(gradient, { folder: 'originals', publicId: 'job-10' });
  await assert.rejects(adapter.applyBackgroundRemoval(stored.publicId), (error: unknown) => {
    assert.ok(error instanceof LocalTransformError);
    assert.equal(error.code, 'BACKGROUND_NOT_FLAT');
    assert.match(error.message, /flat, single-colour background/);
    assert.match(error.message, /Cloudinary or ImageKit/);
    return true;
  });
});

test('keyOutFlatBackground fades the anti-aliased edge instead of leaving a halo', async () => {
  // A black disc on white, blurred a little so its edge is anti-aliased.
  const disc = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#fff"/><circle cx="40" cy="40" r="24" fill="#000"/></svg>`,
  );
  const sheet = await sharp(disc).blur(0.8).png().toBuffer();
  const result = await keyOutFlatBackground(sheet);
  assert.equal(result.kind, 'keyed');
  if (result.kind !== 'keyed') return;
  const img = await pixels(result.png);
  assert.equal(alphaAt(img, 2, 2), 0);
  assert.equal(alphaAt(img, 40, 40), 255);
  const partial = Array.from({ length: 80 }, (_, x) => alphaAt(img, x, 40) as number).filter((a) => a > 0 && a < 255);
  assert.ok(partial.length > 0, 'some edge pixels are partly transparent');
});

/** A uniform pseudo-random 0..1 from a seed, so the noisy sheets are the same on every run. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * A magenta sheet whose colour wobbles a little everywhere (as a generated image's does), with a
 * few outliers just past the tolerance, and a blurred disc as the sprite.
 */
async function noisyMagentaSheet(): Promise<Buffer> {
  const size = 160;
  const rand = rng(7);
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 3;
      const outlier = rand() < 0.002;
      raw[o] = Math.round(244 + rand() * 8 - (outlier ? 30 : 0)); // R 236..252, outliers ~ 25 below
      raw[o + 1] = Math.round(4 + rand() * 8 + (outlier ? 24 : 0)); // G 4..12, outliers up to ~36
      raw[o + 2] = Math.round(240 + rand() * 11); // B 240..251
    }
  }
  const noisy = await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  const disc = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="80" cy="80" r="40" fill="#1a8f3c"/></svg>`,
  );
  const sprite = await sharp(disc).blur(0.8).png().toBuffer();
  return sharp(noisy).composite([{ input: sprite }]).png().toBuffer();
}

test('uneven background colour leaves no specks, no halo, and the sprite keeps its full alpha', async () => {
  const result = await keyOutFlatBackground(await noisyMagentaSheet());
  assert.equal(result.kind, 'keyed');
  if (result.kind !== 'keyed') return;
  const img = await pixels(result.png);
  assert.equal(alphaAt(img, 80, 80), 255, 'sprite centre is opaque');
  assert.equal(alphaAt(img, 60, 80), 255, 'sprite body is opaque');
  // Everything farther than 6 px from the sprite edge (radius 40 around 80,80) is background.
  let stray = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const distance = Math.hypot(x - 80, y - 80);
      if (distance > 47 && (alphaAt(img, x, y) as number) > 0) stray++;
    }
  }
  assert.equal(stray, 0, 'no semi-visible specks in the background');
  // The anti-aliased rim is still there and partly transparent, not eaten.
  const rim = Array.from({ length: img.width }, (_, x) => alphaAt(img, x, 80) as number).filter((a) => a > 0 && a < 255);
  assert.ok(rim.length > 0);
  assert.equal(alphaAt(img, 41, 80) as number > 0, true, 'left rim of the sprite stays visible');
});

test('a tiny dark detail attached to the sprite is kept; only detached background noise goes', async () => {
  // A white sheet with a black bar and a 2x2 grey dot touching it.
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#fff"/><rect x="10" y="20" width="30" height="8" fill="#000"/><rect x="40" y="22" width="2" height="2" fill="#777"/></svg>`,
  );
  const result = await keyOutFlatBackground(await sharp(svg).png().toBuffer());
  assert.equal(result.kind, 'keyed');
  if (result.kind !== 'keyed') return;
  const img = await pixels(result.png);
  assert.equal(alphaAt(img, 41, 23), 255, 'the attached dot is part of the sprite');
});

/** A flat colour with a little per-pixel noise, as generated sheets have (not one exact value). */
function noisyBackground(width: number, height: number, base: [number, number, number], jitter: number): Buffer {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const wobble = ((i * 7919 + c * 104729) % (2 * jitter + 1)) - jitter;
      data[i * 3 + c] = Math.max(0, Math.min(255, (base[c] as number) + wobble));
    }
  }
  return data;
}

async function noisySheet(base: [number, number, number], jitter: number, art: string): Promise<Buffer> {
  const bg = await sharp(noisyBackground(96, 96, base, jitter), { raw: { width: 96, height: 96, channels: 3 } }).png().toBuffer();
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">${art}</svg>`);
  return sharp(bg).composite([{ input: svg }]).png().toBuffer();
}

test('a near-white, slightly uneven background (253 to 255) is keyed out', async () => {
  const sheet = await noisySheet([254, 254, 254], 1, '<rect x="30" y="30" width="36" height="36" fill="#b00020"/>');
  const result = await keyOutFlatBackground(sheet);
  assert.equal(result.kind, 'keyed');
  if (result.kind !== 'keyed') return;
  const img = await pixels(result.png);
  for (const [x, y] of [[0, 0], [95, 0], [0, 95], [95, 95], [10, 50]] as const) assert.equal(alphaAt(img, x, y), 0);
  assert.equal(alphaAt(img, 48, 48), 255);
});

test('a magenta key colour with uneven edges is removed everywhere, including pockets the border cannot reach', async () => {
  // Magenta with +-14 noise per channel (like B 234 to 251, G 3 to 37). A black ring encloses a magenta pocket.
  const art = '<circle cx="48" cy="48" r="26" fill="none" stroke="#000" stroke-width="8"/>';
  const sheet = await noisySheet([243, 20, 242], 14, art);
  const result = await keyOutFlatBackground(sheet);
  assert.equal(result.kind, 'keyed');
  if (result.kind !== 'keyed') return;
  const img = await pixels(result.png);
  assert.equal(alphaAt(img, 2, 2), 0);
  assert.equal(alphaAt(img, 48, 48), 0, 'the pocket inside the ring is background too');
  assert.equal(alphaAt(img, 48, 48 - 26), 255, 'the ring itself stays');
});

test('a keyed edge pixel loses the background tint along with its coverage', async () => {
  const art = '<circle cx="48" cy="48" r="22" fill="#00aa00"/>';
  const sheet = await noisySheet([243, 20, 242], 3, art);
  const blurred = await sharp(sheet).blur(0.7).png().toBuffer();
  const result = await keyOutFlatBackground(blurred);
  assert.equal(result.kind, 'keyed');
  if (result.kind !== 'keyed') return;
  const img = await pixels(result.png);
  // Every visible pixel is green artwork: none is left looking like the magenta background.
  let tinted = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if ((img.data[i + 3] as number) > 128 && (img.data[i] as number) > 200 && (img.data[i + 2] as number) > 200) tinted++;
  }
  assert.equal(tinted, 0);
});

test('applyEnhance is not supported, with an error the AI enhance flow can recognise', async () => {
  await assert.rejects(adapter.applyEnhance('originals/x.png', { upscale: { scale: 2, sourceWidth: 10 } }), (error: unknown) => {
    assert.ok(error instanceof StorageTransformUnsupportedError);
    assert.match(error.message, /not supported by local storage/);
    return true;
  });
});
