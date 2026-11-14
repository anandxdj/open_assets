import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from '../common/utils/ApiError';
import {
  DEFAULT_PATTERN,
  MAX_PATTERN_LENGTH,
  MAX_STEM_LENGTH,
  TOKENS,
  applyNamingPattern,
  cropSize,
  dedupeStems,
  isDefaultPattern,
  normalizePattern,
  parsePattern,
  sanitizeFileStem,
  sanitizeNamePart,
  sheetStem,
  validatePattern,
} from '../modules/naming/pattern';
import { exportScaleOf, nameExportAssets } from '../modules/naming/exportNames';
import { croppedWidth } from '../modules/plans/upscale';

const here = import.meta.dirname ?? __dirname;
const MIRROR = path.resolve(here, '../../../frontend/src/lib/naming/pattern.ts');
const OWN = path.resolve(here, '../modules/naming/pattern.ts');

const DATE = '2026-03-15';

function names(pattern: string, items: { name: string; width?: number; height?: number }[], context = {}) {
  const result = applyNamingPattern(pattern, items, { date: DATE, ...context });
  assert.ok(result.ok, JSON.stringify(result));
  return result.fileNames;
}

function issueCodes(pattern: string): string[] {
  const parsed = parsePattern(pattern);
  return parsed.ok ? [] : parsed.issues.map((i) => i.code);
}

// ── Parser and validator ────────────────────────────────────────────────────

test('the default pattern is {name} and is recognised through whitespace', () => {
  assert.equal(DEFAULT_PATTERN, '{name}');
  assert.equal(isDefaultPattern('{name}'), true);
  assert.equal(isDefaultPattern('  {name}  '), true);
  assert.equal(isDefaultPattern('{name}_1'), false);
  assert.equal(normalizePattern('  {sheet}_{name} '), '{sheet}_{name}');
});

test('parsePattern reads literal text, tokens and the zero-pad format', () => {
  const parsed = parsePattern('{sheet}_{index:03}-{name}.v2');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.segments, [
    { kind: 'token', token: 'sheet' },
    { kind: 'text', text: '_' },
    { kind: 'token', token: 'index', width: 3 },
    { kind: 'text', text: '-' },
    { kind: 'token', token: 'name' },
    { kind: 'text', text: '.v2' },
  ]);
});

test('every documented token is accepted', () => {
  for (const { insert } of TOKENS) {
    assert.equal(validatePattern(`${insert}_{name}`).valid, true, insert);
  }
  for (const token of ['{name}', '{index}', '{index:03}', '{index:2}', '{index:08}', '{sheet}', '{w}', '{h}', '{scale}', '{date}']) {
    assert.equal(validatePattern(`{name}${token}`).valid, true, token);
  }
});

test('unknown tokens are rejected, and the message lists the real ones', () => {
  assert.deepEqual(issueCodes('{name}_{foo}'), ['UNKNOWN_TOKEN']);
  assert.deepEqual(issueCodes('{Name}'), ['UNKNOWN_TOKEN'], 'tokens are case-sensitive');
  assert.deepEqual(issueCodes('{}{name}'), ['UNKNOWN_TOKEN']);
  const parsed = parsePattern('{nope}');
  assert.ok(!parsed.ok);
  assert.match(parsed.issues[0]?.message ?? '', /\{nope\} is not a token/);
  assert.match(parsed.issues[0]?.message ?? '', /\{name\}/);
});

test('bad formats and unmatched braces are rejected', () => {
  assert.deepEqual(issueCodes('{index:abc}'), ['BAD_FORMAT']);
  assert.deepEqual(issueCodes('{index:09}'), ['BAD_FORMAT']);
  assert.deepEqual(issueCodes('{index:03:x}'), ['BAD_FORMAT']);
  assert.deepEqual(issueCodes('{index:}'), ['BAD_FORMAT']);
  assert.deepEqual(issueCodes('{name:03}'), ['BAD_FORMAT'], 'only {index} takes a format');
  assert.deepEqual(issueCodes('{w:3}{name}'), ['BAD_FORMAT']);
  assert.deepEqual(issueCodes('{name'), ['UNMATCHED_BRACE']);
  assert.deepEqual(issueCodes('name}'), ['UNMATCHED_BRACE']);
  assert.deepEqual(issueCodes('{na{me}'), ['UNMATCHED_BRACE', 'UNKNOWN_TOKEN']);
  assert.deepEqual(issueCodes('{{name}}'), ['UNMATCHED_BRACE', 'UNMATCHED_BRACE'], 'there is no escaping: braces are for tokens only');
});

test('a pattern must contain {name} or {index} so that file names differ', () => {
  assert.deepEqual(issueCodes('{sheet}_{w}x{h}'), ['MISSING_UNIQUE_TOKEN']);
  assert.deepEqual(issueCodes('static'), ['MISSING_UNIQUE_TOKEN']);
  assert.deepEqual(issueCodes('{date}'), ['MISSING_UNIQUE_TOKEN']);
  assert.deepEqual(issueCodes('{index}'), []);
  assert.deepEqual(issueCodes('{index:03}'), []);
  assert.deepEqual(issueCodes('{name}'), []);
});

test('empty, too long, path separators and control characters are rejected', () => {
  assert.deepEqual(issueCodes(''), ['EMPTY']);
  assert.deepEqual(issueCodes('   '), ['EMPTY']);
  assert.deepEqual(issueCodes(`{name}${'x'.repeat(MAX_PATTERN_LENGTH)}`), ['TOO_LONG']);
  assert.deepEqual(issueCodes(`${'x'.repeat(MAX_PATTERN_LENGTH - 6)}{name}`), [], 'exactly at the limit is fine');
  assert.deepEqual(issueCodes('a/{name}'), ['FORBIDDEN_CHARACTER']);
  assert.deepEqual(issueCodes('a\\{name}'), ['FORBIDDEN_CHARACTER']);
  assert.deepEqual(issueCodes('../{name}'), ['FORBIDDEN_CHARACTER']);
  assert.deepEqual(issueCodes('{name}\u0000'), ['FORBIDDEN_CHARACTER']);
  assert.deepEqual(issueCodes('{name}\n'), [], 'surrounding whitespace is trimmed first');
  assert.deepEqual(issueCodes('{na\tme}'), ['FORBIDDEN_CHARACTER', 'UNKNOWN_TOKEN']);
});

test('validatePattern reports every problem found', () => {
  const result = validatePattern('{foo}/{bar}');
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.deepEqual(
      result.issues.map((i) => i.code).sort(),
      ['FORBIDDEN_CHARACTER', 'UNKNOWN_TOKEN', 'UNKNOWN_TOKEN'],
    );
  }
});

test('applyNamingPattern does not throw on an invalid pattern, it reports it', () => {
  const result = applyNamingPattern('{foo}', [{ name: 'a' }]);
  assert.equal(result.ok, false);
});

// ── Applying a pattern ──────────────────────────────────────────────────────

test('tokens: name, index, padded index, sheet, size, scale and date', () => {
  const items = [
    { name: 'fire_sword', width: 128, height: 96 },
    { name: 'health_potion', width: 64, height: 64 },
  ];
  const context = { sheet: 'sprites.png', scale: 2 };
  assert.deepEqual(names('{name}', items, context), ['fire_sword.png', 'health_potion.png']);
  assert.deepEqual(names('{index}', items, context), ['1.png', '2.png']);
  assert.deepEqual(names('{index:03}_{name}', items, context), ['001_fire_sword.png', '002_health_potion.png']);
  assert.deepEqual(names('{sheet}_{name}', items, context), ['sprites_fire_sword.png', 'sprites_health_potion.png']);
  assert.deepEqual(names('{name}_{w}x{h}', items, context), ['fire_sword_128x96.png', 'health_potion_64x64.png']);
  assert.deepEqual(names('{name}@{scale}x', items, context), ['fire_sword@2x.png', 'health_potion@2x.png']);
  assert.deepEqual(names('{date}_{name}', items, context), ['2026-03-15_fire_sword.png', '2026-03-15_health_potion.png']);
  assert.deepEqual(names('{index:2}', Array.from({ length: 12 }, () => ({ name: 'x' })))[11], '12.png');
  assert.deepEqual(names('{index:02}', [{ name: 'x' }])[0], '01.png');
  assert.deepEqual(names('{index:02}', Array.from({ length: 120 }, () => ({ name: 'x' })))[119], '120.png', 'never truncated');
});

test('{scale} defaults to 1, unknown sizes render 0, a missing sheet is "sheet"', () => {
  assert.deepEqual(names('{name}_{scale}_{w}x{h}_{sheet}', [{ name: 'a' }]), ['a_1_0x0_sheet.png']);
  assert.deepEqual(names('{sheet}_{name}', [{ name: 'a' }], { sheet: '' }), ['sheet_a.png']);
  assert.deepEqual(names('{sheet}_{name}', [{ name: 'a' }], { sheet: '.png' }), ['sheet_a.png']);
});

test('{sheet} drops only the extension and is cleaned like a name', () => {
  assert.equal(sheetStem('sprites.png'), 'sprites');
  assert.equal(sheetStem('my.sprites.v2.PNG'), 'my.sprites.v2');
  assert.equal(sheetStem('no_extension'), 'no_extension');
  assert.equal(sheetStem(undefined), '');
  assert.deepEqual(names('{sheet}_{name}', [{ name: 'a' }], { sheet: 'my sprites (v2).png' }), ['my_sprites_v2__a.png']);
});

test('{date} accepts a Date or a YYYY-MM-DD string and uses UTC', () => {
  const r = applyNamingPattern('{date}_{name}', [{ name: 'a' }], { date: new Date('2026-12-31T23:59:59Z') });
  assert.ok(r.ok);
  assert.deepEqual(r.fileNames, ['2026-12-31_a.png']);
  assert.deepEqual(names('{date}_{name}', [{ name: 'a' }], { date: '2025-01-02' }), ['2025-01-02_a.png']);
});

test('every token example in the docs is what the token renders', () => {
  const item = { name: 'fire_sword', width: 128, height: 96 };
  const context = { sheet: 'sprites.png', scale: 2, date: DATE };
  for (const { insert, token, example } of TOKENS) {
    // {name} and {index} can stand alone; the rest follow a {name} so the pattern is valid.
    const pattern = token === 'name' || token === 'index' ? insert : `{name}_${insert}`;
    const r = applyNamingPattern(pattern, [item], context);
    assert.ok(r.ok, insert);
    const stem = r.stems[0] ?? '';
    assert.ok(stem.endsWith(example), `${insert}: "${stem}" should end with "${example}"`);
  }
});

// ── Sanitizing ──────────────────────────────────────────────────────────────

test('names are cleaned: no path separators, no traversal, only safe characters', () => {
  assert.equal(sanitizeNamePart('../../etc/passwd'), '_etc_passwd');
  assert.equal(sanitizeNamePart('a\\b/c'), 'a_b_c');
  assert.equal(sanitizeNamePart('スプライト'), '_');
  assert.equal(sanitizeNamePart('  Red Potion  '), 'Red_Potion');
  assert.equal(sanitizeNamePart(''), 'asset');
  assert.equal(sanitizeNamePart('   '), 'asset');
  assert.equal(sanitizeNamePart('x'.repeat(200)).length, 80);

  for (const hostile of ['../x', '..\\x', '/abs/path', 'C:\\win\\x', 'a/../b', '%2e%2e/x', 'con.txt\u0000.png']) {
    const out = names('{name}', [{ name: hostile }])[0] as string;
    assert.match(out, /^[A-Za-z0-9._@-]+$/, `${hostile} -> ${out}`);
    assert.ok(!out.includes('..'), out);
    assert.ok(!out.startsWith('.'), out);
  }
});

test('the finished name keeps letters, digits and - _ . @, and drops the rest', () => {
  assert.equal(sanitizeFileStem('a b'), 'a_b');
  assert.equal(sanitizeFileStem('a  b!!c'), 'a_b_c');
  assert.equal(sanitizeFileStem('name@2x'), 'name@2x');
  assert.equal(sanitizeFileStem('v1.2.3'), 'v1.2.3');
  assert.equal(sanitizeFileStem('a..b...c'), 'a.b.c');
  assert.equal(sanitizeFileStem('.hidden'), 'hidden');
  assert.equal(sanitizeFileStem('...'), 'asset');
  assert.equal(sanitizeFileStem('name.'), 'name', 'a trailing dot would double up before .png');
  assert.equal(sanitizeFileStem(''), 'asset');
  assert.equal(sanitizeFileStem('é'), '_');
});

test('the finished name is cut to 120 characters, before .png and any suffix', () => {
  const long = 'x'.repeat(300);
  assert.equal(sanitizeFileStem(long).length, MAX_STEM_LENGTH);
  const [first, second] = names('{sheet}_{sheet}_{name}', [{ name: 'a' }, { name: 'a' }], { sheet: long });
  assert.equal(first?.length, MAX_STEM_LENGTH + '.png'.length);
  assert.equal(second?.length, MAX_STEM_LENGTH + '_2.png'.length, 'the suffix comes after the cap');
});

test('literal text in a pattern is cleaned too', () => {
  assert.deepEqual(names('my icons ({name})', [{ name: 'a' }]), ['my_icons_a_.png']);
  assert.deepEqual(names('{name}~v2', [{ name: 'a' }]), ['a_v2.png']);
});

// ── Dedupe ──────────────────────────────────────────────────────────────────

test('collisions get _2, _3 in order', () => {
  assert.deepEqual(dedupeStems(['a', 'a', 'a', 'b']), ['a', 'a_2', 'a_3', 'b']);
  assert.deepEqual(names('{name}', [{ name: 'a' }, { name: 'a' }, { name: 'a' }]), ['a.png', 'a_2.png', 'a_3.png']);
});

test('a suffixed name that is taken moves on, and the result is always unique', () => {
  assert.deepEqual(dedupeStems(['a', 'a', 'a_2']), ['a', 'a_2', 'a_2_2']);
  assert.deepEqual(dedupeStems(['a_2', 'a', 'a']), ['a_2', 'a', 'a_3']);
  const messy = ['x', 'x', 'x_2', 'x_2', 'x', 'x_3', 'x_2_2'];
  const out = dedupeStems(messy);
  assert.equal(new Set(out).size, messy.length);
});

test('dedupe is deterministic: the same input always gives the same output', () => {
  const items = ['a', 'b', 'a', 'a_2', 'b', 'a'].map((name) => ({ name }));
  const first = names('{name}', items);
  for (let i = 0; i < 5; i += 1) assert.deepEqual(names('{name}', items), first);
});

test('names that collide because of the pattern are deduped too', () => {
  // The pattern drops the difference between the two assets.
  assert.deepEqual(
    names('{sheet}_{name}', [{ name: 'x' }, { name: 'x' }], { sheet: 's.png' }),
    ['s_x.png', 's_x_2.png'],
  );
  assert.deepEqual(names('{index}', [{ name: 'a' }, { name: 'a' }]), ['1.png', '2.png']);
  assert.deepEqual(names('{w}_{name}', [{ name: 'x', width: 8 }, { name: 'x', width: 8 }]), ['8_x.png', '8_x_2.png']);
});

// ── The default pattern reproduces today's names ────────────────────────────

/**
 * Today's ZIP naming, copied from frontend/src/features/editor/services/localExport.ts
 * (sanitize, and the loop in zipImageUrls) as it was before naming patterns. The
 * default pattern has to produce exactly this.
 */
function legacySanitize(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 80) || 'asset';
}
function legacyFileNames(assetNames: string[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const name of assetNames) {
    const base = legacySanitize(String(name));
    let fileName = `${base}.png`;
    let i = 2;
    while (used.has(fileName)) fileName = `${base}_${i++}.png`;
    used.add(fileName);
    out.push(fileName);
  }
  return out;
}

test('default pattern: file names match what exports used before patterns, exactly', () => {
  const cases: string[][] = [
    ['fire_sword', 'health_potion', 'asset_003'],
    ['a', 'a', 'a', 'a_2', 'a_2', 'b'],
    ['Red Potion', 'red potion', 'Red  Potion', 'Red_Potion'],
    ['  padded  ', 'padded', ''],
    ['', '', '   '],
    ['../../etc/passwd', 'a/b', 'a\\b', 'a.b', 'a..b', '.hidden', '...', 'name.', 'name '],
    ['スプライト', 'スプライト', 'é', 'é'],
    ['x'.repeat(200), 'x'.repeat(200), 'x'.repeat(80), 'x'.repeat(81)],
    ['---', '___', '-_-', '--', '--'],
    ['UPPER', 'upper', 'Upper'],
    ['1', '01', '1', '1_2'],
    ['a-b', 'a_b', 'a b', 'a.b', 'a!b'],
    ['con.', 'nul', 'a:b', 'a?b', 'a*b', 'a"b', 'a<b>', 'a|b'],
  ];
  for (const assetNames of cases) {
    const expected = legacyFileNames(assetNames);
    const actual = names(DEFAULT_PATTERN, assetNames.map((name) => ({ name })));
    assert.deepEqual(actual, expected, JSON.stringify(assetNames));
  }
});

test('default pattern: the size, sheet and scale of the export change nothing', () => {
  const items = ['a', 'a', 'b'].map((name) => ({ name, width: 10, height: 20 }));
  const expected = legacyFileNames(['a', 'a', 'b']);
  assert.deepEqual(names('{name}', items, { sheet: 'x.png', scale: 4 }), expected);
  assert.deepEqual(names('  {name}  ', items), expected, 'whitespace around the pattern is ignored');
});

test('default pattern: a long run of generated names matches the legacy loop', () => {
  const pool = ['sword', 'potion', 'Gem Blue', 'gem blue', 'icon.v2', 'icon_v2', 'ícone', ''];
  const assetNames = Array.from({ length: 300 }, (_, i) => pool[(i * 7 + (i % 3)) % pool.length] as string);
  assert.deepEqual(
    names(DEFAULT_PATTERN, assetNames.map((name) => ({ name }))),
    legacyFileNames(assetNames),
  );
});

// ── Crop size and export naming for a job ───────────────────────────────────

test('cropSize matches croppedWidth for width, and clamps the height the same way', () => {
  const boxes = [
    { x: 10, y: 10, width: 80, height: 40 },
    { x: 10.4, y: 5.5, width: 79.6, height: 20.2 },
    { x: -20, y: -5, width: 100, height: 30 },
    { x: 760, y: 560, width: 100, height: 100 },
    { x: 900, y: 700, width: 50, height: 50 },
  ];
  for (const box of boxes) {
    for (const sheetWidth of [800, 0]) {
      assert.equal(cropSize(box, sheetWidth, 600).width, croppedWidth(box, sheetWidth), JSON.stringify(box));
    }
  }
  assert.deepEqual(cropSize({ x: 10, y: 10, width: 80, height: 40 }, 800, 600), { width: 80, height: 40 });
  assert.deepEqual(cropSize({ x: -20, y: -5, width: 100, height: 30 }, 800, 600), { width: 80, height: 25 });
  assert.deepEqual(cropSize({ x: 760, y: 560, width: 100, height: 100 }, 800, 600), { width: 40, height: 40 });
  assert.deepEqual(cropSize({ x: 10, y: 10, width: 80, height: 40 }, 0, 0), { width: 80, height: 40 }, 'unknown sheet: no clamp');
  assert.deepEqual(cropSize({ x: 900, y: 700, width: 50, height: 50 }, 800, 600), { width: 1, height: 1 }, 'never below 1 px');
});

test('nameExportAssets: size comes from the boxes and is multiplied by the export scale', () => {
  const assets = [
    { id: 'b1', name: 'sword' },
    { id: 'b2', name: 'potion' },
    { id: 'gone', name: 'ghost' },
  ];
  const boxes = [
    { id: 'b1', x: 0, y: 0, width: 128, height: 96 },
    { id: 'b2', x: 10, y: 10, width: 64, height: 64 },
  ];
  const out = nameExportAssets({
    assets,
    boxes,
    sheetWidth: 800,
    sheetHeight: 600,
    sheetFileName: 'sprites.png',
    pattern: '{sheet}_{name}_{w}x{h}@{scale}x',
    scale: 2,
    now: new Date('2026-03-15T00:00:00Z'),
  });
  assert.deepEqual(
    out.map((n) => n.fileName),
    ['sprites_sword_256x192@2x.png', 'sprites_potion_128x128@2x.png', 'sprites_ghost_0x0@2x.png'],
  );
  assert.deepEqual(out.map((n) => n.id), ['b1', 'b2', 'gone']);
  assert.deepEqual(out.map((n) => n.name), ['sword', 'potion', 'ghost']);
  assert.deepEqual(out.map((n) => n.stem + '.png'), out.map((n) => n.fileName));
});

test('nameExportAssets throws 400 INVALID_PATTERN for a bad pattern', () => {
  assert.throws(
    () => nameExportAssets({ assets: [{ id: 'a', name: 'a' }], boxes: [], sheetWidth: 0, sheetHeight: 0, pattern: '{nope}', scale: 1 }),
    (err: unknown) => err instanceof ApiError && err.statusCode === 400 && err.code === 'INVALID_PATTERN',
  );
});

test('exportScaleOf: 2 or 4 only once an upscaling finalize has started', () => {
  assert.equal(exportScaleOf({ status: 'cropped', upscaleScale: '4' }), 1);
  assert.equal(exportScaleOf({ status: 'finalizing', upscaleScale: '4' }), 4);
  assert.equal(exportScaleOf({ status: 'ready', upscaleScale: '2' }), 2);
  assert.equal(exportScaleOf({ status: 'ready', upscaleScale: '2', skipUpscale: 'true' }), 1);
  assert.equal(exportScaleOf({ status: 'ready', upscaleScale: '3' }), 1);
  assert.equal(exportScaleOf({ status: 'ready' }), 1);
});

// ── The frontend mirror ─────────────────────────────────────────────────────

test('the frontend mirror of the naming pattern module has not drifted', (t) => {
  if (!existsSync(MIRROR)) return t.skip('frontend not present');
  assert.equal(readFileSync(MIRROR, 'utf8'), readFileSync(OWN, 'utf8'));
});

test('the frontend mirror gives the same names and the same errors as the backend module', async (t) => {
  if (!existsSync(MIRROR)) return t.skip('frontend not present');
  const mirror = (await import(MIRROR)) as typeof import('../modules/naming/pattern');

  const patterns = [
    '{name}',
    '  {name} ',
    '{sheet}_{index:03}_{name}',
    '{name}@{scale}x',
    'icon-{index}-{w}x{h}',
    '{date}_{name}',
    '{index:09}',
    '{foo}',
    '{name',
    'static',
    'a/{name}',
    '',
    `{name}${'x'.repeat(120)}`,
  ];
  const items = [
    { name: 'fire_sword', width: 128, height: 96 },
    { name: 'Fire Sword', width: 64, height: 64 },
    { name: 'fire_sword' },
    { name: '../../x' },
    { name: '' },
  ];
  const context = { sheet: 'My Sheet.png', scale: 4, date: DATE };
  for (const pattern of patterns) {
    assert.deepEqual(mirror.applyNamingPattern(pattern, items, context), applyNamingPattern(pattern, items, context), pattern);
    assert.deepEqual(mirror.parsePattern(pattern), parsePattern(pattern), pattern);
  }
  assert.deepEqual(mirror.TOKENS, TOKENS);
  assert.equal(mirror.DEFAULT_PATTERN, DEFAULT_PATTERN);
});
