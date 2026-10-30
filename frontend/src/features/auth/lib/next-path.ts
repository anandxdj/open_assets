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

const REMEMBERED_NEXT = "oa:post-signin-next";

/**
 * Google sign-in leaves the site and comes back to /callback, so a `?next=` in
 * the address is gone by then. Remember it for this tab before leaving.
 */
export function rememberNextPath(raw: string | null | undefined): void {
  if (!raw) return;
  try {
    sessionStorage.setItem(REMEMBERED_NEXT, safeNextPath(raw));
  } catch {
    // Storage blocked: sign-in still works, it just lands on the default page.
  }
}

/** The path remembered by `rememberNextPath`, once. Null when there is none. */
export function takeRememberedNextPath(): string | null {
  try {
    const raw = sessionStorage.getItem(REMEMBERED_NEXT);
    sessionStorage.removeItem(REMEMBERED_NEXT);
    return raw ? safeNextPath(raw) : null;
  } catch {
    return null;
  }
}

/** Adds `?next=` to an auth path when there is a destination to carry along. */
export function withNext(path: string, raw: string | null | undefined): string {
  if (!raw) return path;
  return `${path}?next=${encodeURIComponent(safeNextPath(raw))}`;
}
