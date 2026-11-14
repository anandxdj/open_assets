import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { classifyImage, keyOutFlatBackground } from '../lib/storage/local.transforms';
import { removeSheetBackground } from '../modules/workers/cropBackground';

/*
 * A synthetic logo sheet that behaves like a generated one: 30 round, shield and seal marks with thin rings,
 * paper-coloured and cream interiors that touch the paper colour, captions and faint cell lines, on off-white
 * paper with JPEG-like noise and no alpha. A provider's whole-sheet AI removal can take the paper for the subject
 * and cut almost nothing out (0.6% transparent on a real sheet like this), so the crops keep a paper-coloured
 * rectangle. Our keyer must handle it for free. Regenerate with fixtures/logo-grid/generate.py.
 */

const DIR = path.join(__dirname, 'fixtures', 'logo-grid');
const SHEET = path.join(DIR, 'logo-grid-cream.jpg');
const GEOMETRY = path.join(DIR, 'logo-grid-cream.json');
const INSET = 8;

interface Geometry {
  width: number;
  height: number;
  colLines: number[];
  rowLines: number[];
  ringInterior: [number, number][];
  sealInterior: [number, number][];
}

const geometry = async () => JSON.parse(await fs.readFile(GEOMETRY, 'utf8')) as Geometry;

async function keyed(removeEnclosed: boolean) {
  const result = await keyOutFlatBackground(await fs.readFile(SHEET), { removeEnclosed });
  assert.equal(result.kind, 'keyed');
  if (result.kind !== 'keyed') throw new Error('not keyed');
  const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3] as number;
  return { data, info, alpha };
}

test('the logo grid classifies as flat off-white, so auto keys it on our server with no AI call', async () => {
  const input = await fs.readFile(SHEET);
  const found = await classifyImage(input);
  assert.equal(found.kind, 'flat');
  // The paper is #f7f7f3, give or take what a JPEG decoder does to its noise.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt((found.color ?? '#000000').slice(i, i + 2), 16));
  assert.ok(Math.abs((r as number) - 0xf7) <= 2 && Math.abs((g as number) - 0xf7) <= 2 && Math.abs((b as number) - 0xf3) <= 2, found.color);

  let aiCalls = 0;
  let uploads = 0;
  const out = await removeSheetBackground(
    { jobId: 'grid', publicId: 'open_assets/originals/grid', originalUrl: 'https://cdn.test/grid.jpg' },
    {
      supportsAi: true,
      fetchOriginal: async () => input,
      storage: {
        async upload() {
          uploads++;
          return { url: 'https://cdn.test/grid_nobg.png', publicId: 'originals/grid_nobg' };
        },
        async applyBackgroundRemoval() {
          aiCalls++;
          return 'https://cdn.test/ai.png';
        },
      },
    },
  );
  assert.equal(out.method, 'server');
  assert.equal(aiCalls, 0);
  assert.equal(uploads, 1);
});

test('the logo grid keyed: most of the sheet goes transparent, where the AI cut-out left under 1%', async () => {
  const { data, info } = await keyed(false);
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if ((data[i] as number) < 250) transparent++;
  const share = transparent / (info.width * info.height);
  assert.ok(share > 0.6 && share < 0.9, `transparent share ${share}`);
});

test('every one of the 30 cells has transparent corners once keyed, paper and cell lines included', async () => {
  const g = await geometry();
  const { alpha } = await keyed(false);
  let checked = 0;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const x0 = (g.colLines[c] as number) + INSET;
      const x1 = (g.colLines[c + 1] as number) - INSET;
      const y0 = (g.rowLines[r] as number) + INSET;
      const y1 = (g.rowLines[r + 1] as number) - INSET;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
        assert.equal(alpha(x, y), 0, `cell ${r},${c} corner ${x},${y}`);
      }
      checked++;
    }
  }
  assert.equal(checked, 30);
  // On a cell line itself.
  assert.equal(alpha(g.colLines[1] as number, 100), 0);
});

test('enclosed pockets off vs on: a mark\'s own paper-coloured interior survives only while the switch is off', async () => {
  const g = await geometry();
  const off = await keyed(false);
  const on = await keyed(true);
  assert.ok(g.ringInterior.length >= 4 && g.sealInterior.length >= 4);

  for (const [x, y] of g.ringInterior) {
    assert.equal(off.alpha(x, y), 255, `ring interior ${x},${y} kept with the switch off (the default)`);
    assert.equal(on.alpha(x, y), 0, `ring interior ${x},${y} cleared with the switch on`);
  }
  // The art itself is opaque either way: the dark seal discs.
  for (const [x, y] of g.sealInterior) {
    assert.equal(off.alpha(x, y), 255, `seal ${x},${y}`);
    assert.equal(on.alpha(x, y), 255, `seal ${x},${y}`);
  }
  for (const sheet of [off, on]) assert.equal(sheet.alpha(0, 0), 0);

  // Across the sheet, the switch only ever removes opaque paper-coloured pixels; it never turns ink transparent.
  let inkLost = 0;
  for (let i = 0; i < off.data.length; i += 4) {
    const lum = ((off.data[i] as number) + (off.data[i + 1] as number) + (off.data[i + 2] as number)) / 3;
    if (lum < 80 && (off.data[i + 3] as number) === 255 && (on.data[i + 3] as number) < 250) inkLost++;
  }
  assert.equal(inkLost, 0);
});
