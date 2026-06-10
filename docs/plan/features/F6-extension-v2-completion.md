# F6 — Extension v2 Completion

> **Theme C · Become a destination.** The Chrome extension overhaul
> ([`implementat.md`](../../implementat.md)) is ~90% delivered. Close the
> remaining gaps (live progress is non-functional, JWT storage drifted from spec,
> icons are stubs), then extend it: extract-to-collection and batch extract.
>
> **Priority:** P1 for the completion fixes (FX-08), P2/P3 for the rest · **Effort:** M · **Depends on:** FX-05 decision (server download route) for the download UX; benefits from F1's collection-save patterns.

---

## 1. Problem

The overhaul plan in `implementat.md` is mostly done — Shadow DOM isolation,
shared `config.js`, `pollJobUntil` helper, keyboard command, sign-out, deep-links,
options validation are all real. But three things are wrong or unfinished, and the
extension can do less than the web app:

1. **Live progress is non-functional (FX-08, P1).** `background.js:407-437` sends
   `EXTRACT_PROGRESS/COMPLETE/FAILED` via `chrome.tabs.sendMessage(tabId, …)` —
   that reaches the **content script**, not the popup's `chrome.runtime.onMessage`
   listener (`popup.js:120-128`). The popup's progress bar (built, popup.html:52-65)
   never updates during a run; it only reflects state via a one-shot
   `GET_JOB_STATUS` query when opened.

2. **JWT storage drifted from the security spec (FX-14, P2).** `config.js:9` (and
   consumers) store the JWT in `chrome.storage.local`, contradicting `implementat.md`
   §Component 3 which specified `chrome.storage.session` ("memory-only, most
   secure"). It now persists to disk across restarts. The options note
   (options.html:30) was rewritten to match the weaker behavior, and `content.css`
   is a stale dead file still carrying the old indigo theme.

3. **Icons are stubs (FX-22, P3).** `icons/icon16/48/128.png` are all the same
   68-byte 1×1 transparent PNG — can't ship to the Web Store.

Beyond fixing those: the extension extracts → opens the web app, but can't
**extract straight into a Collection** or **batch-extract** multiple images,
which the platform is otherwise built for.

---

## 2. Goals / non-goals

**Goals**
- Live progress in the popup actually updates during extraction (FX-08).
- Make the JWT-storage decision deliberately and align code + UX + docs (FX-14).
- Real icons (FX-22) + delete/cleanup the stale `content.css`.
- New: "Extract to Collection" from the extension (parallels F1/editor flow).
- New: batch extract (select/hover multiple images → one queue).

**Non-goals**
- No Firefox/Safari port in v1 (MV3 Chrome only).
- No in-extension canvas editor (editing stays in the web app).
- No offline mode.

---

## 3. Current state (overhaul status, file by file)

| Item (from implementat.md) | State |
|---|---|
| `config.js` shared module | ✅ done (`getFullConfig`, `getAuthHeaders`, `isValidUrl`) |
| `common.css` tokens | ✅ done (brutalist orange theme, not the plan's indigo sample) |
| `options.css` extracted | ✅ done |
| Shadow DOM in `content.js` | ✅ closed shadow root, `position:fixed`, bg-image + `<picture>` detection |
| `pollJobUntil` helper | ✅ `background.js:338-381` |
| Keyboard command (Alt+Shift+E) | ✅ manifest + background forward + content handler |
| Sign-out | ✅ clears JWT, resets UI |
| Deep-links to `/collections/:id` | ✅ |
| `manifest.json` (cookies removed, matches narrowed, commands) | ✅ |
| Options URL validation / disable-save | ✅ |
| **Popup live progress** | ❌ **wrong message channel (FX-08)** |
| JWT in `chrome.storage.session` | ❌ uses `local` (FX-14) |
| Icons | ❌ 1×1 stubs (FX-22) |
| `content.css` | ⚠️ stale dead file, old theme |

---

## 4. Design

### 4.1 Fix live progress (FX-08)

In `background.js`, broadcast progress with **`chrome.runtime.sendMessage(...)`**
(which the popup listens to) — either replacing or in addition to the tab message.
Guard the "no receiving end" error (popup may be closed). Optionally persist the
latest progress in `chrome.storage.session` (or `local`) keyed by `jobId` so a
popup opened mid-run hydrates immediately, then live-updates from the broadcast.

```js
function emitProgress(jobId, payload) {
  chrome.storage.session.set({ [`progress:${jobId}`]: payload });   // hydrate-on-open
  chrome.runtime.sendMessage({ action: 'EXTRACT_PROGRESS', jobId, ...payload })
        .catch(() => {});  // popup closed — fine
}
```

Popup keeps its existing `chrome.runtime.onMessage` handler (popup.js:120-128) and
also reads the stored snapshot on open.

### 4.2 JWT storage decision (FX-14)

Make it deliberate. Two coherent options:
- **Spec-faithful (recommended for security):** move JWT to `chrome.storage.session` (memory-only, clears on browser restart). Restore the options-page note "re-enter after restart." Pro: token never persists to disk. Con: re-auth after every restart — mitigated because the web app can re-sync the token (the README says the frontend syncs JWT into extension storage).
- **UX-faithful (keep `local`):** document the trade-off explicitly (token persists on disk) and ensure it's the *access* token only (short-lived, 15min) — never the refresh token. Add a clear sign-out.

Either way: confirm only the short-lived access token is stored, never a refresh
token; align `config.js`, `options.html` copy, and `implementat.md`.

### 4.3 Icons (FX-22)

Produce real 16/48/128 PNGs matching the brutalist brand (the orange/zinc theme
now in `common.css`). Replace the stubs. Verify crisp rendering in the toolbar and
Web Store listing. Delete or update the stale `content.css`.

### 4.4 New — Extract to Collection

Mirror the web flow: after extraction completes, the popup offers "Save to
Collection" → fetch the user's collections (`/api/collections/mine`) → pick/create
collection + folder → push crops. Reuse the same endpoints F1/editor use. Requires
a signed-in JWT (BYOK not relevant here — extraction is credit-free; this is the
auth'd collections API). If the server download route is revived (FX-05), the popup
can also offer a direct ZIP download.

### 4.5 New — Batch extract

Allow selecting multiple hovered images (e.g. Alt+Shift+E adds the current hovered
image to a queue; a popup list shows queued images) → one "Extract all" that
enqueues N upload jobs and tracks them together in the progress UI. Keep it simple:
sequential uploads with aggregate progress.

---

## 5. Phased tasks

**Phase 1 — Completion fixes** *(S–M)*
1. FX-08 progress broadcast + hydrate-on-open.
2. FX-14 JWT-storage decision + align code/copy/docs.
3. FX-22 real icons; delete stale `content.css`.
4. Verify the full overhaul checklist in `implementat.md` §Verification Plan end-to-end.

**Phase 2 — Extract to Collection** *(M)*
5. Popup collection/folder picker reusing collections API.
6. Push crops; success → deep-link to the collection.
7. Resolve FX-05 to decide if a direct download is also offered.

**Phase 3 — Batch extract** *(M)*
8. Queue model in content/background; aggregate progress UI.
9. Sequential upload + per-item status.

## 6. Risks & mitigations

- **Web Store review** — broad host permissions + screenshots needed. → Pin to published extension ID (ties to FX-16 CORS), justify permissions, ship real icons.
- **Auth lifetime** in the extension (15min access token). → Token re-sync from the web app; clear re-auth UX; handle 401 by prompting re-sign-in.
- **Cross-origin image fetch** for batch/bg-images. → Already partly handled (Shadow DOM, bg-image detection); test on CSP-strict sites.
- **Message races** (popup opens/closes mid-run). → `.catch(() => {})` on sendMessage + storage snapshot fallback.

## 7. Verification

- Trigger extraction → popup progress bar advances live (the FX-08 repro now passes).
- Restart Chrome → confirm JWT behavior matches the chosen decision (gone if `session`; present + documented if `local`); confirm no refresh token is persisted.
- Icons render crisply at all sizes.
- Extract to Collection: crops land in the chosen collection/folder; deep-link works.
- Batch: queue 3 images → all extract → aggregate progress completes; failures isolated per item.
- Re-run `implementat.md`'s manual verification checklist top to bottom.

## 8. Definition of done

The extension's progress UI works, the JWT-storage posture is deliberate and
documented, real icons ship, and the extension can extract straight into a
Collection (and optionally batch). The overhaul plan's open items close; the
extension reaches feature-parity-ish with the web extract flow.
