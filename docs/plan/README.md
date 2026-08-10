# OpenAssets — Planning & Roadmap

> Living planning hub for OpenAssets. Two halves: **what's broken / half-wired today**
> (fix it) and **what we build next** (future features). Every claim below was
> verified against the actual code on 2026-06-10; each item carries `path:line`
> references so a reader can jump straight to the source.

---

## How this folder is organized

| Doc | Purpose |
|---|---|
| [`01-fixes-and-wireups.md`](01-fixes-and-wireups.md) | The complete, prioritized backlog of bugs, dead code, and half-wired features. Read this first. P0 → P3. |
| [`02-roadmap.md`](02-roadmap.md) | Future-feature roadmap: themes, sequencing, dependency graph, milestone view. |
| [`features/F1-studio-collections-bridge.md`](features/F1-studio-collections-bridge.md) | Save studio output into Collections (Studio Integration Phase 6). |
| [`features/F2-history-and-job-persistence.md`](features/F2-history-and-job-persistence.md) | A real History page + the per-user job index it requires. |
| [`features/F3-storage-provider-parity.md`](features/F3-storage-provider-parity.md) | Make `STORAGE_PROVIDER=imagekit` actually work end-to-end (currently broken below the Node layer). |
| [`features/F4-billing-and-real-pricing.md`](features/F4-billing-and-real-pricing.md) | Turn the fictional pricing page into a real plan/credits/billing system. |
| [`features/F5-community-hub.md`](features/F5-community-hub.md) | Collections → a social asset-sharing community (profiles, discovery, comments, follows). |
| [`features/F6-extension-v2-completion.md`](features/F6-extension-v2-completion.md) | Finish the Chrome extension overhaul (live progress, real icons, session-storage JWT). |
| [`features/F7-testing-and-ci-hardening.md`](features/F7-testing-and-ci-hardening.md) | Close the test/CI gaps so regressions can't ship silently. |
| [`features/F8-enhance-workspace.md`](features/F8-enhance-workspace.md) | Add the non-generative Enhance workspace: deterministic line-art polish and Cloudinary-backed AI enhancement. |
| [`features/F9-anibuddy.md`](features/F9-anibuddy.md) | Animate user-supplied character art with AI-assisted 2D mesh rigs, without image generation. |
| [`features/F10-background-aware-detection.md`](features/F10-background-aware-detection.md) | Detect assets reliably on black, dark, light, and non-uniform opaque backgrounds. |

Related existing docs (predate this folder, still useful):
- [`../studio_integration_plan.md`](../studio_integration_plan.md) — the original 6-phase studio port plan (phases 0–5 done, 6 open → see F1).
- [`../feature_request_public_collections.md`](../feature_request_public_collections.md) — original collections spec (mostly built; Gemini tagging gap → fix backlog).
- [`../llm_wiki/`](../llm_wiki/) — per-service deep dives (some drift; README is the current source of truth).
- [`../../implementat.md`](../../implementat.md) — the extension overhaul plan (~90% delivered → see F6).

---

## Current state of the project (one screen)

OpenAssets is four surfaces (Next.js frontend, Express backend + BullMQ workers,
FastAPI `py_backend`, Chrome extension) over MongoDB + Redis + pluggable object
storage. Four product lines now live side by side or are explicitly planned:

1. **Extraction** — upload a packed image → OpenCV detect → canvas edit → Gemini
   names → crop → optional 2× upscale → ZIP or push to a Collection. **End-to-end
   working.**
2. **Studio (generation)** — five AI studios (Extender, Parallax, Tiles, Sprites,
   Props) ported from `image-extender`, fronted by Next API routes with a hybrid
   BYOK / server-credits key model. **All five ship; the credits economy is real
   and atomic.**
3. **Collections** — public galleries with folders, images, likes, download
counts, search, and on-the-fly ZIP export. **Working, with one promised AI
feature missing (auto-tagging on manual upload).**
4. **Enhance** *(planned)* — a non-generative workspace for deterministic
line-art refinement, Cloudinary-backed enhancement, and AniBuddy 2D character
animation. **Specified in F8/F9; not yet implemented.**

### What's genuinely solid (don't re-plan these)

- Extraction pipeline front-to-back, including failed-state handling and polling teardown.
- Credits/usage module: atomic deduct, idempotent refund, service-token-gated refund, server-authoritative cost table, race-tested.
- Collections CRUD + folders + images + likes + nested/flat ZIP + owner/admin authz + Cloudinary cleanup on delete.
- `api-client` refresh-token logic (single in-flight refresh, retry-once, clear-on-fail) mirrored by `studioClient`.
- Both storage adapters fully implement the interface **at the Node layer** (the break is in `py_backend` — see F3).
- py_backend SSRF defense (https-only, private-IP/metadata blocking, host allowlist, dimension caps) and graceful Gemini degradation.
- Extension overhaul ~90% delivered (Shadow DOM, config module, poll helper, keyboard command, sign-out, deep-links).

### The five things that hurt most right now

These are the headline items; full detail and the long tail live in `01-fixes-and-wireups.md`.

1. **ImageKit is a lie below Node.** `py_backend` hard-codes Cloudinary uploads and its host allowlist excludes ImageKit, so `STORAGE_PROVIDER=imagekit` breaks the whole pipeline (`py_backend/app/services/cloudinary_client.py`, `app/core/config.py:15`). → **F3**, also P0 in the backlog.
2. **Cookie auth is dead.** `auth.middleware.ts:21` reads `req.cookies.token`; login sets `refreshToken`. Only `Authorization: Bearer` works. → P0.
3. **`GET /api/jobs/:id/download` is a dead route.** Nothing ever sets `job.downloadUrl`; `buildAndUploadZip` is orphaned (`job.store.ts:27`, `zip.builder.ts:66`). → P1.
4. **Studio output is a dead-end.** No "Save to Collection" from any studio (Integration Phase 6 unbuilt), and auth/credit errors are toast-only with no programmatic sign-in or BYOK prompt. → **F1**, P1.
5. **History is a stub and unbuildable as-is.** No per-user job index, no list endpoint, 24h Redis TTL. → **F2**.

---

## Severity & priority legend (used across all docs)

**Priority** (when to do it):

| | Meaning |
|---|---|
| **P0** | Broken in a way that silently corrupts behavior or blocks a documented config. Fix before anything else. |
| **P1** | Promised/expected feature is dead or a high-value wire-up is missing. Next sprint. |
| **P2** | Real but contained: hardening, abuse vectors, content debt. Soon. |
| **P3** | Cleanup, dead code, cosmetics. Opportunistic. |

**Effort** (rough): `S` ≤ half day · `M` 1–3 days · `L` ~1 week · `XL` multi-week / multi-surface.

---

## How to use these docs

- **Fixing bugs?** Open `01-fixes-and-wireups.md`, work top-down by priority. Each entry has the file, the symptom, the root cause, and a concrete fix sketch.
- **Building a feature?** Open the matching `features/Fn-*.md`. Each is self-contained: problem → goal → current state → design → data/API/UI changes → phased task list → risks → verification.
- **Planning a sprint?** `02-roadmap.md` has the dependency graph and a suggested sequence that interleaves fixes with features so nothing is built on a broken foundation.

> Methodology note: these documents were produced with a plan-first workflow —
> exhaustive read-only audit of every surface, then design. They are meant to be
> edited in place as work lands; update the status tables rather than letting them rot.
