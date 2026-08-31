# Frontend — Next.js

**Location:** `frontend/`
**Port:** 3000
**Stack:** Next.js 16.2.6, React 19, Tailwind CSS 4, TypeScript, shadcn/ui
**Status:** ✅ Built end-to-end

**IMPORTANT:** In this version of Next.js, `params` in Server Components is a `Promise` and must be `await`ed.
See `frontend/AGENTS.md` for version-specific notes.

---

## Folder Structure

```
frontend/
  src/
    app/                                    # Routing layer ONLY — no business logic
      layout.tsx                            ✅ root layout (Geist fonts, metadata)
      page.tsx                              ✅ redirects to /upload
      globals.css                           ✅ Tailwind 4 + shadcn CSS vars
      (dashboard)/
        layout.tsx                          ✅ dashboard layout
        upload/
          page.tsx                          ✅ renders <DropZone />
        history/
          page.tsx                          placeholder
      (editor)/
        editor/[jobId]/
          page.tsx                          ✅ renders <EditorScreen jobId={jobId} />
          export/
            page.tsx                        ✅ renders <ExportScreen jobId={jobId} />
      (anibuddy)/
        layout.tsx                          ✅ flag gate: <AniBuddyEditor/> when
                                               NEXT_PUBLIC_ANIBUDDY_EDITOR_ENABLED is on,
                                               <ComingSoonPage/> otherwise
        anibuddy/page.tsx                   ✅ renders <AniBuddyEditor />

    features/
      upload/
        components/
          DropZone.tsx                      ✅ react-dropzone, drag-and-drop upload
          UploadProgress.tsx                ✅ progress + status display
        hooks/
          useFileUpload.ts                  ✅ handles upload → redirect to /editor/[jobId]
        services/
          uploadApi.ts                      ✅ uploadImage(), getJob()

      editor/
        components/
          EditorScreen.tsx                  ✅ layout: left panel + SVG canvas + right panel
          DetectionCanvas.tsx               ✅ SVG canvas — pan/zoom, draw/select/resize boxes
          AssetPanel.tsx                    ✅ left sidebar: box list + pipeline controls
          LayerProperties.tsx               ✅ right sidebar: selected box property editor
          Toolbar.tsx                       ✅ tool switcher (select/hand/draw)
          ZoomControls.tsx                  ✅ zoom +/- and fit-to-screen overlay
          ExportScreen.tsx                  ✅ SVG canvas review + Download / Upscale & Export
          ExportCanvas.tsx                  ✅ SVG canvas showing cropped assets, click-to-select
        hooks/
          useCanvasEditor.ts                ✅ camera, boxes, selection, draw state
          useExportCanvas.ts                ✅ camera state + fitToScreen for export page
          useJobPolling.ts                  ✅ polls GET /api/jobs/:jobId every 2s (max 120s)
        services/
          exportApi.ts                      ✅ startExport(), startFinalize(jobId, ids, names?, skipUpscale?)

      anibuddy/                             AniBuddy v4 — the thin editor half of F9.
                                            The v3 lib/, components/, hooks/, atlas/ and
                                            types.ts were deleted by the migration order.
        config/                             ✅ the only reader of NEXT_PUBLIC_ANIBUDDY_*
        rig/                                ✅ RigDocument v5 — GENERATED, never hand-edited
        kernel/                             ✅ FK, LBS, lattice, spline, warp, clip sampler.
                                               Mirrors py_backend's NumPy kernel; CI holds
                                               the pair to 0 ULP over 17 fixtures
        editor/                             ✅ WebGL renderer, viewport, hit test, IK solver,
                                               clip/part tracks, draw state, project client
          ui/                               ✅ AniBuddyEditor, RigViewport, ClipTimeline,
                                               Inspector, StagePanel, ProjectSetup
        proposal/                           ✅ server-side: strict response formats, the one
                                               propose-revalidate-retry caller, the three
                                               revalidators, internal-token auth
        api/anibuddyClient.ts               ✅ the concept-interview call only

    components/
      ui/                                   shadcn components
      layout/
        Navbar.tsx                          ✅ top nav with user menu
        ComingSoonPage.tsx                  ✅ served by the AniBuddy route while its flag is off

    lib/
      api-client.ts                         ✅ fetch wrapper (get, post, postForm) + Bearer auth
      utils.ts                              ✅ cn() — Tailwind class merger

    types/
      index.ts                              ✅ all shared types
```

---

## Routing URLs

| URL | Component | Status |
|---|---|---|
| `/` | page.tsx | ✅ redirects to `/upload` |
| `/upload` | DropZone | ✅ drag-drop upload |
| `/editor/[jobId]` | EditorScreen | ✅ canvas editor |
| `/editor/[jobId]/export` | ExportScreen | ✅ export review |
| `/history` | — | placeholder |

---

## Canvas Architecture

Both the editor and export pages use native SVG (not Konva). The same camera/pan/zoom pattern is shared.

### DetectionCanvas (editor)
- Camera: `translate(x,y) scale(zoom)` on a `<g>` wrapping everything
- Tools: select, hand, draw
- Interactions: pan (space+drag or hand tool), zoom (scroll), draw rects, resize via 8 handles, marquee select
- State: managed by `useCanvasEditor` hook

### ExportCanvas (export page)
- Same camera system — `<g transform="translate(x,y) scale(zoom)">`
- No draw/resize — click only to toggle selection
- Layout: CELL=200×200 world-px cells, GAP=32, COLS=6 per row
- Each cell: checkered bg (`#0c0c0e`/`#141416` pattern), `<image preserveAspectRatio="xMidYMid meet">`, green border when selected, name label below
- State: managed by `useExportCanvas` hook

---

## Export Page Flow

1. After crop completes → job status = `cropped` → EditorScreen auto-redirects to `/editor/[jobId]/export`
2. ExportScreen loads job via `useJobPolling`
3. All assets selected by default on first load
4. Two footer buttons:
   - **Download (n)** → `startFinalize(jobId, ids, undefined, true)` — skipUpscale=true, fast ZIP
   - **Upscale & Export (n)** → `startFinalize(jobId, ids, undefined, false)` — 2× AI upscale first
5. Job transitions: `cropped → finalizing → ready`
6. When ready: "Download ZIP" link appears

---

## API Client (`src/lib/api-client.ts`)

Central fetch wrapper. Auth via Bearer token from token store.

```typescript
apiClient.get<T>(path)
apiClient.post<T>(path, body?)
apiClient.postForm<T>(path, form)  // for file uploads
```

Base URL: `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"`

---

## Types (`src/types/index.ts`)

Mirrors `backend/src/modules/jobs/job.types.ts` — keep in sync.

```typescript
type JobStatus =
  | "uploaded" | "queued" | "detecting" | "removing_bg" | "detected"
  | "naming" | "cropping" | "cropped" | "finalizing" | "ready" | "failed"

interface BoundingBox { id, x, y, width, height, label?, croppedUrl? }
interface Asset { id, name, cropped_url, public_id }
interface JobResponse {
  jobId, status, cloudinaryUrl, workingUrl?, isTransparent?,
  imageWidth, imageHeight, boxes: BoundingBox[], assets?: Asset[],
  downloadUrl?, error?
}
interface UploadResponse { jobId, cloudinaryUrl, status: "queued" }
```

---

## tsconfig Path Alias

`@/*` → `./src/*`

Examples:
- `@/lib/utils` → `src/lib/utils.ts`
- `@/types` → `src/types/index.ts`
- `@/features/editor/components/ExportCanvas` → `src/features/editor/components/ExportCanvas.tsx`

---

## `.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```
