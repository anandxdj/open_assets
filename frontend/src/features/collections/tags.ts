/**
 * Collection tags, as the server stores them (backend/src/modules/collections/tags.ts):
 * at most 5, each at most 24 characters, lowercase letters and digits joined by
 * single hyphens. The server decides; this mirrors it so the form can show the
 * result while the owner types and say what is wrong before the request.
 */

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24;

// Built from strings: the project compiles for ES2017, which has no \p{…} in regex literals.
const NOT_TAG_CHARS = new RegExp("[^\\p{L}\\p{N}-]+", "gu");

export function normalizeTag(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(NOT_TAG_CHARS, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What a person typed (tags separated by commas or line breaks) as a clean, de-duplicated list. */
export function parseTagInput(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const tag = normalizeTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** A sentence saying what is wrong with the list, or null when the server will take it. */
export function tagsProblem(tags: string[]): string | null {
  if (tags.length > MAX_TAGS) return `Use at most ${MAX_TAGS} tags. You have ${tags.length}.`;
  const long = tags.find((t) => Array.from(t).length > MAX_TAG_LENGTH);
  if (long) return `“${long}” is too long. Each tag can be at most ${MAX_TAG_LENGTH} characters.`;
  return null;
}

/** The tag in the address of the community page, cleaned the same way; null when there is none. */
export function tagFromQuery(value: string | null): string | null {
  const tag = value ? normalizeTag(value) : "";
  return tag || null;
}

export function communityTagHref(tag: string): string {
  return `/collections?tag=${encodeURIComponent(tag)}`;
}
