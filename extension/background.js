/**
 * OpenAssets Extension — Background Service Worker
 *
 * Orchestrates the full extraction pipeline:
 *   1. Image download from the host page
 *   2. Upload to the OpenAssets backend
 *   3. Poll for detection → crop → finalize statuses
 *   4. Trigger ZIP download & system notification
 *
 * Uses config.js (loaded via importScripts) for all default settings,
 * storage helpers, and auth header construction.
 */

// ─── Load shared configuration module ────────────────────────────────────────
importScripts('config.js');

// ─── Module-level state for popup progress tracking ──────────────────────────
// The popup can query this via the GET_JOB_STATUS message to display
// real-time progress without needing its own polling loop.
let activeJob = null;

// ─── Extension Install / Update Handler ──────────────────────────────────────
// Seeds both sync and session storage with defaults, and creates context menus.
chrome.runtime.onInstalled.addListener(() => {
  // Initialize sync storage (URLs + mode preference)
  chrome.storage.sync.get(DEFAULT_SYNC_CONFIG, (items) => {
    chrome.storage.sync.set(items);
  });

  // Initialize local storage (JWT token — persists across restarts, doesn't sync)
  chrome.storage.local.get(DEFAULT_LOCAL_CONFIG, (items) => {
    chrome.storage.local.set(items);
  });

  // Context menu: right-click an image → auto-crop directly
  chrome.contextMenus.create({
    id: 'extract-direct',
    title: 'OpenAssets - Direct Auto-Crop',
    contexts: ['image']
  });

  // Context menu: right-click an image → open in interactive canvas editor
  chrome.contextMenus.create({
    id: 'extract-editor',
    title: 'OpenAssets - Edit in Canvas',
    contexts: ['image']
  });
});

// ─── Context Menu Click Listener ─────────────────────────────────────────────
// Routes the clicked image URL to the extraction workflow with the correct mode.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'extract-direct') {
    startExtractionWorkflow(info.srcUrl, 'direct', tab.id);
  } else if (info.menuItemId === 'extract-editor') {
    startExtractionWorkflow(info.srcUrl, 'interactive', tab.id);
  }
});

// ─── Message Listener (content script / popup → background) ──────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXTRACT_IMAGE') {
    // Read the user's default mode preference from sync config, then start workflow
    getSyncConfig().then((syncSettings) => {
      const mode = syncSettings.mode || 'direct';
      startExtractionWorkflow(request.imageUrl, mode, sender.tab?.id)
        .then(() => {
          sendResponse({ success: true, mode });
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
    });
    return true; // Keep the message channel open for async sendResponse
  }

  if (request.action === 'CONFIG_UPDATED') {
    // Options page notifies us when settings change — nothing to do yet,
    // the next workflow run will pick up fresh values from storage.
    console.log('OpenAssets: Configuration updated by user.');
    return false;
  }

  if (request.action === 'GET_JOB_STATUS') {
    // Popup queries current extraction progress so it can render a live bar
    sendResponse({ job: activeJob });
    return false;
  }

  if (request.action === 'SYNC_TOKEN') {
    chrome.storage.local.set({ jwtToken: request.jwtToken }, () => {
      console.log('OpenAssets: JWT Token synchronized from frontend!');
    });
    return false;
  }
});

// ─── Keyboard Shortcut Command Listener ──────────────────────────────────────
// Forwards the "extract-image" command to the active tab's content script,
// which tracks the last hovered image and can begin extraction from there.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'extract-image') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'EXTRACT_LAST_HOVERED' }).catch(() => {
          // Silently ignore if content script is not injected in the active tab (e.g., chrome:// pages)
        });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core Extraction Workflow
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main entry point for any extraction — regardless of whether it was triggered
 * by context menu, popup button, keyboard shortcut, or content-script message.
 *
 * @param {string} imageUrl    - The source URL of the image to extract assets from
 * @param {string} mode        - 'direct' (auto-pilot) or 'interactive' (canvas editor)
 * @param {number|undefined} tabId - Tab to send progress updates to (may be undefined)
 */
async function startExtractionWorkflow(imageUrl, mode, tabId) {
  // Retrieve full config (sync + session) to get apiUrl, frontendUrl, and JWT
  const settings = await getFullConfig();
  const { apiUrl, frontendUrl } = settings;

  // Mint a fresh access token from the refresh cookie before the pipeline starts.
  // In production this guarantees a valid token up front; in local dev the cookie
  // isn't sent (SameSite=Lax) so this is a no-op and we fall back to the token the
  // content-script localStorage bridge synced into storage.
  await refreshAccessToken(apiUrl);

  try {
    // ── Step 1: Download image from the host page ──────────────────────────
    // Runs in the service worker context, bypassing host-page CORS via host_permissions
    updateActiveJob(null, 'downloading', 'Downloading image data...', 10);
    notifyProgress(tabId, 'Downloading image data...', 10);

    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) {
      throw new Error(`Failed to download image from page (HTTP ${imgResponse.status})`);
    }
    const blob = await imgResponse.blob();

    // Derive a filename from MIME type (fallback to png)
    const fileType = blob.type || 'image/png';
    const extension = fileType.split('/')[1] || 'png';
    const filename = `sheet_${Date.now()}.${extension}`;

    // ── Step 2: Upload image to the OpenAssets backend ─────────────────────
    const formData = new FormData();
    formData.append('image', blob, filename);

    updateActiveJob(null, 'uploading', 'Uploading to OpenAssets engine...', 30);
    notifyProgress(tabId, 'Uploading to OpenAssets engine...', 30);

    const uploadRes = await apiFetch(apiUrl, '/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!uploadRes.ok) {
      const errData = await uploadRes.json().catch(() => ({}));
      throw new Error(errData.message || `Upload failed with status ${uploadRes.status}`);
    }

    const uploadData = await uploadRes.json();
    const jobId = uploadData.data?.jobId;
    if (!jobId) {
      throw new Error('Upload successful but no jobId was returned by backend');
    }

    // ── Step 3: Route based on mode ────────────────────────────────────────
    if (mode === 'interactive') {
      updateActiveJob(jobId, 'interactive', 'Opening canvas editor...', 100);
      notifyProgress(tabId, 'Opening canvas editor...', 100);
      chrome.tabs.create({ url: `${frontendUrl}/editor/${jobId}` });
      activeJob = null; // Job handed off to frontend
      return;
    }

    // ── Step 4: Direct mode — run the full background pipeline ─────────────
    await runBackgroundDirectWorkflow(jobId, apiUrl, tabId);

  } catch (error) {
    console.error('OpenAssets: Extraction flow failed:', error);
    notifyFailure(tabId, error.message);
    activeJob = null; // Clear stale progress on failure
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Direct-Mode Pipeline (full auto-pilot)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Runs the sequential detection → crop → finalize → download pipeline
 * entirely in the background, reporting progress at each stage.
 *
 * @param {string} jobId       - Backend job identifier
 * @param {string} apiUrl      - Base URL for the OpenAssets API
 * @param {number|undefined} tabId - Tab ID for progress notifications
 */
async function runBackgroundDirectWorkflow(jobId, apiUrl, tabId) {

  // ── PIPELINE STEP A: Wait for OpenCV detection ───────────────────────────
  updateActiveJob(jobId, 'detecting', 'Analyzing image sheet layout (AI)...', 50);
  notifyProgress(tabId, 'Analyzing image sheet layout (AI)...', 50);

  const detectionResult = await pollJobUntil(jobId, 'detected', apiUrl, {
    failureMessage: 'OpenCV detection failed',
    timeoutMessage: 'Timeout waiting for OpenCV layout detection'
  });

  // Validate that bounding boxes were actually found
  const boxes = detectionResult.boxes || [];
  if (boxes.length === 0) {
    throw new Error('No individual assets could be detected in this sheet');
  }

  // ── PIPELINE STEP B: Initiate cropping ───────────────────────────────────
  updateActiveJob(jobId, 'cropping', `Layout analyzed! Cropping ${boxes.length} assets...`, 70);
  notifyProgress(tabId, `Layout analyzed! Cropping ${boxes.length} assets...`, 70);

  const cropRes = await apiFetch(apiUrl, '/api/crop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, boxes })
  });

  if (!cropRes.ok) {
    const errData = await cropRes.json().catch(() => ({}));
    throw new Error(errData.message || 'Asset cropping request failed');
  }

  // Poll until cropping completes
  const croppedResult = await pollJobUntil(jobId, 'cropped', apiUrl, {
    failureMessage: 'Asset cropping execution failed',
    timeoutMessage: 'Timeout waiting for assets to be cropped'
  });

  // Validate that assets were generated
  const assets = croppedResult.assets || [];
  if (assets.length === 0) {
    throw new Error('No cropped assets were generated by the pipeline');
  }
  const selectedIds = assets.map((a) => a.id);

  // ── PIPELINE STEP C: Finalize & generate ZIP bundle ──────────────────────
  updateActiveJob(jobId, 'finalizing', 'Bundling & upscaling assets...', 90);
  notifyProgress(tabId, 'Bundling & upscaling assets...', 90);

  const finalizeRes = await apiFetch(apiUrl, '/api/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, selectedIds, skipUpscale: false })
  });

  if (!finalizeRes.ok) {
    const errData = await finalizeRes.json().catch(() => ({}));
    throw new Error(errData.message || 'ZIP generation request failed');
  }

  // Poll until the ZIP is ready for download
  const readyResult = await pollJobUntil(jobId, 'ready', apiUrl, {
    failureMessage: 'Finalization zip bundle failed',
    timeoutMessage: 'Timeout waiting for extraction zip bundle'
  });

  const downloadUrl = readyResult.downloadUrl;
  if (!downloadUrl) {
    throw new Error('Job marked ready but no download URL was provided');
  }

  // ── PIPELINE STEP D: Trigger browser download ────────────────────────────
  updateActiveJob(jobId, 'downloading', 'Downloading zip bundle...', 100);
  notifyProgress(tabId, 'Downloading zip bundle...', 100);

  chrome.downloads.download(
    {
      url: downloadUrl,
      filename: `open_assets_${jobId}.zip`,
      saveAs: false
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('OpenAssets: Download failed:', chrome.runtime.lastError);
        // Fallback: open the download URL directly in a new tab
        chrome.tabs.create({ url: downloadUrl });
      }

      // Show a system notification on completion
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'OpenAssets Extraction Complete!',
        message: `Successfully extracted ${assets.length} assets into open_assets_${jobId}.zip`,
        priority: 2
      });

      // Notify the content script so it can dismiss any overlay
      chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_COMPLETE' }).catch(() => {});

      // Job is done — clear the active progress tracker
      activeJob = null;
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reusable Job Polling Function
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generic polling helper that replaces the 3 duplicated while-loops in the
 * original code. Polls GET /api/jobs/:jobId until the job reaches
 * `targetStatus` or 'failed', whichever comes first.
 *
 * @param {string} jobId          - The backend job identifier to poll
 * @param {string} targetStatus   - The status string we're waiting for (e.g. 'detected', 'cropped', 'ready')
 * @param {string} apiUrl         - Base URL for the OpenAssets API
 * @param {Object} [options]      - Optional tuning parameters
 * @param {number} [options.maxPolls=60]    - Max number of poll iterations (~2 min at default interval)
 * @param {number} [options.intervalMs=2000] - Milliseconds between each poll request
 * @param {string} [options.failureMessage]  - Error message when job status becomes 'failed'
 * @param {string} [options.timeoutMessage]  - Error message when maxPolls is exceeded
 * @returns {Promise<Object>} The job data object once targetStatus is reached
 * @throws {Error} If the job fails or polling times out
 */
async function pollJobUntil(jobId, targetStatus, apiUrl, options = {}) {
  const maxPolls = options.maxPolls || 60;
  const intervalMs = options.intervalMs || 2000;
  const failureMessage = options.failureMessage || `Job failed while waiting for "${targetStatus}"`;
  const timeoutMessage = options.timeoutMessage || `Timeout waiting for job to reach "${targetStatus}"`;

  let pollCount = 0;
  let jobData = null;
  let currentStatus = null;

  while (currentStatus !== targetStatus && currentStatus !== 'failed' && pollCount < maxPolls) {
    await delay(intervalMs);
    pollCount++;

    try {
      const res = await apiFetch(apiUrl, `/api/jobs/${jobId}`);

      // Silently retry on transient HTTP errors
      if (!res.ok) continue;

      const data = await res.json();
      jobData = data.data;
      currentStatus = jobData.status;

      if (currentStatus === 'failed') {
        throw new Error(jobData.error || failureMessage);
      }
    } catch (err) {
      // Re-throw explicit failures, but swallow network glitches to allow retries
      if (err.message && (err.message.includes(failureMessage) || err.message === (jobData?.error))) {
        throw err;
      }
      // Otherwise continue polling — transient network issues shouldn't kill the job
    }
  }

  if (currentStatus !== targetStatus) {
    throw new Error(timeoutMessage);
  }

  return jobData;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Update the module-scope activeJob tracker so the popup can query progress.
 *
 * @param {string|null} jobId      - Backend job ID (null before upload completes)
 * @param {string}      status     - Current pipeline stage key
 * @param {string}      statusText - Human-readable description for the UI
 * @param {number}      percent    - Progress percentage (0–100)
 */
function updateActiveJob(jobId, status, statusText, percent) {
  activeJob = { jobId, status, statusText, percent };
}

/**
 * Send a progress update to the content script overlay in the active tab.
 * Silently fails if the tab no longer exists (e.g. user closed it).
 *
 * @param {number|undefined} tabId      - Target tab ID
 * @param {string}           statusText - Progress message
 * @param {number}           percent    - Progress percentage (0–100)
 */
function notifyProgress(tabId, statusText, percent) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'EXTRACT_PROGRESS',
      statusText,
      percent
    }).catch(() => {});
  }
}

/**
 * Notify the content script and show a system notification when extraction fails.
 *
 * @param {number|undefined} tabId    - Target tab ID
 * @param {string}           errorMsg - The error description
 */
function notifyFailure(tabId, errorMsg) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'EXTRACT_FAILED',
      error: errorMsg
    }).catch(() => {});
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Extraction Failed',
    message: errorMsg,
    priority: 2
  });
}

/**
 * Simple promise-based delay helper.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
