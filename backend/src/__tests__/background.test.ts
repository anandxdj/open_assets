import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  classifyBackground,
  parseBackground,
  parseBackgroundMode,
  serializeBackground,
} from '../lib/background';
import { classifyImage, keyOutFlatBackground, readPixels } from '../lib/storage/local.transforms';

/*
 * The background rule that detection (py_backend) and the keyer (here) must agree on.
 *
 * The PNG sheets in fixtures/background-cases and their expected answers are read by this file AND by
 * py_backend/tests/test_background_classification.py, which runs the Python implementation on the same
 * files. If the two rules ever drift, one of the two suites fails.
 */

const CASES_DIR = path.join(__dirname, 'fixtures', 'background-cases');

interface Case {
  file: string;
  kind: 'transparent' | 'flat' | 'chroma' | 'complex';
  color: string | null;
  note: string;
}

test('shared fixtures: every sheet gets the same kind and colour as py_backend gives it', async () => {
  const cases = JSON.parse(await fs.readFile(path.join(CASES_DIR, 'cases.json'), 'utf8')) as Case[];
  assert.ok(cases.length >= 15);
  for (const c of cases) {
    const got = classifyBackground(await readPixels(await fs.readFile(path.join(CASES_DIR, c.file))));
    assert.equal(got.kind, c.kind, `${c.file}: ${c.note}`);
    assert.equal(got.color ?? null, c.color, `${c.file}: ${c.note}`);
  }
});

test('shared fixtures: the sheets cover every kind the brief names', async () => {
  const cases = JSON.parse(await fs.readFile(path.join(CASES_DIR, 'cases.json'), 'utf8')) as Case[];
  const names = new Set(cases.map((c) => c.file.replace('.png', '')));
  for (const need of ['white', 'black', 'cream-flat', 'chroma-green', 'chroma-magenta', 'near-white-noisy', 'uneven-magenta', 'gradient-horizontal', 'texture', 'transparent']) {
    assert.ok(names.has(need), need);
  }
  assert.deepEqual([...new Set(cases.map((c) => c.kind))].sort(), ['chroma', 'complex', 'flat', 'transparent']);
});

test('the keyer follows the rule: it refuses exactly the sheets classified complex, and keys the rest', async () => {
  const cases = JSON.parse(await fs.readFile(path.join(CASES_DIR, 'cases.json'), 'utf8')) as Case[];
  for (const c of cases) {
    const input = await fs.readFile(path.join(CASES_DIR, c.file));
    if (c.kind === 'complex') {
      await assert.rejects(keyOutFlatBackground(input), /flat, single-colour/, `${c.file} must be refused`);
    } else {
      const result = await keyOutFlatBackground(input);
      assert.equal(result.kind, c.kind === 'transparent' ? 'transparent' : 'keyed', c.file);
    }
  }
});

test('classifyImage reads a stored file the same way', async () => {
  const input = await fs.readFile(path.join(CASES_DIR, 'chroma-magenta.png'));
  assert.deepEqual(await classifyImage(input), { kind: 'chroma', color: '#ff00ff' });
});

test('an RGB file with no alpha channel at all is classified by its border', async () => {
  const rgb = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  assert.deepEqual(await classifyImage(rgb), { kind: 'flat', color: '#ffffff' });
});

test('parseBackground accepts only a valid stored classification', () => {
  assert.deepEqual(parseBackground('{"kind":"flat","color":"#FFFFFF"}'), { kind: 'flat', color: '#ffffff' });
  assert.deepEqual(parseBackground('{"kind":"complex"}'), { kind: 'complex' });
  assert.deepEqual(parseBackground('{"kind":"transparent","color":null}'), { kind: 'transparent' });
  for (const bad of [undefined, null, '', 'nope', '{}', '{"kind":"sepia"}', '[]', '{"kind":5}']) {
    assert.equal(parseBackground(bad as string | undefined), undefined, String(bad));
  }
  assert.deepEqual(parseBackground('{"kind":"flat","color":"white"}'), { kind: 'flat' }, 'a colour that is not #rrggbb is dropped');
});

test('serializeBackground turns py_backend\'s answer into the stored value, and nothing into empty', () => {
  assert.equal(serializeBackground({ kind: 'chroma', color: '#00ff00' }), '{"kind":"chroma","color":"#00ff00"}');
  assert.equal(serializeBackground({ kind: 'complex', color: null }), '{"kind":"complex"}');
  assert.equal(serializeBackground(undefined), '');
  assert.equal(serializeBackground(null), '');
  assert.equal(serializeBackground({ kind: 'weird' }), '');
});

test('parseBackgroundMode: absent is undefined, the four modes pass, anything else is null (invalid)', () => {
  assert.equal(parseBackgroundMode(undefined), undefined);
  for (const mode of ['auto', 'flat', 'ai', 'none']) assert.equal(parseBackgroundMode(mode), mode);
  for (const bad of ['AUTO', 'server', '', null, 1, true, {}, []]) assert.equal(parseBackgroundMode(bad), null, JSON.stringify(bad));
});
