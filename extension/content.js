(function () {
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
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(79, 70, 229, 0.95));
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      color: #ffffff;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, opacity 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px) scale(0.95);
    }

    .open-assets-extract-btn.visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    .open-assets-extract-btn:hover {
      transform: scale(1.05);
      background: linear-gradient(135deg, rgba(79, 70, 229, 0.98), rgba(67, 56, 202, 0.98));
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
    }

    .open-assets-extract-btn:active {
      transform: scale(0.98);
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
      background: rgba(11, 15, 25, 0.85);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 14px 18px;
      color: #f3f4f6;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      gap: 12px;
      transform: translateY(20px) scale(0.95);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: auto;
    }

    .open-assets-toast.active {
      transform: translateY(0) scale(1);
      opacity: 1;
    }

    .open-assets-toast .toast-icon {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .open-assets-toast.info .toast-icon {
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
    }

    .open-assets-toast.success .toast-icon {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
    }

    .open-assets-toast.error .toast-icon {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
    }

    .open-assets-toast-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(99, 102, 241, 0.2);
      border-top-color: #818cf8;
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
      background: rgba(255, 255, 255, 0.08);
      border: none;
      border-radius: 50%;
      color: #9ca3af;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
      padding: 0;
    }

    .toast-dismiss:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #f3f4f6;
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
