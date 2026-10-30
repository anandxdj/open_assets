/**
 * Naming patterns for exported files. Pure functions only: no I/O, no imports.
 *
 * The server applies a pattern (finalize, the export names endpoint, saving to
 * a collection); the web app only previews it. Both run THIS file:
 * `frontend/src/lib/naming/pattern.ts` is a byte-for-byte copy and a backend
 * test fails when the two differ. Change both together.
 *
 * ── Pattern language ────────────────────────────────────────────────────────
 * A pattern is literal text and tokens in braces. Examples:
 *
 *   {name}                         fire_sword.png             (the default)
 *   {sheet}_{index:03}_{name}      sprites_001_fire_sword.png
 *   {name}@{scale}x                fire_sword@2x.png
 *   icon-{index}-{w}x{h}           icon-1-128x96.png
 *
 * Tokens
 *   {name}       the asset name (the AI name, or the name you gave it)
 *   {index}      position in this export, counting from 1
 *   {index:03}   the same, zero-padded to 3 digits (any width up to 8)
 *   {sheet}      the source file name, without its extension
 *   {w} {h}      width and height in px of the exported image (after upscaling)
 *   {scale}      the upscale factor: 1 (not upscaled), 2 or 4
 *   {date}       the export date, YYYY-MM-DD (UTC)
 *
 * Rules
 *   - 1 to 100 characters, trimmed.
 *   - It must contain {name} or {index}, so that file names differ.
 *   - Unknown tokens, unmatched braces and bad formats are errors.
 *   - No / or \ and no control characters.
 *   - Every token value is cleaned like names always were: anything other than
 *     letters, digits, - and _ becomes _ (runs collapse), at most 80 characters,
 *     an empty value becomes "asset" ("sheet" for {sheet}).
 *   - In the finished name only letters, digits, - _ . @ stay; anything else
 *     becomes _. Runs of dots collapse, leading and trailing dots are removed,
 *     and the name is cut to 120 characters before ".png" is added.
 *   - Names that still collide get _2, _3 ... in order, so the same input
 *     always gives the same output.
 *
 * The default pattern {name} reproduces the names exports had before patterns
 * existed (see `sanitizeNamePart` and `dedupeStems`), exactly.
 */

export const DEFAULT_PATTERN = '{name}';
export const MAX_PATTERN_LENGTH = 100;
/** Longest file name before the ".png" and a collision suffix. */
export const MAX_STEM_LENGTH = 120;
/** Longest value a single token may contribute. */
export const MAX_TOKEN_LENGTH = 80;
export const FILE_EXTENSION = '.png';

export type TokenName = 'name' | 'index' | 'sheet' | 'w' | 'h' | 'scale' | 'date';

const TOKEN_NAMES: readonly TokenName[] = ['name', 'index', 'sheet', 'w', 'h', 'scale', 'date'];

export interface TokenInfo {
  /** What a chip inserts into the pattern. */
  insert: string;
  token: TokenName;
  description: string;
  /** What it renders to in the docs and the UI. */
  example: string;
}

/** Every token the language has, for docs and the chips in the UI. */
export const TOKENS: readonly TokenInfo[] = [
  { insert: '{name}', token: 'name', description: 'Asset name: the AI name, or yours', example: 'fire_sword' },
  { insert: '{index}', token: 'index', description: 'Position in this export, from 1', example: '1' },
  { insert: '{index:03}', token: 'index', description: 'Position, zero-padded to 3 digits', example: '001' },
  { insert: '{sheet}', token: 'sheet', description: 'Source file name, no extension', example: 'sprites' },
  { insert: '{w}', token: 'w', description: 'Width in px', example: '128' },
  { insert: '{h}', token: 'h', description: 'Height in px', example: '96' },
  { insert: '{scale}', token: 'scale', description: 'Upscale factor: 1, 2 or 4', example: '2' },
  { insert: '{date}', token: 'date', description: 'Export date, UTC', example: '2026-03-15' },
];

export type PatternIssueCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'UNKNOWN_TOKEN'
  | 'BAD_FORMAT'
  | 'UNMATCHED_BRACE'
  | 'FORBIDDEN_CHARACTER'
  | 'MISSING_UNIQUE_TOKEN';

export interface PatternIssue {
  code: PatternIssueCode;
  message: string;
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'token'; token: TokenName; /** Zero-pad width, {index:03} only. */ width?: number };

export type ParsedPattern = { ok: true; pattern: string; segments: Segment[] } | { ok: false; issues: PatternIssue[] };

const TOKEN_HINT = `Use ${TOKEN_NAMES.map((n) => `{${n}}`).join(', ')}.`;

/** The pattern as stored and applied: trimmed. */
export function normalizePattern(pattern: string): string {
  return pattern.trim();
}

export function isDefaultPattern(pattern: string): boolean {
  return normalizePattern(pattern) === DEFAULT_PATTERN;
}

/**
 * Reads a pattern. Returns every problem found (not just the first) so a form
 * can show them; `segments` are the parsed pieces when there are none.
 */
export function parsePattern(input: string): ParsedPattern {
  const pattern = normalizePattern(input);
  const issues: PatternIssue[] = [];
  const add = (code: PatternIssueCode, message: string) => {
    if (!issues.some((i) => i.message === message)) issues.push({ code, message });
  };

  if (pattern === '') return { ok: false, issues: [{ code: 'EMPTY', message: 'Enter a pattern.' }] };
  if (pattern.length > MAX_PATTERN_LENGTH) {
    add('TOO_LONG', `Use at most ${MAX_PATTERN_LENGTH} characters (this has ${pattern.length}).`);
  }
  if (/[/\\\u0000-\u001f\u007f]/.test(pattern)) {
    add('FORBIDDEN_CHARACTER', 'Patterns cannot contain / or \\ or control characters. File names are flat.');
  }

  const segments: Segment[] = [];
  let text = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern.charAt(i);
    if (ch === '}') {
      add('UNMATCHED_BRACE', 'A } has no matching {.');
      i += 1;
      continue;
    }
    if (ch !== '{') {
      text += ch;
      i += 1;
      continue;
    }
    const close = pattern.indexOf('}', i + 1);
    const nextOpen = pattern.indexOf('{', i + 1);
    if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
      add('UNMATCHED_BRACE', 'A { has no matching }.');
      i += 1;
      continue;
    }
    const body = pattern.slice(i + 1, close);
    const colon = body.indexOf(':');
    const hasFormat = colon !== -1;
    const rawName = hasFormat ? body.slice(0, colon) : body;
    const format = hasFormat ? body.slice(colon + 1) : '';
    const token = TOKEN_NAMES.find((n) => n === rawName);
    if (!token) {
      add('UNKNOWN_TOKEN', `{${body}} is not a token. ${TOKEN_HINT}`);
    } else if (token === 'index' && hasFormat) {
      const m = /^0?([1-8])$/.exec(format);
      if (!m) {
        add('BAD_FORMAT', `{${body}} is not a format. Use {index:03} to pad the number to 3 digits (up to 8).`);
      } else {
        if (text) segments.push({ kind: 'text', text });
        text = '';
        segments.push({ kind: 'token', token, width: Number(m[1]) });
      }
    } else if (hasFormat) {
      add('BAD_FORMAT', `{${token}} takes no format.`);
    } else {
      if (text) segments.push({ kind: 'text', text });
      text = '';
      segments.push({ kind: 'token', token });
    }
    i = close + 1;
  }
  if (text) segments.push({ kind: 'text', text });

  // Only worth saying when nothing else is wrong: a broken token may have been meant as {name}.
  if (issues.length === 0) {
    const unique = segments.some((s) => s.kind === 'token' && (s.token === 'name' || s.token === 'index'));
    if (!unique) add('MISSING_UNIQUE_TOKEN', 'Include {name} or {index} so every file gets its own name.');
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, pattern, segments };
}

/** `parsePattern` without the segments. */
export function validatePattern(input: string): { valid: true } | { valid: false; issues: PatternIssue[] } {
  const parsed = parsePattern(input);
  return parsed.ok ? { valid: true } : { valid: false, issues: parsed.issues };
}

/**
 * How asset names have always been turned into file names: trimmed, anything
 * other than letters, digits, - and _ becomes _, at most 80 characters. This
 * is the web app's old `sanitize()`; the default pattern must keep matching it.
 */
export function sanitizeNamePart(value: string, fallback = 'asset'): string {
  return value.trim().replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, MAX_TOKEN_LENGTH) || fallback;
}

/** Makes an assembled name safe as a file name (without the extension). */
export function sanitizeFileStem(stem: string): string {
  const safe = stem
    .replace(/[^A-Za-z0-9._@-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/\.+$/, '');
  return safe || 'asset';
}

/**
 * Makes names unique by adding _2, _3 ... to later duplicates, in order. A
 * suffixed name that is itself taken moves on (a, a, a_2 gives a, a_2, a_2_2).
 * Comparison is exact: the same rule exports have always used.
 */
export function dedupeStems(stems: readonly string[]): string[] {
  const used = new Set<string>();
  return stems.map((stem) => {
    let unique = stem;
    let n = 2;
    while (used.has(unique)) unique = `${stem}_${n++}`;
    used.add(unique);
    return unique;
  });
}

/** A source file name without its extension ("sprites.png" gives "sprites"). */
export function sheetStem(fileName: string | undefined | null): string {
  return (fileName ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

function extent(start: number, size: number, limit: number): number {
  const from = Math.max(0, Math.round(start));
  const to = Math.round(start) + Math.round(size);
  return Math.max(1, (limit > 0 ? Math.min(limit, to) : to) - from);
}

/**
 * Pixel size of the crop for a box, as the crop service cuts it: the rounded
 * box clamped to the sheet (a sheet size of 0 or unknown means no clamp).
 */
export function cropSize(
  box: { x: number; y: number; width: number; height: number },
  sheetWidth: number,
  sheetHeight: number,
): { width: number; height: number } {
  return { width: extent(box.x, box.width, sheetWidth), height: extent(box.y, box.height, sheetHeight) };
}

export interface NamingItem {
  /** The asset's name before the pattern. */
  name: string;
  /** Pixel size of the exported image, after any upscale. Unknown renders as 0. */
  width?: number;
  height?: number;
}

export interface NamingContext {
  /** The source file name; its extension is dropped. */
  sheet?: string | null;
  /** Upscale factor of the export. Default 1. */
  scale?: number;
  /** The export date, or a YYYY-MM-DD string. Default: now. */
  date?: Date | string;
}

export type NamingResult =
  | { ok: true; pattern: string; stems: string[]; fileNames: string[] }
  | { ok: false; issues: PatternIssue[] };

function dateText(date: Date | string | undefined): string {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return d.toISOString().slice(0, 10);
}

function whole(value: number | undefined): string {
  return String(Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : 0);
}

/**
 * Applies a pattern to a list of assets, in order. `stems` are the unique file
 * names without the extension, `fileNames` add ".png". An invalid pattern comes
 * back as `{ ok: false, issues }`; nothing here throws.
 */
export function applyNamingPattern(
  pattern: string,
  items: readonly NamingItem[],
  context: NamingContext = {},
): NamingResult {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) return parsed;

  const sheet = sanitizeNamePart(sheetStem(context.sheet), 'sheet');
  const scale = whole(context.scale ?? 1);
  const date = dateText(context.date);

  const raw = items.map((item, position) => {
    const text = parsed.segments
      .map((segment) => {
        if (segment.kind === 'text') return segment.text;
        switch (segment.token) {
          case 'name':
            return sanitizeNamePart(String(item.name));
          case 'index':
            return String(position + 1).padStart(segment.width ?? 1, '0');
          case 'sheet':
            return sheet;
          case 'w':
            return whole(item.width);
          case 'h':
            return whole(item.height);
          case 'scale':
            return scale;
          case 'date':
            return date;
        }
      })
      .join('');
    return sanitizeFileStem(text);
  });

  const stems = dedupeStems(raw);
  return { ok: true, pattern: parsed.pattern, stems, fileNames: stems.map((s) => `${s}${FILE_EXTENSION}`) };
}
