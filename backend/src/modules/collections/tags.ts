/**
 * Collection tags: the small, bounded list an owner sets on a collection and the
 * community page filters by. The same `tags` field the naming step already fills
 * (aggregated search tags), now with one shape: lowercase, URL-safe, short.
 *
 *   - at most MAX_TAGS tags, each at most MAX_TAG_LENGTH characters;
 *   - letters and digits (any language) joined by single hyphens;
 *   - "Pixel Art", "#pixel_art" and " pixel-art " are all the tag "pixel-art".
 */

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24;

const length = (s: string) => Array.from(s).length;

/** One tag in its stored form. Returns '' when nothing usable is left. */
export function normalizeTag(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Normalised, de-duplicated (first one wins, order kept), blanks dropped. No limits applied. */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const tag = typeof item === 'string' ? normalizeTag(item) : '';
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export type TagCheck = { ok: true; tags: string[] } | { ok: false; message: string };

/** Strict check for what an owner submits: normalises, then refuses what is too long or too many. */
export function checkTags(raw: readonly string[]): TagCheck {
  const tags = normalizeTags(raw);
  const tooLong = tags.find((t) => length(t) > MAX_TAG_LENGTH);
  if (tooLong) return { ok: false, message: `Each tag can be at most ${MAX_TAG_LENGTH} characters` };
  if (tags.length > MAX_TAGS) return { ok: false, message: `Use at most ${MAX_TAGS} tags` };
  return { ok: true, tags };
}

/**
 * Forgiving version for tags nobody typed (the AI naming step): keeps the first
 * MAX_TAGS tags that fit, drops the rest instead of failing the extraction.
 */
export function sanitizeTags(raw: readonly string[]): string[] {
  return normalizeTags(raw)
    .filter((t) => length(t) <= MAX_TAG_LENGTH)
    .slice(0, MAX_TAGS);
}

/**
 * Old collections kept whatever the naming step wrote ("RPG", "Pixel Art"). The
 * backfill rewrites them into the stored form so the tag filter can find them:
 * normalised, de-duplicated, anything over MAX_TAG_LENGTH dropped. It keeps more
 * than MAX_TAGS (those still help keyword search); cards show the first five.
 */
export function normalizeLegacyTags(raw: readonly string[] | null | undefined): string[] {
  return normalizeTags(raw ?? []).filter((t) => length(t) <= MAX_TAG_LENGTH);
}
