# OpenAssets Extension — Full Overhaul

Complete rewrite/refactor of the Chrome extension based on 13 resolved design decisions.

## Proposed Changes

### Component 1: Project Structure & Rename

Rename `extention/` → `extension/` and reorganize the file structure.

#### Final file structure:
```
extension/
├── manifest.json          [MODIFY] — permissions, commands, CSP
├── config.js              [NEW] — shared DEFAULT_CONFIG + storage helpers
├── background.js          [MODIFY] — use config.js, extract poll helper, session storage for JWT
├── content.js             [MODIFY] — Shadow DOM, fixed positioning, bg-image/picture detection
├── content.css            [MODIFY] — styles moved inside Shadow DOM
├── popup.html             [MODIFY] — add progress section, sign-out btn, load config.js + common.css
├── popup.js               [MODIFY] — use config.js, progress UI, sign-out, deep-links
├── popup.css              [MODIFY] — add progress/sign-out styles, remove shared tokens
├── common.css             [NEW] — shared design tokens (:root variables)
├── options.html           [MODIFY] — external CSS, load config.js + common.css, validation UI
├── options.js             [MODIFY] — use config.js, URL validation, session storage for JWT
├── options.css            [NEW] — extracted from inline <style>
└── icons/
    ├── icon16.png         (TODO: user to provide)
    ├── icon48.png         (TODO: user to provide)
    └── icon128.png        (TODO: user to provide)
```

---

### Component 2: Shared Config Module

#### [NEW] [config.js](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extension/config.js)

Single source of truth for defaults and storage access patterns:

```js
const DEFAULT_CONFIG = {
  apiUrl: 'https://openasset-backend.anands.dev',
  frontendUrl: 'https://openassets.anands.dev',
  mode: 'direct'
};

// Sync storage: URLs + mode (persists across sessions, syncs across devices)
// Session storage: jwtToken (memory-only, most secure)

async function getFullConfig() { /* merge sync + session */ }
async function getAuthHeaders() { /* read JWT from session storage */ }
function isValidUrl(str) { /* http/https validation */ }
```

- `background.js` loads via `importScripts('config.js')`
- `popup.html` and `options.html` load via `<script src="config.js"></script>` before their own scripts

---

### Component 3: Security & Permissions

#### [MODIFY] [manifest.json](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/manifest.json)

| Change | Before | After |
|--------|--------|-------|
| Remove `cookies` permission | `["activeTab", "contextMenus", "storage", "cookies", "notifications", "downloads"]` | `["activeTab", "contextMenus", "storage", "notifications", "downloads"]` |
| Narrow content scripts | `"matches": ["<all_urls>"]` | `"matches": ["http://*/*", "https://*/*"]` |
| Add keyboard command | _(none)_ | `"commands": { "extract-image": { ... } }` |

#### JWT storage migration

- **Before**: `chrome.storage.sync.set({ jwtToken })` — synced to Google cloud
- **After**: `chrome.storage.session.set({ jwtToken })` — memory-only, clears on restart
- Non-secret settings (apiUrl, frontendUrl, mode) remain in `chrome.storage.sync`

#### URL validation in options.js

- Validate API URL and Frontend URL start with `http://` or `https://`
- Show inline red error message below the input if invalid
- Disable save button until all inputs are valid

---

### Component 4: Content Script — Shadow DOM + Enhanced Detection

#### [MODIFY] [content.js](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/content.js)

**Shadow DOM isolation**:
```js
// Create isolated container
const host = document.createElement('open-assets-host');
const shadow = host.attachShadow({ mode: 'closed' });

// Inject styles directly into shadow root (content.css content)
const style = document.createElement('style');
style.textContent = `/* all content.css rules, but without !important */`;
shadow.appendChild(style);

// Button and toast live inside shadow DOM
shadow.appendChild(hoverBtn);
shadow.appendChild(toastEl);
document.body.appendChild(host);
```

**Positioning fix** — switch to `position: fixed`:
```js
function positionButton(img) {
  const rect = img.getBoundingClientRect();
  if (rect.width < 100 || rect.height < 100) return hideButton();
  
  btn.style.position = 'fixed';
  btn.style.top = `${rect.top + 10}px`;
  btn.style.left = `${rect.left + rect.width - btn.offsetWidth - 10}px`;
}
```

**Enhanced image detection** — add `background-image` and `<picture>` support:
```js
document.addEventListener('mouseover', (e) => {
  const target = e.target;
  
  // 1. Standard <img>
  if (target.tagName === 'IMG') { ... }
  
  // 2. <picture> → find the active <img> inside
  if (target.tagName === 'PICTURE') {
    const img = target.querySelector('img');
    if (img) { ... }
  }
  
  // 3. CSS background-image
  const bgImage = getComputedStyle(target).backgroundImage;
  if (bgImage && bgImage !== 'none') {
    const urlMatch = bgImage.match(/url\(["']?(.*?)["']?\)/);
    if (urlMatch) { ... }
  }
}, true);
```

#### [MODIFY] [content.css](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/content.css)

- Remove all `!important` declarations (Shadow DOM provides isolation)
- Styles will be injected as a string inside the shadow root, not loaded as a content script CSS
- Remove `content.css` from `manifest.json` content_scripts (injected programmatically instead)

---

### Component 5: Background Service Worker Refactor

#### [MODIFY] [background.js](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/background.js)

**Extract reusable poll helper** (replaces 3 copy-pasted loops):
```js
async function pollJobUntil(jobId, targetStatus, apiUrl, authHeaders, options = {}) {
  const { maxPolls = 60, intervalMs = 2000, onProgress } = options;
  let pollCount = 0;
  
  while (pollCount < maxPolls) {
    await delay(intervalMs);
    pollCount++;
    
    const res = await fetch(`${apiUrl}/api/jobs/${jobId}`, {
      headers: authHeaders,
      credentials: 'include'
    });
    if (!res.ok) continue;
    
    const data = await res.json();
    const jobData = data.data;
    
    if (jobData.status === 'failed') {
      throw new Error(jobData.error || `Job failed at stage: ${targetStatus}`);
    }
    if (jobData.status === targetStatus) {
      return jobData;
    }
    if (onProgress) onProgress(jobData);
  }
  
  throw new Error(`Timeout waiting for status: ${targetStatus}`);
}
```

**Keyboard shortcut handler**:
```js
chrome.commands.onCommand.addListener((command) => {
  if (command === 'extract-image') {
    // Send message to content script to extract the last hovered image
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'EXTRACT_LAST_HOVERED' });
    });
  }
});
```

**Use `config.js`**: Replace local `DEFAULT_CONFIG` and `getAuthHeaders()` with shared imports.

---

### Component 6: Popup UI Enhancements

#### [MODIFY] [popup.html](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/popup.html)

Add three new sections:

1. **Active job progress section** (between auth card and mode selector):
```html
<section id="activeJobSection" class="section" style="display: none;">
  <h3>Active Extraction</h3>
  <div class="progress-card">
    <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
    <p class="progress-text" id="progressText">Processing...</p>
  </div>
</section>
```

2. **Sign-out button** inside `#userState`:
```html
<button id="signOutBtn" class="secondary-btn" title="Sign out">Sign out</button>
```

3. **Remove hardcoded placeholder values**:
- `<div class="user-name" id="userName"></div>` (was "Anand S.")
- `<div class="user-email" id="userEmail"></div>` (was "anand@example.com")
- `<div class="user-avatar" id="userAvatar"></div>` (was "A")

#### [MODIFY] [popup.js](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/popup.js)

- **Progress tracking**: Listen for `chrome.runtime.onMessage` with `EXTRACT_PROGRESS` / `EXTRACT_COMPLETE` / `EXTRACT_FAILED` actions. Update the progress bar and text in real-time.
- **Sign-out**: Clear JWT from `chrome.storage.session`, reset UI to guest state.
- **Deep-link collections**: Change `${frontendUrl}/collections` → `${frontendUrl}/collections/${col.id}`.
- **Use shared `config.js`**: Remove duplicated defaults.
- **Error handling**: Show an error state card if `/api/auth/me` or `/api/collections/mine` fails (instead of silently falling through).

---

### Component 7: Options Page Refactor

#### [MODIFY] [options.html](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/options.html)

- Remove all inline `<style>` content (~150 lines)
- Add `<link rel="stylesheet" href="common.css">` and `<link rel="stylesheet" href="options.css">`
- Add `<script src="config.js"></script>` before `<script src="options.js">`
- Add inline validation error `<span>` elements below URL inputs
- Mark the JWT field with a note: _"Stored securely in memory only. You'll need to re-enter this after restarting Chrome."_

#### [NEW] [options.css](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extension/options.css)

Extracted from the inline styles, minus the shared `:root` tokens (those go in `common.css`).

#### [MODIFY] [options.js](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extention/options.js)

- Use shared `config.js` functions
- Save JWT to `chrome.storage.session` instead of `chrome.storage.sync`
- Add real-time URL validation with `isValidUrl()` from `config.js`
- Disable save button and show red error if URLs are invalid

---

### Component 8: Shared CSS Design Tokens

#### [NEW] [common.css](file:///c:/Users/Dell/OneDrive/Desktop/Projects at github/open_assets/extension/common.css)

```css
:root {
  --bg-color: #0b0f19;
  --card-bg: rgba(255, 255, 255, 0.03);
  --card-border: rgba(255, 255, 255, 0.08);
  --text-primary: #f3f4f6;
  --text-secondary: #9ca3af;
  --primary-color: #6366f1;
  --primary-hover: #4f46e5;
  --input-bg: rgba(255, 255, 255, 0.05);
  --input-border: rgba(255, 255, 255, 0.1);
  --input-focus: #818cf8;
  --success-color: #10b981;
  --error-color: #ef4444;
}

/* Shared base resets, font import, body defaults */
```

Both `popup.css` and `options.css` will import this via HTML `<link>` tags rather than duplicating the tokens.

---

## Verification Plan

### Manual Verification
1. **Load unpacked extension** in `chrome://extensions` from the new `extension/` folder
2. **Popup test**: Open popup → verify guest state (no hardcoded names) → sign in → verify profile + collections load → verify sign-out works
3. **Hover button test**: Hover over `<img>`, `<picture>`, and `background-image` elements → button appears in correct position → click triggers extraction
4. **Shadow DOM test**: Visit a page with aggressive CSS resets → verify button/toast render correctly
5. **Progress test**: Trigger an extraction → verify progress bar updates in popup
6. **Keyboard shortcut test**: Press `Alt+Shift+E` → verify extraction triggers
7. **Options test**: Enter invalid URL → verify error shown → enter valid URL → save → verify JWT stored in session storage
8. **Security test**: Check `chrome.storage.sync` does NOT contain JWT after saving → check `chrome.storage.session` does contain it

> [!IMPORTANT]
> Icon files are still TODO stubs. The user will provide real icons separately.
