# Build Order

Each phase is independently testable before moving forward.

---

## Phase 0 — Infrastructure ✅
- `plan.md` at project root
- `docs/llm_wiki/` with all wiki files
- `docker-compose.yml` at root (Redis + MongoDB)

---

## Phase 1 — Fix Backend Skeleton ✅
- `package.json`, `index.ts`, `src/app.ts`, `tsconfig.json`, `.env`, `.gitignore`

---

## Phase 2 — Configs ✅
- `src/common/config/cloudinary.ts`
- `src/common/config/bullmq.ts` — detectionQueue + cropQueue + finalizeQueue

---

## Phase 3 — Job Store + Upload Route ✅
- `src/modules/jobs/job.types.ts` — JobStatus (10 states), JobHash, BoundingBox, Asset
- `src/modules/jobs/job.store.ts` — createJob, updateJob, getJob, parseBoxes, parseAssets
- `src/modules/jobs/job.routes.ts` — GET /api/jobs/:jobId, GET /api/jobs/:jobId/download
- `src/modules/upload/upload.controller.ts` — Cloudinary + format/dim validation + BullMQ
- `src/modules/upload/upload.routes.ts` — POST /api/upload (auth + multer 20MB)
- `src/common/utils/asyncHandler.ts` — .catch(next) wrapper for Express 4 async routes
- `src/common/utils/extractError.ts` — extracts py_backend detail from Axios errors

---

## Phase 4 — py_backend ✅
Full FastAPI service (rebuilt from old Google Vision → Gemini architecture):
- `app/main.py` — global exception handler → JSON 500
- `app/core/config.py` — GEMINI_API_KEY/MODEL; Vision removed
- `app/models/schemas.py` — DetectRequest/Response, TransparencyResponse, NameAssetsRequest/Response, CropRequest/Response, AssetResult
- `app/services/detection.py` — `find_bounding_boxes()` + `is_transparent()`
- `app/services/gemini.py` — annotate image → ONE Gemini call → structured JSON name map
- `app/services/image_io.py` — `download_image()`: fetch + decode + validate, raises 422
- `app/services/cloudinary_client.py` — `upload_bytes()`, raises 502 on failure
- `app/routers/detect.py` — POST /detect + POST /check-transparency
- `app/routers/name.py` — POST /name-assets
- `app/routers/crop.py` — POST /crop (Vision + crop_analyze removed)

---

## Phase 5 — Detection Worker ✅
- `src/modules/workers/detection.worker.ts` — transparency check → bg removal? → detect → status=detected
- `src/lib/py.client.ts` — checkTransparency, detectAssets, nameAssets, cropAssets
- `src/lib/cloudinary.transform.ts` — applyBackgroundRemoval, buildUpscaleUrl, pollUntilReady

---

## Phase 6 — Crop + Finalize Workers + Routes ✅
Phase A (crop):
- `src/modules/crop/crop.controller.ts` — POST /api/crop
- `src/modules/crop/crop.routes.ts`
- `src/modules/workers/crop.worker.ts` — naming → cropping → status=cropped

Phase B (finalize):
- `src/modules/finalize/finalize.controller.ts` — POST /api/finalize
- `src/modules/finalize/finalize.routes.ts`
- `src/modules/workers/finalize.worker.ts` — upscale selected → zip → status=ready
- `src/lib/zip.builder.ts` — buildAndUploadZip(items, jobId)

---

## Phase 6.5 — Frontend Restructure ✅
Feature/Domain-Driven architecture. See old build_order for details.

**Before Phase 7 install:**
```bash
pnpm dlx shadcn@latest add button badge skeleton separator tooltip sonner card progress sheet scroll-area input label dialog avatar dropdown-menu alert
pnpm add @tanstack/react-query react-dropzone konva react-konva
pnpm add -D @types/konva
```

---

## Phase 7 — Frontend Upload Page 🔲 NEXT

Flow: drop file → POST /api/upload → jobId → redirect /editor/[jobId]

Files:
- `src/features/upload/components/DropZone.tsx`
- `src/features/upload/components/UploadProgress.tsx`
- `src/features/upload/hooks/useFileUpload.ts`
- `src/components/layout/Navbar.tsx`
- `src/app/(dashboard)/layout.tsx`
- `src/app/(dashboard)/upload/page.tsx`
- `frontend/.env.local`

---

## Phase 8 — Frontend Konva Editor 🔲

Two sub-flows:
1. Poll until `status=detected` → show Konva canvas with boxes → user edits/names/deletes → POST /api/crop
2. Poll until `status=cropped` → show asset cards → user selects/deselects → POST /api/finalize
3. Poll until `status=ready` → enable download → GET /api/jobs/:jobId/download

Files:
- `src/features/editor/components/EditorCanvas.tsx`
- `src/features/editor/components/BoundingBoxLayer.tsx`
- `src/features/editor/components/BoxControls.tsx`
- `src/features/editor/components/AssetCards.tsx` — card grid with select/deselect
- `src/features/editor/components/ExportButton.tsx`
- `src/features/editor/hooks/useJobPolling.ts`
- `src/features/editor/hooks/useBoundingBoxes.ts`
- `src/app/(editor)/editor/[jobId]/page.tsx`

---

## Phase 9 — Polish + History 🔲
- Error states, loading skeletons
- `src/app/(dashboard)/history/page.tsx`

---

## Running Everything

```bash
# Terminal 1
docker-compose up -d

# Terminal 2
cd backend && npm run dev    # or pnpm dev

# Terminal 3 (Python 3.11 required)
cd py_backend && uvicorn app.main:app --reload

# Terminal 4
cd frontend && pnpm dev
```
