# Fix & Wire-up Backlog

> Every known defect, dead path, security gap, and half-wired feature in
> OpenAssets, verified against source on 2026-06-10. Ordered by priority
> (P0 → P3). Each entry: **symptom → root cause (`path:line`) → fix sketch →
> effort**. Priority/effort legend in [`README.md`](README.md).
>
> Items that grow into full features (storage parity, history, studio→collections,
> billing) get their own deep-dive under [`features/`](features/) and are
> cross-linked here so this list stays the single index of "what's wrong."

## Status board

| ID | Priority | Area | Title | Effort | Owner doc |
|---|---|---|---|---|---|
| FX-01 | P0 | py_backend | ImageKit pipeline break (allowlist + hardcoded Cloudinary upload) | L | [F3](features/F3-storage-provider-parity.md) |
| FX-02 | P0 | backend/auth | Cookie auth reads wrong cookie name + wrong secret | S | — |
| FX-03 | P0 | py_backend | Internal-token middleware fails OPEN when secret unset | S | — |
| FX-04 | P0 | infra | `docker-compose.yml` missing frontend/Mongo/Redis + dangling redis host | M | — |
| FX-05 | P1 | backend/jobs | `GET /jobs/:id/download` is a permanently dead route | S | — |
| FX-06 | P1 | backend/collections | Gemini auto-tagging on manual image upload missing (promised) | M | [F5](features/F5-community-hub.md) |
| FX-07 | P1 | frontend/studio | Studio auth/credit errors are toast-only (no sign-in / BYOK prompt) | M | [F1](features/F1-studio-collections-bridge.md) |
| FX-08 | P1 | extension | Popup live-progress not wired (tab-message vs runtime-message) | S | [F6](features/F6-extension-v2-completion.md) |
| FX-09 | P1 | env/docs | `.env.example` gaps on both backend and py_backend | S | — |
| FX-10 | P2 | backend/storage | ImageKit `warmup` swallows transform failures | S | [F3](features/F3-storage-provider-parity.md) |
| FX-11 | P2 | backend | No dedicated rate limit on crop/finalize/download cost paths | M | — |
| FX-12 | P2 | backend/auth | User enumeration via forgot-password / resend-verification | S | — |
| FX-13 | P2 | backend/email | From-header breaks + silent no-op when email misconfigured | S | — |
| FX-14 | P2 | extension | JWT stored in `chrome.storage.local`, not `session` (weaker than spec) | S | [F6](features/F6-extension-v2-completion.md) |
| FX-15 | P2 | CI | No frontend `build`/`lint`; no py tests | M | [F7](features/F7-testing-and-ci-hardening.md) |
| FX-16 | P2 | backend/cors | CORS allows any `*.anands.dev` subdomain + any extension with credentials | S | — |
| FX-17 | P2 | frontend | Pricing page is fictional, disconnected from real economy | M | [F4](features/F4-billing-and-real-pricing.md) |
| FX-18 | P3 | frontend | ~10 dead components shipping in the bundle | S | — |
| FX-19 | P3 | frontend/routing | `/dashboard` index 404s; pricing/careers/history unreachable from Navbar | S | — |
| FX-20 | P3 | backend | Dead `config/cloudinary.ts` singleton + orphaned `buildAndUploadZip` | S | — |
| FX-21 | P3 | py_backend | Dead `/detect-upload` endpoint; `GEMINI_MODEL` example mismatch | S | — |
| FX-22 | P3 | extension | Icon PNGs are 1×1 stubs; stale `content.css` | S | [F6](features/F6-extension-v2-completion.md) |
| FX-23 | P3 | backend/usage | Cost-table "pro" matcher requires `-image` suffix | S | — |
| FX-24 | P3 | docs | `llm_wiki/` drift (Google Vision / Cloudinary-only) | S | — |

---

# P0 — Fix before anything else

## FX-01 · ImageKit pipeline break (storage abstraction is a lie below Node)
**Priority P0 · Effort L · Full design in [F3](features/F3-storage-provider-parity.md)**

**Symptom.** Setting `STORAGE_PROVIDER=imagekit` (a documented, first-class option per README.md:293-298) breaks the entire extraction pipeline. Every call into py_backend 422s, and any crop that does run uploads to the wrong provider.

**Root cause.**
- `py_backend/app/core/config.py:15` — `ALLOWED_IMAGE_HOSTS` defaults to `res.cloudinary.com,cloudinary.com` only. The Node workers pass ImageKit URLs (`ik.imagekit.io` / custom endpoint) to `/check-transparency`, `/detect`, `/name-assets`, `/crop`; `image_io.py:32-34` rejects any host not in the allowlist → **422 "Image host is not in the allowlist"** on the first call.
- `py_backend/app/services/cloudinary_client.py:6-22` — crop uploads are **hardcoded to Cloudinary**. Even if the allowlist were widened, crops would land in Cloudinary while the rest of the app reads ImageKit, and Cloudinary creds may be unset in an ImageKit deployment → 502.

**Why it matters.** The whole selling point of the storage layer ("set one env var, the rest never knows") is false. A user who picks ImageKit gets a silently broken product.

**Fix sketch.** See F3 for the full design. Short version: (1) make `ALLOWED_IMAGE_HOSTS` derive from the active provider's host(s); (2) give py_backend the same pluggable upload abstraction the Node layer has (a `StorageClient` protocol with `cloudinary` + `imagekit` impls selected by `STORAGE_PROVIDER`); (3) pass the chosen provider in the request body so py and Node never disagree.

---

## FX-02 · Cookie auth reads the wrong cookie name (and wrong token type)
**Priority P0 · Effort S**

**Symptom.** Any client that relies on the cookie session (e.g. hitting `/api/auth/me` without an `Authorization: Bearer` header) is treated as unauthenticated, even with a valid refresh cookie set.

**Root cause.** `backend/src/modules/auth/auth.middleware.ts:21-22` falls back to `req.cookies.token`. But login (`auth.controller.ts:31`) and the Google callback (`auth.controller.ts:139`) set a cookie named **`refreshToken`**, never `token`. Grep confirms nothing sets a `token` cookie anywhere. Worse: even if the name matched, the cookie holds a *refresh* token, which the middleware would try to verify with the *access* secret → verification fails regardless.

**Why it matters.** Half-wired session story. Only the Bearer path works; the cookie fallback is dead code that creates a false sense of a working cookie session and will mislead the extension / any SSR caller.

**Fix sketch.** Decide the intended contract:
- If cookie auth should mint access from the refresh cookie: the middleware should read `req.cookies.refreshToken`, verify with the **refresh** secret, and (ideally) only the `/refresh-token` route should accept it — protected routes should require Bearer.
- Simplest correct fix: drop the dead `req.cookies.token` fallback entirely; document Bearer-only for protected routes. Add a unit test asserting `authenticate()` rejects a request carrying only the refresh cookie.

---

## FX-03 · py_backend internal-token middleware fails OPEN
**Priority P0 · Effort S**

**Symptom.** If `INTERNAL_API_TOKEN` is unset in a deployment, `/detect`, `/name-assets`, `/crop` are reachable **unauthenticated**.

**Root cause.** `py_backend/app/main.py:26-30` — the guard is `if token and <mismatch>: reject`. When the configured token is falsy, the condition short-circuits and every request passes. The only backstop is network placement + the 120/min IP rate limit.

**Why it matters.** README and `docker-compose` assume py_backend is private, but "forgot to set one env var" should not silently expose an unauthenticated compute endpoint that talks to Cloudinary and Gemini on your dime.

**Fix sketch.** Fail closed: if `INTERNAL_API_TOKEN` is unset **and** `ENV != development`, refuse to start (or 503 all guarded routes) with a loud log. In development, allow the open mode but log a warning each boot. Pair with FX-09 (add the var to `.env.example`).

---

## FX-04 · `docker-compose.yml` cannot actually run the stack
**Priority P0 · Effort M**

**Symptom.** `docker compose up -d` (which README.md:248 says brings up "MongoDB :27017, Redis :6379") brings up neither, and the backend can't reach Redis.

**Root cause.** `docker-compose.yml` builds only `openasset-py-backend` + `openasset-backend`. There is **no frontend service, no Mongo service, no Redis service**. Both backend services reference `redis://openpoll-redis:6379`, but **no `openpoll-redis` service or external-network alias exists**. README's up-front instruction (README.md:248) is therefore false; the footnote (249-251) only partially walks it back.

**Why it matters.** New contributors / deployers follow the README, run the documented command, and get a stack that can't connect to its datastores. First-run experience is broken.

**Fix sketch.** Two clean options:
1. **Dev compose** (`docker-compose.dev.yml`): Mongo + Redis only, ports published, named volumes — matches what the README *says* the command does. Make this the default `docker compose up` target.
2. **Prod compose** (keep current `docker-compose.yml`): add `redis` + `mongo` services (or document the external managed instances + the network alias `openpoll-redis` must resolve to), add a `frontend` service (Dockerfile exists), and drop the obsolete `version: '3.8'` key. Fix the `PORT=8000` vs hardcoded `--port 8000` inconsistency (Dockerfile:21) or honor `$PORT`.
Update README §Local development + §Deployment to match whichever files exist.

---

# P1 — Next sprint

## FX-05 · `GET /api/jobs/:jobId/download` is a permanently dead route
**Priority P1 · Effort S**

**Symptom.** The route always returns `400 "Export not ready"`, even for `ready` jobs.

**Root cause.** `job.routes.ts:36-44` gates on `job.downloadUrl`, but `downloadUrl` is initialized to `''` in `job.store.ts:27` and **never written by any worker** — `finalize.worker.ts` zips client-side now. `buildAndUploadZip` (`zip.builder.ts:66`), the function that would produce that URL, is **called nowhere** (orphaned).

**Why it matters.** Dead public route + dead code. The extension and any API consumer that expects a server-side download URL (the README's API table lists it) will fail.

**Fix sketch.** Pick one:
- **Remove** the route + `buildAndUploadZip` and update the README API table (cheapest; client-side ZIP is the real flow). **OR**
- **Revive** it: have `finalize.worker` call `buildAndUploadZip`, store the URL on the job, and 302 to it — useful precisely because the extension/API can't run the browser ZIP path. Recommended if FX-08/F6 wants the extension to download finished exports. Decide in tandem with F6.

## FX-06 · Gemini auto-tagging on manual collection upload is missing
**Priority P1 · Effort M · Related: [F5](features/F5-community-hub.md)**

**Symptom.** Uploading images directly into a collection folder stores them with no tags, no description, no AI naming — contradicting the feature spec (`feature_request_public_collections.md` §5.2, §6) which promised Gemini Flash Vision enrichment on add.

**Root cause.** `collection.controller.ts:96-115` (`addImages`, multipart path) persists files with empty `tags`/`geminiMetadata`. Gemini enrichment only happens on the editor→crop-worker scaffold path (`nameAssets`); manual uploads get nothing.

**Why it matters.** Search/discovery (a core Collections value prop) is starved of tags for everything uploaded directly. A promised, user-visible feature is absent.

**Fix sketch.** Add an async enrichment step in `addImages`: after upload, enqueue a BullMQ job (new lightweight `enrich` queue, or reuse the worker process) that calls py_backend for vision tagging/description, then patches the `Image` doc. Keep it non-blocking (image appears immediately, tags fill in). Reuses the existing `nameAssets`-style Gemini plumbing — extend py_backend with a `/describe-image` route returning `{ labels, tags, description, dominantColors, suggestedName }`. Track under F5's "tagging & search" workstream.

## FX-07 · Studio auth/credit errors are toast-only
**Priority P1 · Effort M · Full design in [F1](features/F1-studio-collections-bridge.md)**

**Symptom.** When a signed-out user (or one out of credits) triggers generation, they get a toast saying "sign in or add your OpenRouter key (gear icon)" — but nothing navigates to sign-in or opens the BYOK `ApiKeyModal`. They must hunt for the gear themselves.

**Root cause.** `useExtender.ts:43-53`, `useParallax.ts:71-81`, `useTileStudio.ts:71-79`, `useSpriteStudio.ts:87-95`, `usePropStudio.ts:52-60` — all branch on `StudioApiError.code` (`AUTH_REQUIRED` / `INSUFFICIENT_CREDITS`) but only fire a `sonner` toast. The plan specified interactive flows. The error code is correctly threaded; only the UI response is missing.

**Why it matters.** First-run conversion: a new user hits the wall and bounces instead of being walked into sign-in or BYOK. This is the studio's primary activation funnel.

**Fix sketch.** Lift error handling into a shared studio hook/context. On `AUTH_REQUIRED` → open a sign-in modal (or push `/login?next=/studio/...`); on `INSUFFICIENT_CREDITS` → open `ApiKeyModal` pre-focused on the BYOK field with an upsell line. The five hooks should call one `handleStudioError(err)` rather than each duplicating toast logic. Detail + the modal wiring live in F1 (same area).

## FX-08 · Extension popup live-progress is not wired
**Priority P1 · Effort S · Related: [F6](features/F6-extension-v2-completion.md)**

**Symptom.** The popup's progress bar never updates during an extraction; it only reflects state via the one-shot `GET_JOB_STATUS` query when opened.

**Root cause.** `background.js:407-437` sends `EXTRACT_PROGRESS/COMPLETE/FAILED` via `chrome.tabs.sendMessage(tabId, …)` — delivered to the **content script**, never to the popup's `chrome.runtime.onMessage` listener (`popup.js:120-128`).

**Why it matters.** The progress UI was built (popup.html:52-65) but is functionally inert. The user sees a static "Processing…" with no feedback.

**Fix sketch.** Broadcast progress with `chrome.runtime.sendMessage(...)` (popup listens) in addition to / instead of the tab message; guard the no-receiver error. Optionally persist last-known progress in `chrome.storage.session` so a popup opened mid-run hydrates correctly. Folded into F6.

## FX-09 · `.env.example` gaps on backend and py_backend
**Priority P1 · Effort S**

**Symptom.** Copying `.env.example` yields a misconfigured service with no hint.

**Root cause.**
- `backend/.env.example` — **missing** `STORAGE_PROVIDER`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` (read by `storage/index.ts` + `imagekit.adapter.ts`, documented in README) and `INTERNAL_API_TOKEN` (read by `py.client.ts:10` for Node→py auth).
- `py_backend/.env.example` — **missing** `INTERNAL_API_TOKEN` and `ALLOWED_IMAGE_HOSTS` (both real settings, both in README.md:322-323). Also `GEMINI_MODEL=gemini-2.0-flash` in the example vs code default `gemini-flash-lite-latest` (`config.py:11`).

**Critical naming note (don't merge these):** `INTERNAL_API_TOKEN` (Node↔py) and `INTERNAL_SERVICE_TOKEN` (frontend-studio→Node refund) are **two distinct secrets**. Their similar names invite a dangerous "consolidation." Document both with a comment stating they are separate.

**Fix sketch.** Add the missing vars to both example files with inline comments. Align the `GEMINI_MODEL` example to the code default (or vice versa). Add a one-line note in each `.env.example` distinguishing the two internal tokens.

---

# P2 — Soon (hardening, abuse, content debt)

## FX-10 · ImageKit `warmup` swallows transform failures
**Priority P2 · Effort S · Related: [F3](features/F3-storage-provider-parity.md)**
`imagekit.adapter.ts:84-90` returns the URL unconditionally even when the transform (bg-removal/upscale) fails, unlike Cloudinary's `pollUntilReady` which throws. A worker then proceeds with a URL that may 404 later, with no failure surfaced. **Fix:** make `warmup` verify the transform completed (HEAD/GET check or poll) and throw on failure, matching Cloudinary semantics. Covered in F3.

## FX-11 · No dedicated rate limit on cost-bearing endpoints
**Priority P2 · Effort M**
`app.ts:67` — only the loose `apiLimiter` (1000/15min) covers `/crop`, `/finalize`, and the two collection-download routes. Crop/finalize fan out to py_backend + paid Cloudinary AI add-ons; collection downloads re-fetch every image and re-zip in memory on every hit with no caching (`collection.controller.ts:159-196`). **Fix:** add a tight limiter (e.g. 10–20/15min/user) to crop+finalize; add a per-collection download limiter + a short-TTL cache of the built ZIP (or a signed Cloudinary archive URL) to cap recompute. Real cost/DoS surface.

## FX-12 · User enumeration in auth
**Priority P2 · Effort S**
`auth.service.ts:172-176` (forgot-password) and `:129` (resendVerification) throw `404 "No account with that email"` for unknown emails, leaking which addresses are registered. **Fix:** always return a generic success ("If an account exists, we sent an email"); send the email only when the account exists. Standard anti-enumeration.

## FX-13 · Email From-header + silent no-op
**Priority P2 · Effort S**
`email.ts:9` builds From from `RESEND_FROM_NAME || SMTP_FROM_NAME` + `RESEND_FROM_EMAIL || SMTP_FROM_EMAIL`; `.env.example` defines none of the name vars, so From becomes `"undefined" <email>` (Resend may reject). And when `RESEND_API_KEY` is unset, email silently logs-and-no-ops — so registration "succeeds" but no verification mail is sent, blocking login. **Fix:** (1) default the display name sanely and drop `undefined`; (2) in non-dev, refuse to boot (or loudly warn) if `RESEND_API_KEY` is missing; (3) add `RESEND_FROM_NAME` to `.env.example`.

## FX-14 · Extension JWT in `chrome.storage.local` not `session`
**Priority P2 · Effort S · Related: [F6](features/F6-extension-v2-completion.md)**
`config.js:9` (and consumers in background/options/popup/content) store the JWT in `chrome.storage.local`, contradicting `implementat.md` §Component 3 ("session, memory-only, most secure"). It now persists to disk across restarts. The options note (options.html:30) was rewritten to match the weaker behavior. **Fix:** decide intentionally — if the security goal stands, move to `chrome.storage.session` and restore the "re-enter after restart" UX; if persistence is desired for UX, document the trade-off explicitly and keep `local`. Covered in F6.

## FX-15 · CI gaps
**Priority P2 · Effort M · Full design in [F7](features/F7-testing-and-ci-hardening.md)**
`.github/workflows/ci.yml`: frontend runs only `tsc --noEmit` + audit — **no `next build`, no `lint`**, despite `frontend/AGENTS.md` warning this is a non-standard Next.js where a broken build is plausible. py_backend only byte-compiles — **no tests, no lint/type check**. Extension uncovered. **Fix:** add frontend `build` + `lint`; add py `ruff`/`mypy` + a minimal pytest smoke; add a JSON-lint of `manifest.json`. Detail in F7.

## FX-16 · Over-broad CORS
**Priority P2 · Effort S**
`app.ts:36` allows any `origin.endsWith('.anands.dev')` (incl. a hijacked subdomain), any `chrome-extension://`, and any `localhost:*` — all with `credentials:true`. Intentional for the extension, but broad. **Fix:** pin the extension to its published ID once stable; restrict subdomain matching to an explicit allowlist; gate `localhost` on `NODE_ENV=development`.

## FX-17 · Pricing page is fictional
**Priority P2 · Effort M · Full design in [F4](features/F4-billing-and-real-pricing.md)**
`app/pricing/page.tsx` advertises tiers ($150 Pro, "5 sprite sheets/mo" Hobby, Enterprise) that don't match the real economy (150 free studio credits/month + BYOK), with CTAs that just link to `/register` and a "startups" link to a personal Twitter DM. No billing exists. **Fix:** either (a) rewrite the page to describe the *actual* free+BYOK model honestly (cheap, do now), or (b) build real billing (F4). Do (a) now regardless; schedule (b) via F4.

---

# P3 — Opportunistic cleanup

## FX-18 · Dead frontend components
**Priority P3 · Effort S**
Imported nowhere (verified): `components/landing/{BrutalPipelinePanel,NeuralUpscaleSimulator,VisualPipelineShowcase}.tsx`, `components/kokonutui/card-flip.tsx`, `components/unlumen-ui/{orbiting-skills,compact-view-icon,floating-tooltip,tooltip-preview,refresh}.tsx`, `components/smoothui/basic-dropdown/index.tsx`, `features/editor/components/{DetectionCanvas,PipelineSection,ConfigSection}.tsx`. Plus unused imports `startExport`, `Zap` in `EditorScreen.tsx:15-16`. **Fix:** delete after a final import-grep per file (the landing simulators are heavy). Bundle weight + confusion, not correctness.

## FX-19 · Routing dead-ends
**Priority P3 · Effort S**
No `app/(dashboard)/dashboard/page.tsx` → `/dashboard` 404s. `Navbar.tsx` has no link to `/pricing`, `/careers`, or `/history` (those pages exist but are unreachable from global nav; History is fully orphaned). **Fix:** add a `/dashboard` index (redirect to `/dashboard/collections` or a real dashboard home) and add footer/nav links for pricing/careers; wire History once F2 lands.

## FX-20 · Backend dead code
**Priority P3 · Effort S**
`config/cloudinary.ts` is a top-level `cloudinary.config()` singleton imported nowhere (the adapter configures its own client) — vestigial and misleading. `buildAndUploadZip` orphaned (see FX-05). `test-pipelines.ts` at backend root is a loose manual script outside the test runner — confirm intent or move to `scripts/`. **Fix:** delete `config/cloudinary.ts`; resolve `buildAndUploadZip` with FX-05.

## FX-21 · py_backend minor
**Priority P3 · Effort S**
`/detect-upload` (`detect.py:18-26`) has no Node caller — dead. `GEMINI_MODEL` example/default mismatch (see FX-09). **Fix:** remove `/detect-upload` or document it as a manual tool; align model strings.

## FX-22 · Extension icons + stale CSS
**Priority P3 · Effort S · Related: [F6](features/F6-extension-v2-completion.md)**
`icons/icon16/48/128.png` are all the same 68-byte 1×1 transparent PNG — store submission needs real assets. `content.css` is "kept for reference" but still carries the OLD indigo theme while `content.js` injects the new orange brutalist one — stale/misleading dead file. **Fix:** produce real icons; delete or update `content.css`. Folded into F6.

## FX-23 · Cost-table "pro" matcher is suffix-sensitive
**Priority P3 · Effort S**
`usage.service.ts:14-22` matches pro pricing with `/gemini-3-pro-image/i`; a bare `gemini-3-pro` id (no `-image`) would fall through to cost 1, underpricing. **Fix:** confirm the exact model id strings the studio sends; broaden the matcher to `/gemini-3-pro/i` if the bare id is reachable. Low risk today, but a silent revenue leak if model ids change.

## FX-24 · Wiki drift
**Priority P3 · Effort S**
`docs/llm_wiki/` still references "Google Vision" and "Cloudinary only" in places; the README is the current source of truth and even flags this. **Fix:** refresh the wiki pages or add a top banner pointing readers to README + this folder. Low signal but causes onboarding confusion.

---

## Suggested fix sequence (foundation-first)

1. **FX-02, FX-03** (auth + py fail-open) — small, security-correctness, no dependencies.
2. **FX-04 + FX-09** (compose + env examples) — unblocks reliable local/prod setup; do together.
3. **FX-01 / F3** (storage parity) — the biggest correctness hole; everything downstream of storage depends on it.
4. **FX-05** (dead download route) — decide remove-vs-revive in tandem with **F6/FX-08** (extension progress).
5. **FX-07 / F1** (studio error UX) alongside building the studio→collections bridge.
6. **FX-06** (collection tagging) as the first slice of **F5**.
7. P2 hardening (FX-10–17) interleaved as the touched areas come up.
8. P3 cleanup opportunistically, ideally bundled into PRs that already touch the file.
