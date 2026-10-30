/** Where signed-in people land when no `?next=` destination is given. */
export const DEFAULT_SIGNED_IN_PATH = "/upload";

/**
 * Resolve a `?next=` value to a same-origin path. Anything that is not a plain
 * path ("https://…", "//host", "/\host") falls back to the default, so the
 * parameter cannot be used as an open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return DEFAULT_SIGNED_IN_PATH;
  }
  return raw;
}
