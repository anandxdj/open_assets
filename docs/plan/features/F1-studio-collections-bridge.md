# F1 — Studio → Collections Bridge

> **Theme A · Close the loop.** Originally scoped as "Phase 6" of the studio
> integration plan and deferred. Lets any of the five AI studios save their
> output into the platform's own Collections, with optional upscale-before-save.
> Also the natural place to finish the studio's auth/credit error UX (FX-07).
>
> **Priority:** P1 · **Effort:** L · **Depends on:** FX-07 folds in; benefits from F3 (storage parity) landing first so saved assets work on either provider.

---

## 1. Problem

The five studios (`/studio/extender`, `/parallax`, `/tiles`, `/sprites`, `/props`)
can only export to **local files**. Verified: a grep for `collection|SaveTo`
across all of `frontend/src/features/studio` returns zero matches. Every studio's
only output path is `handleDownload` / `handleExportZip` / `handleDownloadFull`.

Meanwhile the extraction editor *can* push results into Collections
(`features/collections/components/ExportToCollectionButton.tsx`, wired into
`ExportScreen.tsx:389`). So generation is a second-class citizen: a user makes a
gorgeous parallax background and the only thing they can do with it is download a
PNG. It never enters the gallery, never gets discovered, never compounds.

Secondary problem (FX-07): when generation fails for auth/credit reasons, the
studio hooks (`useExtender.ts:43-53` et al.) only fire a toast — there's no
button that opens sign-in or the BYOK modal. The save flow makes us confront and
finish this, because saving *requires* a signed-in account (BYOK users have no
server identity to attach a collection to).

---

## 2. Goals / non-goals

**Goals**
- A "Save to Collection" action available from every studio's result/export surface.
- Reuse the existing collections API and the existing `ExportToCollectionButton` UX pattern (ensure-collection → ensure-folder → push images) — no new collections backend if avoidable.
- Optional "upscale before save" toggle (2×), reusing the storage adapter's `applyUpscale`.
- Finish FX-07: `AUTH_REQUIRED` → interactive sign-in; `INSUFFICIENT_CREDITS` → BYOK upsell modal. Centralize so all five hooks share it.
- Work for multi-image studios (parallax = 4 layers, tiles = 13 roles, sprites = N frames, props = a growing library) — save as a folder of named PNGs, not one blob.

**Non-goals**
- No new studio modes.
- No change to how studios generate (canvas pipeline untouched).
- Not building the community/discovery layer (that's F5). This just gets content *in*.

---

## 3. Current state (what exists to build on)

| Piece | Where | State |
|---|---|---|
| Collections API client | `features/collections/api.ts` | Complete: `listMyCollections`, `createCollection`, `createFolder`, `exportJobToFolder`, image upload via `postForm`. |
| Editor's save UX | `features/collections/components/ExportToCollectionButton.tsx` | Working reference implementation of the ensure-collection→folder→push flow. |
| Backend add-images route | `collection.controller.ts:96-115` (`addImages`) | Accepts multipart files; persists `Image` docs. **Note:** no Gemini tagging yet (FX-06). |
| Studio credits/auth plumbing | `useStudioSettings.tsx`, `studioClient.ts` | `StudioApiError.code` threaded; credits badge live; BYOK flow exists. |
| BYOK vs signed-in identity | `useStudioSettings.tsx` | BYOK users have **no JWT** → cannot own a collection. Save must require sign-in. |
| Upscale path | `storage.applyUpscale` (both adapters) | Exists; used by finalize.worker. No HTTP endpoint to upscale an arbitrary data URL yet. |

**Key constraint discovered:** studio images live as **client-side data URLs / canvas
blobs**, not as anything the backend knows about. The save path must upload raw
bytes (multipart) — exactly what `addImages` multipart mode accepts. So the
backend likely needs **zero changes** for the basic save; the work is frontend +
(optionally) a small upscale endpoint.

---

## 4. Design

### 4.1 Save flow (per studio)

```
User clicks "Save to Collection" in a studio
   │
   ├─ not signed in?  → open SignInOrBYOKModal (FX-07). Saving needs an account.
   │                     (BYOK alone is not enough — explain why.)
   ▼
SaveToCollectionModal (new, shared component)
   1. pick existing collection  OR  type a name → createCollection
   2. pick existing folder       OR  type a name → createFolder
   3. [optional] toggle "Upscale 2× before saving"
   4. confirm
   ▼
For each studio image (layer / role / frame / prop):
   dataURL → Blob → File(named)         // names from the studio's own manifest
   ▼
[optional upscale] → POST /api/studio-assets/upscale (data URL in, upscaled URL out)
   ▼
exportJobToFolder-style multipart push → POST /api/collections/:id/folders/:fid/images
   ▼
toast success → link to /collections/:id
```

### 4.2 Naming (reuse each studio's manifest)

Each studio already computes human-readable names for its export ZIP — reuse them so saved files aren't `image_1.png`:
- **Parallax:** `sky.png`, `far.png`, `mid.png`, `near.png` + the `parallax.json` manifest as a sidecar (store as a text asset or in folder description).
- **Tiles:** the 13 role names (`body`, `edge_top`, `corner_outer_tl`, …) + atlas PNG.
- **Sprites:** per-frame names from the animation manifest; optionally the packed sheet too.
- **Props:** `resolvePropNames` already yields `lantern.png` not `prop_3.png` — reuse directly.

### 4.3 Optional upscale-before-save (new tiny backend endpoint)

The studios produce data URLs the backend has never seen, so the existing
finalize upscale path (which operates on already-uploaded crops) doesn't apply.
Add a minimal authenticated endpoint:

```
POST /api/studio-assets/upscale   (auth required; tight rate limit — cost path, see FX-11)
  body: multipart file OR { dataUrl }
  → storage.upload(bytes) → storage.applyUpscale(publicId) → { url, publicId, width, height }
```

This uploads, applies the provider's 2× transform (Cloudinary `e_upscale` /
ImageKit equivalent — **must work on both providers, so do F3 first**), and
returns the upscaled URL which the save step then references. If
upscale-before-save is too much scope for v1, ship the bridge without it and add
the toggle later (it's additive).

### 4.4 FX-07: centralized studio error handling

Create `features/studio/hooks/useStudioError.ts` (or extend `useStudioSettings`):

```ts
function handleStudioError(err: unknown) {
  if (err instanceof StudioApiError) {
    if (err.code === 'AUTH_REQUIRED')        return openSignInModal({ reason: 'studio-generate' });
    if (err.code === 'INSUFFICIENT_CREDITS') return openApiKeyModal({ upsell: true });
  }
  toast.error(messageFor(err));
}
```

Replace the five duplicated toast blocks (`useExtender.ts:43-53`,
`useParallax.ts:71-81`, `useTileStudio.ts:71-79`, `useSpriteStudio.ts:87-95`,
`usePropStudio.ts:52-60`) with a single call. The modals already exist
(`ApiKeyModal.tsx`); add a lightweight sign-in modal or route push to
`/login?next=<current studio path>`.

---

## 5. Backend changes

- **None required for basic save** — `addImages` multipart mode already accepts files. Verify it accepts a batch (multiple files in one request) and returns the created `Image` docs; if it's single-file, allow an array.
- **Optional:** `POST /api/studio-assets/upscale` (§4.3) — new tiny module `modules/studio-assets/`, auth-guarded, rate-limited (FX-11). ~1 controller + route. Depends on F3 for cross-provider correctness.
- **Recommended:** when FX-06 (Gemini tagging on add) lands, studio-saved assets get auto-tagged for free — no extra work here.

## 6. Frontend changes

- **New:** `features/studio/components/SaveToCollectionModal.tsx` — shared by all five studios; reuses `features/collections/api.ts`. Models on `ExportToCollectionButton.tsx`.
- **New:** `features/studio/hooks/useStudioError.ts` (FX-07).
- **New:** `features/studio/components/SignInPrompt.tsx` (or reuse auth modal) for `AUTH_REQUIRED`.
- **Per studio:** add a "Save to Collection" button next to the existing download/export action in each screen (`ExtenderScreen`, `ParallaxScreen`, `TilesScreen`, `SpritesScreen`, `PropsScreen`) and a `collectImagesForSave()` helper in each hook that returns `{name, blob}[]` from current state (parallax layers / tile roles / sprite frames / prop library / extender accepted result).
- **Wire** each studio hook's catch to `handleStudioError`.

## 7. Phased tasks

**Phase 1 — Error UX (FX-07), no save yet** *(S)*
1. `useStudioError.ts` + sign-in modal/route.
2. Swap five hooks to `handleStudioError`.
3. Verify: signed-out generate → sign-in opens; out-of-credits → BYOK modal opens.

**Phase 2 — Save (no upscale)** *(M)*
4. `SaveToCollectionModal` + `collectImagesForSave()` per studio.
5. Add buttons to all five screens.
6. Multipart batch push via existing collections API; success → link to collection.
7. Verify per studio (mock generation → save → assets appear in `/collections/:id` with correct names).

**Phase 3 — Upscale-before-save (optional, after F3)** *(M)*
8. `POST /api/studio-assets/upscale` endpoint (rate-limited).
9. Toggle in modal; pipe through upscale before push.
10. Verify on **both** storage providers.

## 8. Risks & mitigations

- **BYOK users can't save** (no account). → Modal explains: "Saving needs a free account; your OpenRouter key still works for generating." Don't silently fail.
- **Large batches** (props library can grow unbounded; sprite sheets many frames). → Cap per-save count or chunk uploads; show progress.
- **Upscale cost/abuse.** → Tight rate limit (FX-11); only on explicit toggle.
- **Provider drift** — upscale must work on ImageKit too. → Gate Phase 3 on F3.
- **Data-URL memory** — many large canvases at once. → Convert to Blob and release references promptly; upload sequentially or in small concurrency.

## 9. Verification

- Mock mode (`OPENROUTER_MOCK=1`) per studio: generate → Save to Collection → confirm folder structure + filenames in `/collections/:id`.
- Signed-out: Save prompts sign-in; BYOK-only: Save prompts sign-in with explanation.
- Out-of-credits generate: BYOK upsell modal opens (FX-07).
- Phase 3: upscaled asset dimensions are 2× on both Cloudinary and ImageKit.
- Add a collections integration test (overlaps F7) covering a multi-file `addImages` push.

## 10. Definition of done

All five studios have a working "Save to Collection" that produces a named folder
of PNGs in a user-owned collection; studio auth/credit errors open the right
modal instead of a dead toast; (if Phase 3) an upscale toggle works on both
providers. The studio integration plan's Phase 6 status flips to ✅.
