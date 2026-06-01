(function () {
  // ─── Token Sync Feature ───
  // If the content script is running on the OpenAssets frontend, automatically sync the token to extension storage!
  try {
    const isFrontend = window.location.hostname === 'localhost' || window.location.hostname.endsWith('.anands.dev');
    if (isFrontend) {
      function syncToken(jwt) {
        // Write directly to storage — avoids chrome.runtime.sendMessage which
        // silently fails when the content script context is invalidated after
        // an extension reload on an already-open tab.
        chrome.storage.local.set({ jwtToken: jwt || '' }).catch(() => {});
      }

      // Track last synced value to avoid redundant messages.
      let lastSeen = undefined;

      function checkAndSync() {
        const t = localStorage.getItem('accessToken');
        if (t !== lastSeen) {
          lastSeen = t;
          syncToken(t);
        }
      }

      // 1. Immediate read on page load.
      checkAndSync();

      // 2. Indefinite polling every 2 s — catches restoreSession() completing
      //    async AND manual login no matter how long the user takes to type.
      //    localStorage reads are in-memory and essentially free.
      setInterval(checkAndSync, 2000);

      // 3. CustomEvent — fired by token-store.ts once the frontend change is
      //    deployed. Instant same-tab notification for login / logout / OAuth.
      window.addEventListener('openassets:token', (e) => {
        lastSeen = e.detail;
        syncToken(e.detail);
      });

      // 4. Cross-tab fallback — storage event fires when another tab writes.
      window.addEventListener('storage', (e) => {
        if (e.key === 'accessToken') {
          lastSeen = e.newValue;
          syncToken(e.newValue);
        }
      });
    }
  } catch (err) {
    // Gracefully handle context invalidation errors
  }

  // ──────────────────────────────────────────────────────────────────────────
  // State
  // ──────────────────────────────────────────────────────────────────────────
  let activeImage = null;      // DOM element reference of the hovered image / bg-image element
  let activeImageUrl = null;   // Resolved URL string for the detected image
  let hoverBtn = null;
  let hideTimeout = null;
  let toastEl = null;
  let toastTimeout = null;

  // ──────────────────────────────────────────────────────────────────────────
  // Shadow DOM host – isolates our UI from page styles
  // ──────────────────────────────────────────────────────────────────────────
  const host = document.createElement('open-assets-host');
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(host);

  // ──────────────────────────────────────────────────────────────────────────
  // Inject styles into shadow root (no !important needed – Shadow DOM isolates)
  // ──────────────────────────────────────────────────────────────────────────
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    .open-assets-extract-btn {
      position: fixed;
      z-index: 1000000000;
      background: var(--primary-color, #ff7c00);
      border: 1px solid var(--primary-color, #ff7c00);
      border-radius: 0px; /* Sharp brutalist */
      color: #000000;
      font-family: 'Roboto Mono', 'Fira Code', 'Courier New', Courier, monospace;
      font-size: 11px;
      font-weight: 700;
      padding: 6px 14px;
      cursor: pointer;
      box-shadow: 3px 3px 0px rgba(255, 124, 0, 0.2);
      transition: opacity 0.15s ease, transform 0.1s ease, box-shadow 0.1s ease;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .open-assets-extract-btn.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .open-assets-extract-btn:hover {
      transform: translate(-1px, -1px);
      background: var(--primary-hover, #e06d00);
      border-color: var(--primary-hover, #e06d00);
      box-shadow: 4px 4px 0px rgba(255, 124, 0, 0.35);
    }

    .open-assets-extract-btn:active {
      transform: translate(1px, 1px);
      box-shadow: 1px 1px 0px rgba(255, 124, 0, 0.2);
    }

    .open-assets-extract-btn svg {
      width: 13px;
      height: 13px;
      stroke: currentColor;
    }

    /* Toast Alerts */
    .open-assets-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1000000001;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 0px; /* Sharp brutalist */
      padding: 14px 18px;
      color: #fafafa;
      font-family: 'Roboto Mono', 'Fira Code', 'Courier New', Courier, monospace;
      font-size: 12px;
      box-shadow: 4px 4px 0px rgba(255, 124, 0, 0.15);
      display: flex;
      align-items: center;
      gap: 12px;
      transform: translateY(20px);
      opacity: 0;
      transition: all 0.2s ease;
      pointer-events: auto;
    }

    .open-assets-toast.active {
      transform: translateY(0);
      opacity: 1;
    }

    .open-assets-toast .toast-icon {
      width: 18px;
      height: 18px;
      border-radius: 0px; /* Sharp brutalist */
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-weight: 700;
      border: 1px solid currentColor;
    }

    .open-assets-toast.info .toast-icon {
      background: rgba(255, 124, 0, 0.1);
      color: #ff7c00;
    }

    .open-assets-toast.success .toast-icon {
      background: rgba(0, 255, 102, 0.1);
      color: #00ff66;
    }

    .open-assets-toast.error .toast-icon {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }

    .open-assets-toast-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 124, 0, 0.2);
      border-top-color: #ff7c00;
      border-radius: 50%;
      animation: open-assets-spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    /* Dismiss / close button */
    .toast-dismiss {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 20px;
      height: 20px;
      background: rgba(255, 124, 0, 0.08);
      border: 1px solid rgba(255, 124, 0, 0.2);
      border-radius: 0px; /* Sharp brutalist */
      color: #ff7c00;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.1s ease;
      padding: 0;
      font-family: 'Roboto Mono', monospace;
      font-weight: 700;
    }

    .toast-dismiss:hover {
      background: #ff7c00;
      color: #000000;
      border-color: #ff7c00;
    }

    @keyframes open-assets-spin {
      to { transform: rotate(360deg); }
    }
  `;
  shadow.appendChild(styleSheet);

  // ──────────────────────────────────────────────────────────────────────────
  // Hover Button
  // ──────────────────────────────────────────────────────────────────────────

  /** Creates (or returns existing) hover button inside the shadow root. */
  function createHoverButton() {
    if (hoverBtn) return hoverBtn;

    hoverBtn = document.createElement('button');
    hoverBtn.className = 'open-assets-extract-btn';
    hoverBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      Extract Assets
    `;

    // Append to shadow root (not document.body)
    shadow.appendChild(hoverBtn);

    // Keep the button visible while the cursor is over it
    hoverBtn.addEventListener('mouseenter', () => {
      if (hideTimeout) clearTimeout(hideTimeout);
    });

    hoverBtn.addEventListener('mouseleave', () => {
      scheduleHide();
    });

    hoverBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (activeImageUrl) {
        triggerImageExtraction();
      }
    });

    return hoverBtn;
  }

  /**
   * Position the button over the detected image element using fixed positioning.
   * No scroll-offset math needed since both the button and getBoundingClientRect
   * are relative to the viewport.
   */
  function positionButton(el, rect) {
    const btn = createHoverButton();

    // Ignore elements smaller than 100×100 (icons, trackers, spacer GIFs)
    if (rect.width < 100 || rect.height < 100) {
      hideButton();
      return;
    }

    btn.style.top = `${rect.top + 10}px`;
    btn.style.left = `${rect.left + rect.width - btn.offsetWidth - 10}px`;
    btn.style.pointerEvents = 'auto';
    btn.classList.add('visible');
  }

  function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      hideButton();
    }, 800); // Give the user plenty of leeway to move mouse to the button
  }

  function hideButton() {
    if (hoverBtn) {
      hoverBtn.classList.remove('visible');
      hoverBtn.style.pointerEvents = 'none';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Enhanced Image Detection
  // ──────────────────────────────────────────────────────────────────────────

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (!target || target === document.documentElement || target === document.body) return;

    let detectedUrl = null;
    let detectedEl = null;

    // 1. Direct <img> tag
    if (target.tagName === 'IMG' && target.src) {
      detectedUrl = target.src;
      detectedEl = target;
    }

    // 2. <picture> element – find the <img> inside it
    if (!detectedUrl) {
      if (target.tagName === 'PICTURE') {
        const innerImg = target.querySelector('img');
        if (innerImg && innerImg.src) {
          detectedUrl = innerImg.src;
          detectedEl = innerImg;
        }
      } else {
        // Target might be a child of <picture> (e.g. <source>)
        const pictureParent = target.closest('picture');
        if (pictureParent) {
          const innerImg = pictureParent.querySelector('img');
          if (innerImg && innerImg.src) {
            detectedUrl = innerImg.src;
            detectedEl = innerImg;
          }
        }
      }
    }

    // 3. CSS background-image (only for elements ≥ 100×100)
    if (!detectedUrl) {
      const bgImage = getComputedStyle(target).backgroundImage;
      if (bgImage && bgImage !== 'none') {
        const match = bgImage.match(/url\(["']?(.*?)["']?\)/);
        if (match && match[1]) {
          const rect = target.getBoundingClientRect();
          if (rect.width >= 100 && rect.height >= 100) {
            detectedUrl = match[1];
            detectedEl = target;
          }
        }
      }
    }

    // Activate if a valid image was detected
    if (detectedUrl && detectedEl) {
      activeImage = detectedEl;
      activeImageUrl = detectedUrl;
      if (hideTimeout) clearTimeout(hideTimeout);
      positionButton(detectedEl, detectedEl.getBoundingClientRect());
    }
  }, true);

  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    if (!target) return;

    // Schedule hide for any element we may have been tracking
    if (
      target === activeImage ||
      target.tagName === 'IMG' ||
      target.closest('picture')
    ) {
      scheduleHide();
    }
  }, true);

  // ──────────────────────────────────────────────────────────────────────────
  // Extraction
  // ──────────────────────────────────────────────────────────────────────────

  /** Send the resolved image URL to the background script to begin processing. */
  function triggerImageExtraction() {
    if (!activeImageUrl) {
      showToast('No valid image URL found', 'error');
      return;
    }

    showToast('Initializing OpenAssets AI...', 'info', true);

    chrome.runtime.sendMessage({
      action: 'EXTRACT_IMAGE',
      imageUrl: activeImageUrl
    }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Background connection failed', 'error');
        return;
      }

      if (response && response.success) {
        if (response.mode === 'interactive') {
          showToast('Redirecting to canvas editor...', 'success');
        } else {
          showToast('Extraction queued! Processing background...', 'success');
        }
      } else {
        showToast((response && response.error) || 'Failed to start extraction', 'error');
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Toast Notifications (inside shadow root)
  // ──────────────────────────────────────────────────────────────────────────

  function showToast(message, type = 'info', persist = false) {
    if (toastTimeout) clearTimeout(toastTimeout);

    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'open-assets-toast';
      // Append to shadow root (not document.body)
      shadow.appendChild(toastEl);
    }

    let iconHtml = '';
    if (persist) {
      iconHtml = '<div class="open-assets-toast-spinner"></div>';
    } else if (type === 'success') {
      iconHtml = `
        <div class="toast-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>`;
    } else if (type === 'error') {
      iconHtml = `
        <div class="toast-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </div>`;
    } else {
      iconHtml = `
        <div class="toast-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </div>`;
    }

    // Dismiss (close) button
    const dismissHtml = `<button class="toast-dismiss" aria-label="Dismiss">&times;</button>`;

    toastEl.className = `open-assets-toast active ${type}`;
    toastEl.style.position = 'relative'; // needed for absolute-positioned dismiss button
    toastEl.innerHTML = `${iconHtml}<span>${message}</span>${dismissHtml}`;

    // Wire up dismiss button
    const dismissBtn = toastEl.querySelector('.toast-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        if (toastTimeout) clearTimeout(toastTimeout);
        toastEl.classList.remove('active');
      });
    }

    if (!persist) {
      toastTimeout = setTimeout(() => {
        toastEl.classList.remove('active');
      }, 3500);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Message Listeners (background → content)
  // ──────────────────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    // Progress updates during extraction
    if (message.action === 'EXTRACT_PROGRESS') {
      showToast(message.statusText, 'info', true);
    }

    // Extraction finished successfully
    else if (message.action === 'EXTRACT_COMPLETE') {
      showToast('Assets extracted & ZIP downloaded!', 'success');
    }

    // Extraction failed
    else if (message.action === 'EXTRACT_FAILED') {
      showToast(message.error || 'Extraction failed', 'error');
    }

    // Keyboard shortcut: extract the last hovered image immediately
    else if (message.action === 'EXTRACT_LAST_HOVERED') {
      if (activeImageUrl) {
        triggerImageExtraction();
      } else {
        showToast('Hover over an image first', 'error');
      }
    }
  });

})();
