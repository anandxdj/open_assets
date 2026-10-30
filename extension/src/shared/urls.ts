/**
 * Pure URL handling shared by the runtime code (src/shared/config.ts) and the
 * build config (wxt.config.ts). Nothing here may touch `import.meta.env` or
 * browser APIs, so it runs unchanged in Node (wxt.config.ts) and in tests.
 */

/** Production API the extension talks to when WXT_PUBLIC_API_URL is unset. */
export const DEFAULT_API_URL = 'https://openasset-backend.anands.dev';
/** Production web app the extension signs in through when WXT_PUBLIC_FRONTEND_URL is unset. */
export const DEFAULT_FRONTEND_URL = 'https://openassets.anands.dev';
/** The only third-party host the extension drives (generate tab, content script). */
export const CHATGPT_MATCH = 'https://chatgpt.com/*';

export interface UrlEnv {
  WXT_PUBLIC_API_URL?: string;
  WXT_PUBLIC_FRONTEND_URL?: string;
}

export interface ExtensionUrls {
  /** Backend API base, no trailing slash. */
  apiUrl: string;
  /** Web app base, no trailing slash. */
  frontendUrl: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalises a configured base URL: trims it, drops the query, hash and trailing
 * slashes, and returns `fallback` when it is empty. A value that is set but is
 * not https (or http on localhost) throws, so a typo fails the build instead of
 * shipping an extension that sends tokens to the wrong place.
 */
export function normalizeBaseUrl(raw: string | undefined, fallback: string, name = 'URL'): string {
  const value = raw?.trim();
  if (!value) return fallback;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: "${value}"`);
  }

  const secure = url.protocol === 'https:';
  const localDev = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !localDev) {
    throw new Error(`${name} must be an https URL (http is only allowed for localhost): "${value}"`);
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function resolveUrls(env: UrlEnv): ExtensionUrls {
  return {
    apiUrl: normalizeBaseUrl(env.WXT_PUBLIC_API_URL, DEFAULT_API_URL, 'WXT_PUBLIC_API_URL'),
    frontendUrl: normalizeBaseUrl(env.WXT_PUBLIC_FRONTEND_URL, DEFAULT_FRONTEND_URL, 'WXT_PUBLIC_FRONTEND_URL'),
  };
}

/** `https://api.example.com/v1` becomes the match pattern `https://api.example.com/*`. */
export function toMatchPattern(url: string): string {
  return `${new URL(url).origin}/*`;
}

/**
 * Manifest `host_permissions`: the API origin (so requests skip CORS) and
 * ChatGPT. The web app origin is not listed on purpose: it is only opened in a
 * tab and in the identity flow, which need no host permission.
 */
export function hostPermissionsFor(urls: ExtensionUrls): string[] {
  return [...new Set([toMatchPattern(urls.apiUrl), CHATGPT_MATCH])];
}
