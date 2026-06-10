# Studio Integration Plan — image-extender → open_assets

> Integration of all five AI generation studios from
> [boona13/image-extender](https://github.com/boona13/image-extender) (MIT)
> into open_assets. This document is the full phase-by-phase plan plus live
> progress status. Attribution: see `frontend/src/features/studio/LICENSE-image-extender.txt`
> and the Credits section of the root README.

---

## 1. Context & goals

open_assets is an asset-**extraction** platform (upload sprite sheet → OpenCV
detect → Konva edit → crop → Gemini naming → upscale → ZIP/collections). It had
**zero image-generation features** — Gemini was vision-only (asset naming).

image-extender is an AI **generation** tool: directional outpainting with
Poisson-blended seams plus four game-asset studios (parallax backgrounds,
autotile sets, sprite animation sheets, prop libraries), powered by Gemini
image models through OpenRouter, with all canvas processing client-side.

Goal: all five studios live inside open_assets under a new `/studio` area.

### Fixed decisions

1. **Scope**: all 5 modes — Extender, Parallax, Tile, Sprite, Props — shipped in phases.
2. **Key model — hybrid**:
   - Server `OPENROUTER_API_KEY` powers a free tier metered by per-user credits
     (150/month, lazily reset).
   - BYOK: a user-supplied OpenRouter key in browser localStorage bypasses
     auth + credits entirely. Key is sent per-request in the
     `X-OpenRouter-Key` header, never persisted server-side.
3. **Architecture — frontend-contained**: studios are Next.js pages + Next.js
   API route proxies (`frontend/src/app/api/studio/*`); all image processing
   (Poisson blend, seam scoring, chroma keying, atlas building) stays
   client-side on raw HTML canvas (NOT rewritten to Konva). The Express
   backend gains only a `usage` (credits) module.

### Source scale

~430KB TypeScript ported. Largest upstream files:

| upstream file | size | what |
|---|---|---|
| `app/page.tsx` | 155KB / 3851 lines | monolith with ALL mode UIs + handlers — **split, never ported whole** |
| `app/utils/imageProcessor.ts` | 132KB | canvas engine: Poisson (Gauss-Seidel ≤250 iter), 8px mask growth, color-drift pre-correction, seam residual scoring, chroma keying, tiling/healing |
| `app/api/generate/route.ts` | 95KB | text-to-image + all studio sheet prompts (serves phases 2–5) |
| `app/lib/tileset.ts` | 42KB | deterministic autotile logic: template masks, corner reconciliation, extrude padding |
| `app/components/ParallaxStudio.tsx` | 45KB | layer rail, live scroll preview, width presets |

---

## 2. Architecture

### 2.1 Hybrid key flow (every `/api/studio/*` route)

```
Client (studioClient.ts) → Next route handler:
  1. X-OpenRouter-Key header present → BYOK path.
     Use it directly. No auth, no credits. Never persisted/logged.
  2. else → free tier:
     a. Authorization header missing → 401 { code: 'AUTH_REQUIRED' }
     b. POST ${EXPRESS_INTERNAL_URL}/api/usage/consume
        (Authorization forwarded — Express verifies the JWT; the Next server
        never holds JWT secrets)
        body { op, model, units } → 200 { eventId, remaining } | 402 | 401
     c. key = process.env.OPENROUTER_API_KEY  (server-only env)
  3. OPENROUTER_MOCK=1 → return deterministic fixture (after steps 1–2,
     so auth/credits are still exercised in tests)
  4. Call OpenRouter (openrouter.ai/api/v1/chat/completions).
     On non-retryable failure with credits consumed:
     POST /api/usage/refund { eventId } with x-service-token header
     (refund is service-token-only — browsers must never call it)
```

Shared plumbing lives in `frontend/src/app/api/studio/_lib/openrouter.ts`:
`resolveKeyAndCredits()`, `refundCredits()`, `callOpenRouter()`,
`extractImageFromAny()` (walks arbitrary provider response shapes),
`sanitizeForLogging()`, and mock-mode PNG fixtures (hand-rolled RGBA PNG
encoder via `node:zlib` — the Next server has no canvas).

### 2.2 Credits system (Express backend)

- `User` schema (`backend/src/modules/auth/auth.model.ts`) gained:
  `credits` (default 150), `creditsGrantedAt`, `plan: 'free'|'byok'|'pro'`.
- New module `backend/src/modules/usage/`:
  - `usage.model.ts` — `UsageEvent { user, op, modelId, units, cost, status: consumed|refunded }` (audit trail + refund idempotency).
  - `usage.service.ts` — `consume()`: lazy monthly grant reset, then atomic
    `findOneAndUpdate({_id, credits: {$gte: cost}}, {$inc: {credits: -cost}})`
    (no match → 402). `refund()`: idempotent status flip + `$inc` back.
    `costPerUnit()` — **server-authoritative cost table** (client `units` is
    advisory; cost always derived from `(op, model)` server-side).
  - Routes: `GET /api/usage/me` (auth), `POST /api/usage/consume` (auth + zod),
    `POST /api/usage/refund` (x-service-token only).
- Cost table:

| op | model class | credits/call |
|---|---|---|
| extend / generate | gemini flash image (2.5, 3.1) | 1 |
| extend / generate | gemini-3-pro-image | 4 |
| extend / generate | openai gpt-image | 10 |
| scene-brief / prop-brief / tile-review / sprite-review | gemini-2.0-flash reasoning | 1 |

- Best-of-3 horizontal extend = 3 separate consume calls, each individually
  refundable.

### 2.3 Frontend layout

```
frontend/src/app/(studio)/
  layout.tsx                  Navbar + StudioSettingsProvider + StudioShell
                              (no auth redirect — BYOK works signed-out;
                               generation 401/402s open sign-in/BYOK prompts)
  studio/page.tsx             redirect to last-used mode (localStorage) or /studio/extender
  studio/extender/page.tsx    Phase 1
  studio/parallax/page.tsx    Phase 2
  studio/tiles/page.tsx       Phase 3
  studio/sprites/page.tsx     Phase 4
  studio/props/page.tsx       Phase 5

frontend/src/app/api/studio/
  _lib/openrouter.ts          shared hybrid-key/mock/parse plumbing   [Phase 0]
  extend/route.ts             directional outpainting                 [Phase 1]
  generate/route.ts           text-to-image + studio sheets           [Phase 2]
  scene-brief/route.ts        shared art-direction derivation         [Phase 2]
  tile-review/route.ts        vision QA for tiles                     [Phase 3]
  sprite-review/route.ts      vision QA for sprites                   [Phase 4]
  prop-brief/route.ts         art-director prop briefs                [Phase 5]

frontend/src/features/studio/
  LICENSE-image-extender.txt  upstream MIT license
  api/studioClient.ts         relative fetch wrapper: Authorization +
                              X-OpenRouter-Key headers, 401 refresh retry,
                              typed StudioApiError (AUTH_REQUIRED /
                              INSUFFICIENT_CREDITS codes)
  hooks/useStudioSettings.tsx provider: BYOK key + model (localStorage via
                              useSyncExternalStore, upstream storage keys
                              kept: extender:api_key / extender:model /
                              extender:mode), debug flag, credits balance
  hooks/useExtender.ts        Phase 1 — extend state machine
  hooks/useParallax.ts        Phase 2 (+ useSceneBrief, shared with tiles)
  hooks/useTileStudio.ts      Phase 3
  hooks/useSpriteStudio.ts    Phase 4
  hooks/usePropStudio.ts      Phase 5
  components/StudioShell.tsx  mode tabs, credits badge, settings gear
  components/SettingsDrawer.tsx / ApiKeyModal.tsx / ComingSoon.tsx
  components/{TopBar,CommandBar,Workspace,EmptyState,VariantSelector}.tsx [P1]
  parallax/ tiles/ sprites/ props/   per-mode components [P2–P5]
  lib/                        ported pure-TS domain logic:
    app.ts models.ts artStyles.ts imageProcessor.ts        [Phase 0]
    parallax.ts props.ts sprite.ts tileset.ts bodyPlans.ts [Phase 0 port, used P2–P5]
    rig/{poseRig,rigCore,biped,blob,flyer,quadruped,serpent}.ts [P4]
```

Import rewrites applied during port:
`@/app/lib/X` → `@/features/studio/lib/X`,
`@/app/utils/imageProcessor` → `@/features/studio/lib/imageProcessor`,
`@/app/utils/rig*` → `@/features/studio/lib/rig/*`.
Every ported file carries `// Adapted from boona13/image-extender (MIT)`.

### 2.4 Environment variables

| where | var | purpose |
|---|---|---|
| frontend (server-only) | `OPENROUTER_API_KEY` | free-tier OpenRouter key |
| frontend (server-only) | `EXPRESS_INTERNAL_URL` | Express reachable from Next server (default `http://localhost:4000`) |
| frontend (server-only) | `INTERNAL_SERVICE_TOKEN` | shared secret for refund calls |
| frontend (server-only) | `OPENROUTER_MOCK` | `1` → fixture responses, zero spend |
| backend | `INTERNAL_SERVICE_TOKEN` | must match frontend's |

See `frontend/.env.example` and `backend/.env.example`.

### 2.5 Theme adaptation rules

Upstream is a Tailwind-3 dark studio (zinc surfaces, rounded-xl, amber accent
CSS vars). Target is Tailwind 4 + OKLCH tokens, brutalist monospace
(`frontend/src/app/globals.css`), light+dark via next-themes. Mechanical
per-component rules:

| upstream | replacement |
|---|---|
| `var(--bg-elev)` / `bg-zinc-900/950` / `bg-black` | `bg-background` / `bg-card` |
| `var(--text-*)` / `text-zinc-*` | `text-foreground` / `text-muted-foreground` |
| `var(--border*)` | `border-border`; emphasis `border-2 border-zinc-950 dark:border-zinc-800` (Navbar precedent) |
| `rounded-full/lg/xl` | `rounded-none` |
| amber accent buttons | inverted block: `bg-zinc-950 text-white dark:bg-white dark:text-black font-black uppercase` |
| chrome typography | `font-mono text-xs uppercase font-bold` |
| custom ErrorToast / Toggle | `sonner` toasts / restyled switch |
| inline `Icons.*` SVGs | `lucide-react` equivalents |

Functional canvas colors are KEPT: checkerboard alpha background, magenta
`#FF00FF` chroma previews, pose-guide colors.

### 2.6 React 19 / Next 16 gotchas (apply during every phase)

- `useRef()` requires an explicit argument; upstream has bare refs.
- New `react-hooks` lint rules forbid sync `setState` in effects → use
  `useSyncExternalStore` for localStorage state, conditional-mount for modals
  (state initializes fresh per open), async-fetch-with-cancelled-flag for data.
- StrictMode double-invokes effects in dev: auto-extend loop, tile loop,
  sprite animation player must be idempotent (upstream stop-ref pattern is
  kept; verify no double-start).
- No render-time/module-scope `localStorage` reads (SSR executes client
  component render once on the server).
- Route handlers: `request.headers` is sync (fine); add
  `export const maxDuration = 300` on image routes (GPT image ≈ 240s/call).
- Per `frontend/AGENTS.md`: consult `node_modules/next/dist/docs/` before
  writing Next code — this build deviates from public docs.

---

## 3. Phases

### Phase 0 — Shared infrastructure ✅ DONE

Deliverable: `/studio` exists with mode tabs, settings/BYOK, credits plumbing,
mock mode. No generation shipped yet.

Completed work:
1. `scratch/` gitignored; upstream cloned to `scratch/image-extender`;
   LICENSE copied; README Credits section added.
2. Backend: User credits fields; `usage` module (model/service/controller/
   routes/dto); registered in `app.ts`; `INTERNAL_SERVICE_TOKEN` env;
   `usage.test.ts` (cost table, schema clamps, + atomic-race test that runs
   when `MONGO_URI` is set: 10 parallel consumes vs 5 credits → exactly 5
   succeed). Note: UsageEvent field is `modelId` (`model` collides with
   mongoose `Document.model()`).
3. Ported all 16 pure lib files (incl. 132KB imageProcessor) — compile clean
   under strict TS 5.9 / React 19 types.
4. `_lib/openrouter.ts` (see §2.1).
5. Studio shell: `(studio)` layout, StudioShell (tabs + credits badge +
   settings), SettingsDrawer, ApiKeyModal, ComingSoon placeholders, redirect
   page, Navbar "Studio" link.
6. `studioClient.ts`; `refreshAccessToken` exported from `api-client.ts`.

Verification status: frontend `tsc --noEmit` clean; studio-scoped ESLint
clean; backend typecheck + 12 unit tests green (race test skips without
Mongo).

### Phase 1 — Extender (`/studio/extender`) ⏳ IN PROGRESS

Port:
- `app/api/extend/route.ts` → `api/studio/extend/route.ts`. Replace upstream
  body-`apiKey` block with `resolveKeyAndCredits(request, 'extend', model)`;
  refund on failure; mock fixture sized to `extensionInfo.newWidth/Height`
  (or chunk dims); keep the full prompt-builder (direction descriptions,
  art styles, parallax layer roles, scene brief, output-dimension contract).
- Components → `features/studio/components/`: `Workspace` (image frame +
  EdgeHandle × 4 + meta row), `CommandBar` (prompt + style picker; scene-brief
  block used by P2), `EmptyState` (drop zone + generate link), `TopBar` →
  **absorbed into StudioShell** (mode tabs already exist; only "New image"
  button + StatusPill survive), `VariantSelector` + `ResultActions`.
- `hooks/useExtender.ts` — extracted from monolith lines ~28–62 (state),
  ~424–508 (loaders), ~605–967 (handlers), extender-only branches (parallax
  dispatch deleted):
  - state: selectedImage, originalFileName, extendedCandidates,
    selectedCandidateIdx, candidateDims, currentImageDimensions,
    imageBeforeExtension, lastExtensionParams, loading, activeDirection,
    error, progressMsg, customPrompt, artStyle
  - `runExtend()`: horizontal → best-of-`maxAttempts` loop
    (`createFullContextExtension` → API → `isAiExtensionUnfilled` guard →
    `applyFullContextResult` Poisson blend → `measureSeamResidual` → sort by
    score); vertical → single chunked pass (`createChunkedExtension` →
    `stitchExtendedChunk`); 1s elapsed-seconds progress ticker.
  - `handleExtend/handleRegenerate/handleAccept/handleDiscard/
    handleDownload/handleNewImage`, `cycleVariant`, `adoptCandidates`.
  - Errors: `StudioApiError` code AUTH_REQUIRED → sign-in/BYOK prompt;
    INSUFFICIENT_CREDITS → BYOK upsell; others → sonner toast.
    `refreshCredits()` after each run (free tier).
- Keyboard shortcuts (monolith ~3690–3744): arrows = extend direction;
  with result: ←/→ cycle variants, Enter accept, Esc discard, R regenerate.
  Scoped to ExtenderScreen, skipped when focus is in input/textarea.
- `ExtenderScreen.tsx` composes EmptyState ↔ Workspace + CommandBar +
  hidden file input.

Deferred from P1: GenerateModal + `/api/generate` ("generate from scratch")
ships in Phase 2 — extender starts upload-only.

Verify (mock mode): upload PNG → extend right → 3 candidates cycle (←/→) →
accept → extend again → undo path → download with `_v{n}` tag; credits badge
decrements by 3 per horizontal run; forced network failure refunds; one
real-key smoke test (1–3 credits).

### Phase 2 — Parallax Studio (`/studio/parallax`) ⏸ PENDING

Port:
- `app/api/generate/route.ts` (95KB — text-to-image + ALL studio sheet
  prompt-builders; port whole, integrate `_lib`, op = `'generate'`) and
  `app/api/scene-brief/route.ts` (reasoning model derives shared art
  direction from the Near-layer prompt).
- `lib/parallax.ts` already ported: `LAYER_ORDER` (sky/far/mid/near),
  `WORKFLOW_ORDER` (near-first), width presets 3840–15360px,
  `PARALLAX_MAX_AUTO_STEPS`, prerequisite hints.
- `ParallaxStudio.tsx` (45KB) → `features/studio/parallax/`, split:
  `ParallaxStudio` (orchestrator), `LayerRail` (4 layer cards: thumbnail,
  scroll-speed slider, clear), `ParallaxPreview` (live multi-layer scroll
  compositor — `MultiLayerPreview` in upstream Workspace.tsx),
  `WidthPresetPicker`, `GenerateModal` (from upstream Modals.tsx, with
  scene-brief + workflow-note props).
- `hooks/useParallax.ts` from monolith: parallaxLayers state,
  activeIdx, applyImageToActiveLayer (chroma-key non-sky uploads),
  patchActiveLayer/clearLayer/setLayerScrollSpeed, handleAutoExtend
  (repeat-right loop to target width: auto-accepts best candidate each step,
  cumulative drift correction, stop ref), handleHarmonizeActiveLayer
  (`harmonizeHorizontalSeams`), handleMakeActiveLayerTileable
  (`makeHorizontallyTileable` half-offset healing), handleDownloadFull,
  handleExportZip (4 PNGs + `parallax.json` manifest: depth, scrollSpeed,
  dims).
- `hooks/useSceneBrief.ts` — shared store (parallax + tiles + props read it),
  persisted to localStorage so it survives navigation between studio pages.
- Reuses P1's Workspace/CommandBar/VariantSelector for the active layer
  (extend keyed layers passes `layerRole` + scene brief to /api/extend;
  keyed candidates carry `rawImageUrl` magenta source per upstream
  `Candidate` type).
- Extract `triggerDownload`/blob helpers from
  `features/editor/services/localExport.ts` → `lib/download.ts`; import from
  both (parallax ZIP uses jszip like upstream).

Verify (mock): generate Near (magenta fixture keys to alpha) → derive brief →
Mid/Far/Sky → auto-extend to 3840 preset → preview scrolls 4 layers at
different speeds → make-tileable → ZIP contains 4 PNGs + parallax.json with
correct dims/speeds.

### Phase 3 — Tile Studio (`/studio/tiles`) ⏸ PENDING

Port:
- `app/api/tile-review/route.ts` — vision art-director QA: reviews composited
  platform preview, returns scoped painter-fixable defect list + score.
  (`skipsArtDirectorReview()` bypasses for OpenAI models.)
- `lib/tileset.ts` already ported (42KB): 13 roles (body, 4 edges, 4 outer
  corners, 4 inner corners), template mask + guide builder, `alignAiOutputToTemplate`,
  `applyFeatheredRoleMask`, `reconcileAllCorners`/`rebuildCornerTile`
  (deterministic corner grafts from edge strips), atlas constants incl.
  extrude padding (`TILESET_ATLAS_EXTRUDE_PX`).
- `TileStudio.tsx` → `features/studio/tiles/` (13-slot grid + material
  presets + prompt + progress).
- `hooks/useTileStudio.ts` from monolith (~969–1801): handleGenerateTileSet
  (single template-guided img2img call → slice → align → mask → corner
  reconcile → optional vision QA loop with keep-best commit), per-role
  regenerate, buildTileSheet/PaddedTileSheet data URLs, manifest, sheet/ZIP
  download, stop ref.

Verify (mock): generate → 13 slots fill from magenta fixture → corners
reconciled → atlas PNG has extrude padding (inspect) → ZIP manifest lists
roles; per-role reroll consumes 1 credit.

### Phase 4 — Sprite Studio (`/studio/sprites`) ⏸ PENDING

Port:
- `app/api/sprite-review/route.ts` (used by upstream pipeline where
  applicable — sprite mode relies mostly on deterministic checks).
- `lib/sprite.ts`, `lib/bodyPlans.ts`, `lib/rig/*` already ported: 5 body
  plans (biped, quadruped, serpent, flyer, blob), per-plan animation sets,
  frame/sheet constants, pose-guide rigs.
- `SpriteStudio.tsx` (32KB) → `features/studio/sprites/` + extracted
  `AnimationPlayer` (live frame player + scrubber; FPS control; RAF/interval
  must be StrictMode-safe).
- `hooks/useSpriteStudio.ts` from monolith (~2292–3314): two-pass workflow —
  `runSpriteAnchorPass` (locks character identity on magenta key; reroll;
  or build anchor from upload via `removeUploadedBackground` +
  `isolatePrimarySpriteComponent`), `runSpriteSheetPass` (pose-guide sheet via
  `drawPoseGuideSheet` + anchor attach → 4×2 frames), deterministic post:
  `normalizeSpriteFrameScale`, `alignSpriteFramesToBaseline`,
  `centerSpriteFramesHorizontally`, twin detection (morphological opening),
  per-anim sheet cache, frame toggle, manifest + sheet/ZIP export.

Verify (mock): anchor → sheet fills 8 frames → frames baseline-aligned →
player runs at chosen FPS → toggle frame excludes it from export → ZIP has
per-frame PNGs + manifest.

### Phase 5 — Props Studio (`/studio/props`) ⏸ PENDING

Port:
- `app/api/prop-brief/route.ts` — reasoning art director invents N distinct
  prop categories (text dedup vs existing tallies) before painting.
- `lib/props.ts` already ported: batch dims (8 per call), atlas layout,
  `resolvePropNames` (human-readable filenames: `lantern.png` not `prop_3.png`),
  8 biome presets.
- `PropStudio.tsx` (15KB) → `features/studio/props/`.
- `hooks/usePropStudio.ts` from monolith (~1802–2291): handleAddPropBatch
  (brief → paint batch sheet → slice via `sliceImageGrid` → chroma-key →
  append), per-prop regenerate/delete, style-ref builder (existing props
  steer new batches), transparent atlas + ZIP export, stop ref, unbounded
  library growth.

Verify (mock): add batch → 8 transparent sprites appear → add second batch
(brief avoids repeats) → single reroll consumes 1 credit → atlas + ZIP
exports with named files.

### Phase 6 (optional) — Platform integration ⏸ PENDING

- **Save to collection** from any studio: data URL → Blob → FormData →
  existing `apiClient.postForm` collections image endpoint (multer accepts;
  zero backend change). `SaveToCollectionModal` reusing
  `features/collections/api.ts` (`listMyCollections`, `createFolder`).
- Optional Cloudinary `e_upscale` before save (existing
  `storage.applyUpscale` path) — needs a small backend endpoint; scope
  decided in-phase.
- Surface studio exports in `/dashboard/history` (nice-to-have).

---

## 4. Verification strategy (no credit burn)

**Mock mode** — `OPENROUTER_MOCK=1` in `frontend/.env.local`:
`_lib/openrouter.ts` short-circuits AFTER key/credits resolution and returns
deterministic fixtures: gradient PNGs sized to the request (magenta
`#FF00FF` for chroma-keyed modes — parallax keyed layers, tiles, sprites,
props), canned JSON verdicts for brief/review routes. Exercises the entire
client canvas pipeline + auth + credits + refunds with zero API spend.

Every phase additionally:
- `npx tsc --noEmit` + studio-scoped ESLint in `frontend/`
  (repo-wide lint has pre-existing failures — only studio files must be clean).
- `pnpm typecheck && pnpm test` in `backend/` (usage race test needs
  `MONGO_URI`).
- One real-OpenRouter smoke test per image route when it ships (1–3 credits).

Credits/auth matrix (curl, Phase 0 — repeatable):
- consume until 402; refund with + without service token (403);
  `GET /api/usage/me` reflects balance; BYOK header skips consume entirely.

---

## 5. Progress tracker

| Phase | Status | Notes |
|---|---|---|
| 0 — infra | ✅ done | backend tests green; tsc + lint clean |
| 1 — Extender | ✅ done | mock-mode curl verified (PNG fixture sized to request; 401 path) |
| 2 — Parallax | ✅ done | generate + scene-brief routes; shared extendRunner; LayerRail/Preview/TargetBar split |
| 3 — Tiles | ✅ done | tile-review route; QA keep-best loop; padded atlas export |
| 4 — Sprites | ✅ done | sprite-review route (vision QA disabled by design — deterministic twin check); pose-rig guide; sheet cache as state (lint-safe) |
| 5 — Props | ✅ done | prop-brief route; art-director→painter pipeline; atlas/ZIP export |
| 6 — Collections integration | ⏸ optional | save-to-collection + upscale-before-save not started |

All `/api/studio/*` routes mock-smoke-tested (`OPENROUTER_MOCK=1` + BYOK header):
extend ✓ generate ✓ scene-brief ✓ tile-review ✓ sprite-review ✓ prop-brief ✓, plus
401 AUTH_REQUIRED without keys ✓. `next build` green (all 6 studio routes + 5 pages
registered). Frontend `tsc --noEmit` + studio-scoped ESLint clean. Backend
typecheck + 12 tests green (atomic-race test runs when MONGO_URI set).

Still to verify manually (needs running Mongo/Redis + real key):
free-tier consume/402/refund flow end-to-end; one real-OpenRouter smoke per
image route; in-browser canvas pipeline runs per mode (mock fixtures).

Files created/modified so far (Phase 0):

- **Backend new**: `src/modules/usage/{usage.model,usage.service,usage.controller,usage.routes}.ts`, `src/modules/usage/dto/consume.schema.ts`, `src/__tests__/usage.test.ts`
- **Backend modified**: `src/modules/auth/auth.model.ts` (credits fields), `src/app.ts` (router), `.env.example`
- **Frontend new**: `src/app/(studio)/**` (layout, redirect, 5 placeholder pages), `src/app/api/studio/_lib/openrouter.ts`, `src/features/studio/**` (lib ×16, api/studioClient, hooks/useStudioSettings, components: StudioShell/SettingsDrawer/ApiKeyModal/ComingSoon, LICENSE), `.env.example`
- **Frontend modified**: `src/components/layout/Navbar.tsx` (Studio link), `src/lib/api-client.ts` (export refreshAccessToken)
- **Root**: `.gitignore` (scratch/), `README.md` (Credits)
