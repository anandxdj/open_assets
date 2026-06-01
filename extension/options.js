/**
 * OpenAssets Extension — Options Page Controller
 *
 * Uses shared config.js for defaults (DEFAULT_SYNC_CONFIG, DEFAULT_LOCAL_CONFIG)
 * and helpers (getSyncConfig, isValidUrl).
 *
 * Storage split:
 *   sync    → apiUrl, frontendUrl, mode
 *   local   → jwtToken (persists on local machine, does not sync to cloud)
 */

// ── Real-time field validation ──────────────────────────────────────────────

/**
 * Validate a URL input field and toggle its error state.
 * @param {string} inputId  - DOM id of the <input> element
 * @param {string} errorId  - DOM id of the <span class="error-text"> element
 * @returns {boolean} true if the field is valid (empty or a proper URL)
 */
function validateField(inputId, errorId) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  const value = input.value.trim();

  if (value && !isValidUrl(value)) {
    input.classList.add('input-error');
    error.classList.add('visible');
    return false;
  } else {
    input.classList.remove('input-error');
    error.classList.remove('visible');
    return true;
  }
}

/**
 * Run all URL validations and update the Save button's disabled state.
 */
function validateAll() {
  const apiValid = validateField('apiUrl', 'apiUrlError');
  const feValid  = validateField('frontendUrl', 'frontendUrlError');
  document.getElementById('saveBtn').disabled = !(apiValid && feValid);
}

// ── Initialisation ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load persisted sync settings (URLs + mode)
  const syncConfig = await getSyncConfig();
  document.getElementById('apiUrl').value      = syncConfig.apiUrl;
  document.getElementById('frontendUrl').value  = syncConfig.frontendUrl;

  // Load local settings (JWT token)
  const localConfig = await new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_LOCAL_CONFIG, resolve);
  });
  document.getElementById('jwtToken').value = localConfig.jwtToken;

  // Attach real-time validation listeners to URL fields
  document.getElementById('apiUrl').addEventListener('input', validateAll);
  document.getElementById('frontendUrl').addEventListener('input', validateAll);
});

// ── Save handler ────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', async () => {
  // Re-validate before saving (defensive)
  const apiValid = validateField('apiUrl', 'apiUrlError');
  const feValid  = validateField('frontendUrl', 'frontendUrlError');
  if (!apiValid || !feValid) return;

  const apiUrl      = document.getElementById('apiUrl').value.trim().replace(/\/$/, '');
  const frontendUrl = document.getElementById('frontendUrl').value.trim().replace(/\/$/, '');
  const jwtToken    = document.getElementById('jwtToken').value.trim();

  const statusEl = document.getElementById('status');

  try {
    // Persist URLs in sync storage (survives restarts, syncs to other devices)
    // Note: 'mode' is managed by the popup, not the options page — don't overwrite it.
    await new Promise((resolve) => {
      chrome.storage.sync.set({
        apiUrl,
        frontendUrl
      }, resolve);
    });

    // Persist JWT in local storage (local-only, survives restarts)
    await new Promise((resolve) => {
      chrome.storage.local.set({ jwtToken }, resolve);
    });

    // Show success feedback
    statusEl.textContent = 'Settings saved successfully!';
    statusEl.className   = 'status success';

    setTimeout(() => {
      statusEl.style.display = 'none';
      statusEl.className     = 'status';
    }, 3000);

    // Notify the background service worker to refresh its cached config
    chrome.runtime.sendMessage({ action: 'CONFIG_UPDATED' });
  } catch (err) {
    // Surface unexpected storage errors
    statusEl.textContent = `Error saving settings: ${err.message}`;
    statusEl.className   = 'status error';
  }
});
