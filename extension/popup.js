/**
 * OpenAssets Extension — Popup Script
 * 
 * Handles: authentication state, mode selection, real-time progress tracking,
 * collection listing with deep-links, and sign-out functionality.
 * 
 * Dependencies: config.js (loaded before this via <script> tag in popup.html)
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ─── 1. Load Configuration ─────────────────────────────
  const config = await getFullConfig();
  const { apiUrl, frontendUrl } = config;

  // ─── 2. Setup Mode Selection ───────────────────────────
  const modeDirectRadio = document.getElementById('modeDirect');
  const modeInteractiveRadio = document.getElementById('modeInteractive');
  const modeDesc = document.getElementById('modeDesc');

  if (config.mode === 'interactive') {
    modeInteractiveRadio.checked = true;
    updateModeDescription('interactive');
  } else {
    modeDirectRadio.checked = true;
    updateModeDescription('direct');
  }

  modeDirectRadio.addEventListener('change', () => {
    chrome.storage.sync.set({ mode: 'direct' });
    updateModeDescription('direct');
  });

  modeInteractiveRadio.addEventListener('change', () => {
    chrome.storage.sync.set({ mode: 'interactive' });
    updateModeDescription('interactive');
  });

  function updateModeDescription(mode) {
    if (mode === 'interactive') {
      modeDesc.textContent = 'Interactive Mode uploads your sheet and instantly opens the web editor for manual box refinement.';
    } else {
      modeDesc.textContent = 'Direct ZIP automatically segments, crops, upscales, and downloads your sheet assets in the background.';
    }
  }

  // ─── 3. Sign In Button ─────────────────────────────────
  document.getElementById('signInBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: `${frontendUrl}/login` });
  });

  // ─── 4. Sign Out Button ────────────────────────────────
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    // Clear JWT from local storage
    await chrome.storage.local.remove('jwtToken');
    
    // Reset UI to guest state
    displayGuestUser();
    
    // Clear collections
    document.getElementById('collectionsList').innerHTML = `
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <p>No recent collections found.</p>
      </div>`;
    document.getElementById('collectionsCount').textContent = '0';
  });

  // ─── 5. Authenticate & Load Profile ────────────────────
  // Mint a fresh access token from the refresh cookie (prod). In dev this is a
  // no-op and we rely on the token the content-script bridge synced to storage.
  await refreshAccessToken(apiUrl);
  // Did we end up with any token at all (minted or bridged)?
  const { jwtToken: activeToken } = await getFullConfig();

  try {
    const meRes = await apiFetch(apiUrl, '/api/auth/me');

    if (!meRes.ok) {
      displayGuestUser();
      if (activeToken) {
        const msg = meRes.status === 401
          ? 'Session expired. Visit the site to refresh.'
          : 'Could not verify authentication. Server may be unavailable.';
        showError(msg);
      }
    } else {
      const meData = await meRes.json();
      const user = meData.data?.user || meData.data || meData;

      if (user && user.email) {
        displayAuthenticatedUser(user);
        loadRecentCollections(apiUrl, frontendUrl);
      } else {
        displayGuestUser();
      }
    }
  } catch (err) {
    console.warn('Authentication check failed:', err.message);
    displayGuestUser();
    if (activeToken) {
      showError('Could not connect to server.');
    }
  }

  // ─── 6. Auto-refresh popup when token changes ──────────
  // Fires when the content script syncs a new JWT (e.g. user just signed in
  // on the frontend while this popup was already open).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'jwtToken' in changes) {
      window.location.reload();
    }
  });

  // ─── 7. Check Active Job Progress ──────────────────────
  checkActiveJobProgress();

  // ─── 8. Listen for Real-Time Progress Updates ──────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'EXTRACT_PROGRESS') {
      showProgress(message.statusText, message.percent);
    } else if (message.action === 'EXTRACT_COMPLETE') {
      showProgressComplete();
    } else if (message.action === 'EXTRACT_FAILED') {
      showProgressFailed(message.error || 'Extraction failed');
    }
  });
});


// ─── UI State Helpers ──────────────────────────────────────

function displayAuthenticatedUser(user) {
  document.getElementById('guestState').style.display = 'none';
  const userState = document.getElementById('userState');
  userState.style.display = 'flex';

  const name = user.name || 'Developer';
  const email = user.email || '';
  
  document.getElementById('userName').textContent = name;
  document.getElementById('userEmail').textContent = email;
  document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
}

function displayGuestUser() {
  document.getElementById('guestState').style.display = 'block';
  document.getElementById('userState').style.display = 'none';
}

function showError(message) {
  const errorState = document.getElementById('errorState');
  document.getElementById('errorMessage').textContent = message;
  errorState.style.display = 'flex';
}

function hideError() {
  document.getElementById('errorState').style.display = 'none';
}


// ─── Progress Tracking ─────────────────────────────────────

function showProgress(statusText, percent) {
  const section = document.getElementById('activeJobSection');
  const card = section.querySelector('.progress-card');
  
  section.style.display = 'flex';
  card.className = 'progress-card'; // Reset state classes
  
  document.getElementById('progressLabel').textContent = 'Extracting...';
  document.getElementById('progressPercent').textContent = `${percent}%`;
  document.getElementById('progressFill').style.width = `${percent}%`;
  document.getElementById('progressText').textContent = statusText;
}

function showProgressComplete() {
  const section = document.getElementById('activeJobSection');
  const card = section.querySelector('.progress-card');
  
  section.style.display = 'flex';
  card.className = 'progress-card completed';
  
  document.getElementById('progressLabel').textContent = 'Complete!';
  document.getElementById('progressPercent').textContent = '100%';
  document.getElementById('progressFill').style.width = '100%';
  document.getElementById('progressText').textContent = 'Assets extracted & ZIP downloaded successfully.';
  
  // Auto-hide after 8 seconds
  setTimeout(() => {
    section.style.display = 'none';
  }, 8000);
}

function showProgressFailed(errorMsg) {
  const section = document.getElementById('activeJobSection');
  const card = section.querySelector('.progress-card');
  
  section.style.display = 'flex';
  card.className = 'progress-card failed';
  
  document.getElementById('progressLabel').textContent = 'Failed';
  document.getElementById('progressPercent').textContent = '';
  document.getElementById('progressText').textContent = errorMsg;
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    section.style.display = 'none';
  }, 10000);
}

/**
 * Query the background script for any currently active job when popup opens.
 */
function checkActiveJobProgress() {
  chrome.runtime.sendMessage({ action: 'GET_JOB_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    
    if (response.job) {
      const { statusText, percent, status } = response.job;
      if (status === 'complete') {
        showProgressComplete();
      } else if (status === 'failed') {
        showProgressFailed(statusText || 'Extraction failed');
      } else {
        showProgress(statusText || 'Processing...', percent || 0);
      }
    }
  });
}


// ─── Collections ───────────────────────────────────────────

async function loadRecentCollections(apiUrl, frontendUrl) {
  const listEl = document.getElementById('collectionsList');
  const countEl = document.getElementById('collectionsCount');

  try {
    const res = await apiFetch(apiUrl, '/api/collections/mine');

    if (!res.ok) throw new Error('Failed to fetch collections');

    const result = await res.json();
    const collections = result.data || result;

    if (Array.isArray(collections) && collections.length > 0) {
      countEl.textContent = collections.length;
      listEl.innerHTML = ''; // Clear empty state
      
      // Show top 5 collections
      collections.slice(0, 5).forEach((col) => {
        const item = document.createElement('div');
        item.className = 'collection-item';
        
        // Count total assets in collection
        let assetCount = 0;
        if (col.folders) {
          col.folders.forEach(f => {
            if (f.images) assetCount += f.images.length;
          });
        }

        item.innerHTML = `
          <div class="collection-details">
            <div class="collection-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="collection-name-container">
              <div class="collection-name">${escapeHtml(col.name)}</div>
              <div class="collection-meta">${assetCount} cropped assets</div>
            </div>
          </div>
          <div class="collection-action">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </div>
        `;
        
        // Deep-link to specific collection
        item.addEventListener('click', () => {
          const collectionId = col.id || col._id;
          if (collectionId) {
            chrome.tabs.create({ url: `${frontendUrl}/collections/${collectionId}` });
          } else {
            chrome.tabs.create({ url: `${frontendUrl}/collections` });
          }
        });
        
        listEl.appendChild(item);
      });
    }
  } catch (err) {
    console.error('Error loading collections in popup:', err);
    // Show a subtle error state in the collections area
    listEl.innerHTML = `
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <p>Could not load collections.</p>
      </div>`;
  }
}
