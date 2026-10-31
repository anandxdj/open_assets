# Extension: "Sent from this browser" and "Send to Extract"

> Chrome extension (`extension/`). The owner approved both features that the design
> canvas marks "Designed, not built", plus forwarding the API error `code` to the UI
> (Task 1, below, because both features depend on it).
>
> **Priority:** P2 · **Effort:** M · **Depends on:** nothing new in the backend or the web app.

## Decision summary

| Question | Answer |
|---|---|
| Where does the "Sent" list live? | The extension, in `chrome.storage.local`. No backend change. |
| Where do the statuses come from? | The existing `GET /api/jobs/:jobId` (owner-checked, already returns `status`, `fileName`, `cloudinaryUrl`, `error`). |
| Why not a backend query filtered by a client id? | It needs a new job field, a client id that identifies a browser (a tracking identifier), an index and a migration, to answer a question the browser already knows. A local list is private by construction and smaller. |
| What starts "Send to Extract"? | The same call the web app makes: `POST /api/upload` with the image, then the editor opens at `/editor/<jobId>`. The upload guard (`enforceSheetLimit`) applies unchanged. |
| Web app change | None. `/editor/:jobId` already exists and the extension already opens it. |
| Backend change | None. |

## Task 1: forward the API error code

The API answers every failure with `{ success: false, message, code?, details? }`
(`backend/src/common/middlewares/errorHandler.ts`). Plan limits carry one of three
codes (`backend/src/modules/plans/entitlements.ts`, `PLAN_ERROR`):

| Code | Meaning | Where the extension can hit it |
|---|---|---|
| `SHEET_LIMIT` | monthly sheet allowance used up (`details.resetAt`) | `POST /api/upload` (extract, send to extract) |
| `PLAN_LIMIT` | a numeric limit would be exceeded | not today; mapped for forward compatibility |
| `PLAN_REQUIRED` | the feature needs Pro | not today; mapped for forward compatibility |

Changes:

- `src/shared/errors.ts` (new, pure, unit-tested): `ApiFailure` (message, `code`, `status`),
  `failureFromResponse`, `isPlanLimitCode`, `toWorkerError`, `pricingUrl`.
- `WorkerResponse` failure becomes `{ ok: false; error: string; code?: string }`. The worker
  handler forwards `code` from any `ApiFailure`; every other error keeps its current text and
  has no code.
- UI: one `Notice` component. For a plan-limit code it shows the message plus a **See plans**
  link to `<frontendUrl>/pricing` (the page the web app's own "See plans" links use), opened
  in a new tab (`target="_blank" rel="noreferrer"`, with "(opens in a new tab)" for screen
  readers). Other errors render as before.
- Failures from the context menu and the shortcut have no UI open. They already set the `!`
  badge; they now also keep the last failure (message and code) in `storage.session` so the
  popup and side panel show it, with the link, the next time they open. Dismissing it clears
  the badge too.

While wiring this up, two defects in the existing auth code were found and are fixed with tests,
because the new status polling would otherwise trip over them:

1. **Expired access token is never refreshed.** The access token lives 15 minutes; the extension
   only refreshes when it is missing from session storage. After 15 minutes, every API call
   answers 401 "Invalid or expired token" until the browser restarts. Fix: one retry through the
   device token on a 401 (`fetchWithAuth`).
2. **Any refresh failure signs the user out.** `refreshAccount` clears the account on a network
   error or a 5xx too. Fix: clear only when the server rejects the device session (401/403);
   otherwise keep the session and report "Could not reach OpenAssets".
   The refresh is also single-flight, because the device token rotates on every refresh and two
   parallel refreshes would invalidate each other and sign the user out.

## Feature A: "Sent from this browser"

### What it shows

On the **Extract** tab, under the hints (as on the canvas): a list of images this browser sent
to OpenAssets in the last 24 hours, newest first, at most 20. Each row: thumbnail, file name,
status badge (icon, words and colour), age, and an "Open in editor" action. Header actions:
**Clear list**.

### Data (local, per browser, per account)

`chrome.storage.local["sent"] = { accountId: string, items: SentItem[] }`

```ts
interface SentItem {
  jobId: string;          // from POST /api/upload
  fileName: string;       // the name sent with the upload
  sentAt: string;         // ISO
  via: 'page' | 'library';
  status: 'queued' | 'detecting' | 'ready' | 'failed' | 'expired';
  thumbnailUrl?: string;  // the job's own stored original (OpenAssets storage), from the status call
  error?: string;         // the job's error message when failed
  checkedAt?: string;     // ISO of the last status check
}
```

Why 24 h and 20 rows: a job (and its original) expires after 24 h on the server
(`JOB_TTL` in `job.store.ts`), so an older row would link to a dead editor. Rows are pruned on
every read and write. 20 keeps the list scannable and the storage tiny.

### Where each status comes from

`GET /api/jobs/:jobId` with the access token. `JobStatus` maps to the list's status:

| API `status` | List status | Label | Polled? |
|---|---|---|---|
| `uploaded`, `queued` | `queued` | Queued | yes |
| `detecting`, `removing_bg` | `detecting` | Detecting | yes |
| `detected`, `naming`, `cropping`, `cropped`, `finalizing`, `ready` | `ready` | Ready | no |
| `failed` | `failed` | Failed (shows `error`) | no |
| 404 (hash expired) / 403 | `expired` | Expired | no |

Only rows that are `queued` or `detecting` are fetched, so a refresh costs one small request per
row in progress, and nothing once all rows have settled.

### Live updates

- While the side panel or popup is open and visible, the UI asks the worker for a refresh
  (`SENT_REFRESH`) right away if a row is in progress, then again after 3 s, 5 s, 8 s, 13 s,
  then every 30 s (`nextPollDelay`, unit-tested). A new row resets the delay to 3 s.
- Polling stops when the page unmounts (panel closed), when the tab is hidden
  (`visibilitychange`), when the Extract tab is not showing, or when nothing is in progress.
  Nothing polls from the background worker, so a closed panel costs nothing.
- Status changes are announced politely: the list has a visually hidden `role="status"` line
  ("slime_sheet.png is ready", "2 images are being detected").

### States

| State | What the user sees |
|---|---|
| Signed out | Nothing: the whole panel is the Connect screen. The list is gone (see privacy). |
| Empty | Empty state: "Nothing sent yet. Images you extract from a page or send from the Library show up here for 24 hours." |
| Loading | Rows show their last known status at once from storage, with `aria-busy` on the list while a refresh is in flight. No skeleton, no layout shift, and no "Updating" text that would blink on every poll; a row in progress carries a spinning Detecting badge. |
| Error | A refresh failure keeps the last known rows and shows a warning line under the list: "Could not update statuses. <reason>" with **Try again**. Polling backs off. |
| Row failed / expired | Failed: danger badge and the job's error text. Expired: neutral badge, no link, hint that the original is no longer stored. |
| Plan limit | Not a list state: a refused send never creates a row. The notice from Task 1 explains it, with **See plans**. |

### Privacy

- Stored: job id, a file name, timestamps, a status string, and the URL of the stored original
  in OpenAssets' own storage. **Not stored:** the source image URL, the page URL or title, prompts,
  the image bytes, tokens.
- File names: a page image is named after the last segment of its URL path when that looks like a
  file name (the same name the web app would send if the user dragged that file in), otherwise
  `openassets-<timestamp>.<ext>`. A library image uses its existing `openassets-<id>-<n>.png`.
  Prompts are never used as names.
- The list is stored with the owning account id. It is ignored (and replaced) when another account
  signs in on the same browser.
- Cleared on **sign-out** and when the server rejects the device session (both go through
  `clearAuth`), and by **Clear list** (asks nothing: it only removes local rows; jobs stay on the
  account until they expire and remain in the web app's history). The copy under the button says so.
- Account deletion on the web revokes extension sessions server-side; the next refresh fails with
  401, which clears the list.

## Feature B: "Send to Extract"

### What it does

A dashed icon button on each **Library** row. Library rows are ChatGPT generations kept in the
extension (`LibraryItem`, each with one or more `outputs`). The button uploads one of that row's
images to OpenAssets and opens the editor, exactly like picking an image on a page.

- **Row with one image:** the button sends it.
- **Row with several images:** the button opens an inline chooser under the row (`aria-expanded`),
  one button per image ("Send image 2 of 4 to Extract"), so no upload happens for an image the user
  did not pick. Escape closes it.
- Accessible name: "Send to Extract: <prompt>" (truncated like the queue's remove button).
- Under the list header, one line of copy: "Send to Extract uploads that image to your account."

### User control (PRODUCT.md: every upload is the user's choice)

- Nothing uploads without a click on that image's button. No bulk send, no auto-send after a
  generation finishes, no retry loop.
- While a send runs, only that button is busy (`aria-busy`, spinner) and disabled; the rest of the
  list stays usable. A second click cannot start a second upload of the same image.
- The result is announced politely ("Sent to Extract. Opening the editor.") or shown as a notice.

### Data path

The popup/side panel sends `{ type: 'EXTRACT_IMAGE_URL', imageUrl, via: 'library', fileName }` to the
worker. The worker (`extractImage`):

1. `requireAccount()`.
2. Fetches the image. For `https://chatgpt.com/*` the fetch uses
   `credentials: 'include'` (the extension has a host permission for chatgpt.com); for other pages
   it behaves as today. If the image is gone (expired signed URL), the error is "That image is no
   longer available from ChatGPT. Open the conversation and use Extract on the page instead."
3. `POST /api/upload` (multipart `image`, Bearer token) through `fetchWithAuth`. Sheet limit,
   file type and size are enforced by the API (`enforceSheetLimit`, multer, 20 MB).
4. Records the row in "Sent" (`jobId`, `fileName`, `via`, `sentAt`, `status: queued`), publishes a
   snapshot change, and opens `<frontendUrl>/editor/<jobId>`.

Existing sends (context menu, shortcut, picker) go through the same function, so they appear in the
list too.

### Plan limit

`403 SHEET_LIMIT` reaches the UI as `{ ok: false, error, code: 'SHEET_LIMIT' }`: the notice shows the
server's message ("You have used all 10 sheets this month. Your allowance resets on 2026-11-01. Pro has
no sheet limit.") and **See plans**. No row is added.

## API endpoints

| Need | Endpoint | Status |
|---|---|---|
| Upload an image, start extraction | `POST /api/upload` | exists |
| Status of a job | `GET /api/jobs/:jobId` | exists |
| Refresh the access token | `POST /api/auth/extension/refresh` | exists |
| Revoke the device session on sign-out | `DELETE /api/auth/extension/session/current` | exists |
| Plans page | web `/pricing` | exists |

No endpoint is added; the API stays backward compatible by not changing.

## Test plan

Unit (vitest, `extension/src/shared/*.test.ts`):

- `errors.test.ts`: plan-limit code detection (all three codes, other codes, no code);
  `failureFromResponse` keeps `code` and `status`, falls back to the supplied text when the body has no
  message; `toWorkerError` forwards `code` for an `ApiFailure` and returns the plain message otherwise;
  `pricingUrl` strips a trailing slash and adds `/pricing`.
- `sent.test.ts`: status mapping for every `JobStatus`; prune by age and cap; newest first; upsert;
  apply a status result (ready, failed with error, expired on 404); account switch ignores old rows;
  `isInProgress`; `nextPollDelay` schedule and cap; file name from a URL (good names, opaque hashes,
  long names, query strings, data URLs).
- `api.test.ts`: `fetchWithAuth` retries once on 401 with a fresh token and does not retry twice,
  does not retry on other statuses; the session is cleared only for a 401/403 refresh rejection;
  parallel refreshes share one call.

Component and harness checks (Browser pane or Playwright against `pnpm harness`, no live API):
every state above for the Extract and Library tabs; light and dark at 360 and 480 wide, 320 wide in
dark, reduced motion; keyboard operation of the buttons and the multi-image chooser; visible focus;
accessible names on icon buttons; the polite status lines.

Live check against the local stack (backend on 4122): register a user, run the extension's upload and
status functions against it, confirm statuses move from Queued, confirm a second user's job answers
403/404, and confirm `SHEET_LIMIT` carries `code` through `extractImage`.

Gates: extension `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Out of scope

- A bulk "send all" and any automatic upload.
- A server-side per-browser list or client id.
- Clearing the extension's own prompt queue and library on sign-out (they are local and unrelated to
  the account's uploads; noted as a decision for the owner).
