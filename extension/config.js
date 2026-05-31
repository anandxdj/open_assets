/**
 * OpenAssets Extension — Shared Configuration Module
 * 
 * Single source of truth for default settings and storage access patterns.
 * Loaded by background.js (via importScripts), popup.js, and options.js (via <script> tag).
 * 
 * Storage strategy:
 *   - chrome.storage.sync  → URLs + mode (persists across sessions, syncs across devices)
 *   - chrome.storage.session → jwtToken (memory-only, most secure, clears on restart)
 */

// Default non-secret configuration (stored in sync storage)
const DEFAULT_SYNC_CONFIG = {
  apiUrl: 'https://openasset-backend.anands.dev',
  frontendUrl: 'https://openassets.anands.dev',
  mode: 'direct' // 'direct' or 'interactive'
};

// Default secret configuration (stored in session storage)
const DEFAULT_SESSION_CONFIG = {
  jwtToken: ''
};

/**
 * Retrieve the full merged configuration from both sync and session storage.
 * @returns {Promise<{apiUrl: string, frontendUrl: string, mode: string, jwtToken: string}>}
 */
async function getFullConfig() {
  const [syncSettings, sessionSettings] = await Promise.all([
    new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SYNC_CONFIG, resolve);
    }),
    new Promise((resolve) => {
      chrome.storage.session.get(DEFAULT_SESSION_CONFIG, resolve);
    })
  ]);

  return { ...syncSettings, ...sessionSettings };
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
    chrome.storage.session.get(DEFAULT_SESSION_CONFIG, resolve);
  });

  const headers = {};
  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`;
  }
  return headers;
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
