/**
 * OpenAssets Extension — Shared Configuration Module
 * 
 * Single source of truth for default settings and storage access patterns.
 * Loaded by background.js (via importScripts), popup.js, and options.js (via <script> tag).
 * 
 * Storage strategy:
 *   - chrome.storage.sync  → URLs + mode (persists across sessions, syncs across devices)
 *   - chrome.storage.local → jwtToken (local persistence, persists across restarts, doesn't sync to cloud)
 */

// Default non-secret configuration (stored in sync storage)
const DEFAULT_SYNC_CONFIG = {
  apiUrl: 'https://openasset-backend.anands.dev',
  frontendUrl: 'https://openassets.anands.dev',
  mode: 'direct' // 'direct' or 'interactive'
};

// Default secret configuration (stored in local storage)
const DEFAULT_LOCAL_CONFIG = {
  jwtToken: ''
};

/**
 * Retrieve the full merged configuration from both sync and local storage.
 * @returns {Promise<{apiUrl: string, frontendUrl: string, mode: string, jwtToken: string}>}
 */
async function getFullConfig() {
  const [syncSettings, localSettings] = await Promise.all([
    new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SYNC_CONFIG, resolve);
    }),
    new Promise((resolve) => {
      chrome.storage.local.get(DEFAULT_LOCAL_CONFIG, resolve);
    })
  ]);

  return { ...syncSettings, ...localSettings };
}

/**
 * Get the sync-only config (URLs + mode). Use when you don't need the JWT.
 * @returns {Promise<{apiUrl: string, frontendUrl: string, mode: string}>}
 */
async function getSyncConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SYNC_CONFIG, resolve);
  });
}

/**
 * Build Authorization headers from the stored JWT token.
 * @returns {Promise<Object>} Headers object with Authorization if token exists.
 */
async function getAuthHeaders() {
  const { jwtToken } = await new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_LOCAL_CONFIG, resolve);
  });

  const headers = {};
  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`;
  }
  return headers;
}

/**
 * Mint a fresh access token from the httpOnly refreshToken cookie.
 *
 * Mirrors the frontend's restoreSession() / api-client refresh flow: the cookie
 * is set when the user logs in on the site, and (in production) is SameSite=None;
 * Secure, so it travels on this cross-origin request from the extension. The
 * backend CORS layer reflects chrome-extension:// origins with credentials.
 *
 * On success the token is persisted to chrome.storage.local so getAuthHeaders()
 * picks it up. On any failure returns null WITHOUT clearing the stored token —
 * in local dev the cookie is SameSite=Lax and won't be sent, so we keep the
 * token supplied by the content-script localStorage bridge.
 *
 * @param {string} apiUrl - Base URL for the OpenAssets API.
 * @returns {Promise<string|null>} The fresh access token, or null on failure.
 */
async function refreshAccessToken(apiUrl) {
  try {
    const res = await fetch(`${apiUrl}/api/auth/refresh-token`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const token = body?.data?.accessToken;
    if (!token) return null;
    await chrome.storage.local.set({ jwtToken: token });
    return token;
  } catch {
    return null;
  }
}

/**
 * Centralized authenticated fetch with transparent 401 → refresh → retry.
 *
 * Sends the request with the stored Bearer token (and credentials, so the
 * refresh cookie is available). If the backend rejects with 401 — typically an
 * expired access token — it mints a fresh one via refreshAccessToken() and
 * retries the request once. Mirrors frontend/src/lib/api-client.ts.
 *
 * Callers own init.headers and init.body, so FormData uploads keep their
 * browser-generated multipart boundary (do NOT inject Content-Type here).
 *
 * @param {string} apiUrl - Base URL for the OpenAssets API.
 * @param {string} path   - API path beginning with '/' (e.g. '/api/upload').
 * @param {RequestInit} [init] - Standard fetch init (method, headers, body).
 * @returns {Promise<Response>}
 */
async function apiFetch(apiUrl, path, init = {}) {
  const send = async () => {
    const authHeaders = await getAuthHeaders();
    return fetch(`${apiUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: { ...(init.headers || {}), ...authHeaders },
    });
  };

  let res = await send();

  // Access token likely expired — mint a new one via the cookie, then retry once.
  if (res.status === 401 && !path.includes('/auth/refresh-token')) {
    const token = await refreshAccessToken(apiUrl);
    if (token) res = await send();
  }

  return res;
}

/**
 * Validate that a string is a valid HTTP or HTTPS URL.
 * @param {string} str - The URL string to validate.
 * @returns {boolean}
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const url = new URL(str.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Escape HTML entities to prevent XSS in dynamically generated markup.
 * @param {string} str - Raw string to escape.
 * @returns {string} Escaped string safe for innerHTML.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
