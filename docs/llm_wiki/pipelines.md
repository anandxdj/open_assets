# Pipelines

## Pipeline 1: Asset Detection ✅ BUILT

**Goal:** One large image → bounding boxes with auto-names for each asset.

**Flow:**
```
POST /api/upload (multipart, auth required)
  → multer memory buffer (20MB limit, images only)
  → Cloudinary upload_stream (folder: open_assets/originals, public_id: jobId)
  → Redis createJob { status: 'uploaded', cloudinaryUrl, publicId, userId }
  → detectionQueue.add({ jobId, cloudinaryUrl })
  → Redis updateJob { status: 'queued' }
  → Response: { jobId, cloudinaryUrl, status: 'queued' }

detection.worker.ts picks up job:
  → Redis updateJob { status: 'detecting' }
  → py.client.checkTransparency(cloudinaryUrl)
      → if not transparent: applyBackgroundRemoval(publicId)
          → Redis updateJob { status: 'removing_bg', workingUrl }
          → pollUntilReady(bgRemovedUrl) [up to 120s]
          → workingUrl = bgRemovedUrl
      → if transparent: workingUrl = cloudinaryUrl
  → Redis updateJob { isTransparent, workingUrl }
  → py.client.detectAssets(workingUrl)
    → py_backend POST /detect
      → httpx downloads image
      → cv2.imdecode → numpy array
      → detection.py: find_bounding_boxes(img)
          use alpha channel as mask
          dilate(3x3 kernel) to merge close fragments
          findContours(RETR_EXTERNAL) → boundingRect per contour
          filter: w≥20, h≥20, area≥400
          sort top-to-bottom, left-to-right (row_bucket=y//50)
          name: asset_001, asset_002, asset_003...
      → return DetectResponse { boxes: [DetectedBox], image_width, image_height }
  → Map DetectedBox → BoundingBox (name → label field)
  → Redis updateJob { status: 'detected', boxes: JSON, imageWidth, imageHeight }
```

---

## Pipeline 2: Asset Extraction / Cropping ✅ BUILT

**Goal:** User-confirmed boxes → Gemini-named, individually cropped PNGs uploaded to Cloudinary.

```
POST /api/crop { jobId, boxes: BoundingBox[] }
  → Redis updateJob { boxes: JSON }  ← save user's edited boxes
  → cropQueue.add({ jobId })

crop.worker.ts picks up job:
  → Redis updateJob { status: 'naming' }
  → PARALLEL:
      A) py.client.nameAssets(workingUrl, boxes)
           → py_backend POST /name-assets
               → Annotate image with red-outlined boxes
               → Gemini 2.0 Flash: analyze image → return snake_case names per box
               → Return { names: Record<systematicId, geminiName> }
      B) (BG removal already done in Pipeline 1 — workingUrl is transparent)
  → Apply nameMap to boxes: boxes[i].label = names[boxes[i].id] ?? boxes[i].label
  → Redis updateJob { status: 'cropping', nameMap: JSON }
  → py.client.cropAssets(workingUrl, boxes, jobId)
    → py_backend POST /crop
        → Download image once (httpx)
        → For each box:
            crop: img[y:y+h, x:x+w] (coords clamped to image bounds)
            cv2.imencode('.png', cropped)
            cloudinary_client.upload_bytes(
              folder: open_assets/crops/{job_id},
              public_id: box.name  ← Gemini-assigned filename
            )
        → Return { assets: [{ id, name, cropped_url, public_id }] }
  → Redis updateJob { status: 'cropped', assets: JSON }
```

After `cropped` status: frontend auto-redirects to `/editor/[jobId]/export`.

---

## Pipeline 3: Export — Download (no upscale) ✅ BUILT

**Goal:** Selected cropped assets → ZIP using original crop URLs, fast.

```
POST /api/finalize { jobId, selectedIds: string[], skipUpscale: true }
  → Validate selectedIds against stored assets
  → Redis updateJob { selectedIds: JSON, skipUpscale: 'true' }
  → finalizeQueue.add({ jobId })

finalize.worker.ts:
  → Redis updateJob { status: 'finalizing' }
  → skipUpscale === true → use asset.cropped_url directly (no Cloudinary polling)
  → buildAndUploadZip(items, jobId)
      → archiver: zip each PNG (downloaded from cropped_url) + metadata.json
      → Cloudinary upload zip (resource_type: raw, folder: open_assets/exports)
  → Redis updateJob { status: 'ready', downloadUrl }

GET /api/jobs/:jobId/download → 302 to Cloudinary zip URL
```

---

## Pipeline 4: Export — Upscale & Export ✅ BUILT

**Goal:** Selected cropped assets → 2× AI upscaled PNGs → ZIP.

```
POST /api/finalize { jobId, selectedIds: string[], skipUpscale: false }
  → Validate selectedIds against stored assets
  → Redis updateJob { selectedIds: JSON, skipUpscale: 'false' }
  → finalizeQueue.add({ jobId })

finalize.worker.ts:
  → Redis updateJob { status: 'finalizing' }
  → skipUpscale === false → for each selected asset:
      buildUpscaleUrl(asset.public_id)  ← Cloudinary e_upscale transform URL
      pollUntilReady(upscaledUrl)        ← retries on 202/420/423/425, 120s timeout
      items.push({ name, url: upscaledUrl })
  → buildAndUploadZip(items, jobId)
  → Redis updateJob { status: 'ready', downloadUrl }
```

---

## Pipeline 4: AniBuddy v4 layered cutout ✅ BUILT, dark behind a flag

**Goal:** one sheet of character art the user already owns → a rigged, animated,
downloadable clip, with no pixel generated.

Contract: [`docs/plan/features/F9-anibuddy-v4-cutout-rig.md`](../plan/features/F9-anibuddy-v4-cutout-rig.md).

Six stages. Each is an idempotent BullMQ worker keyed by `inputHash`, each writes
an immutable child revision of the `RigDocument` rather than mutating one, and
each appends a `StageRecord` naming the model that was actually served and the
credit event it belongs to.

```
POST /api/anibuddy/assets                 sheet → StorageAdapter, sha256 recorded
POST /api/anibuddy/projects/:id/enqueue   one stage, credits pre-authorized

1. decompose   py_backend /anibuddy/decompose
     alpha connected components → gutter grid → cv2.watershed → cv2.grabCut,
     cheapest first, each with its own confidence. Emits foreground vs covered
     pixel counts so the stage grades its own work. No model call.

2. semantics   Next /api/enhance/anibuddy/semantics
     the ONLY place a model touches structure. Sees the sheet with numbered
     part outlines (drawn by py_backend, proxied through the gateway's
     /anibuddy/internal/annotate) and answers with roles, parentage, pivot
     HINTS, draw order and deformer hints. It cannot answer with geometry.
     No consent, or two rejected responses → the geometric prior, free.

3. rig         py_backend /anibuddy/rig
     skeleton inference, then one deformer per part: rigid, mesh (contour →
     RDP → Poisson sampling → quality triangulation → bounded biharmonic
     weights), lattice or spline. Oversized buffers come back as base64 for
     the gateway to write through storage.

4. animate     Next /api/enhance/anibuddy/motion
     bounded keyframes against the rig's REAL part and joint ids. Unknown id,
     t outside 0..1, first key not at 0, non-increasing t, fewer than two
     usable keys → reject the whole response and refund. A partially applied
     clip is worse than none, because it looks deliberate.

5. render      py_backend /anibuddy/render
     deform, rasterize, encode to PNG zip / GIF / WebM / MP4. Refuses before
     spending a frame when diagnostics carry a blockingReason; discloses a
     maxStretch over 2.5 rather than hiding it; falls back to the PNG zip when
     ffmpeg is missing.

6. critique    py_backend contact sheet → Next /api/enhance/anibuddy/critique
     nine REALLY-RENDERED frames, not the model's own plan. Answers accept /
     revise / abort plus corrections from a closed set — pivot nudge, rotation
     damp, z-order, deformer swap, parent change, keyframe retime, visibility.
     Every payload is a bounded scalar or an id; there is no field through
     which geometry can enter.
        └─► corrections re-enter at stage 3, up to MAX_CRITIQUE_PASSES (3) or
            CRITIQUE_CREDIT_CEILING (24), whichever comes first. The BEST
            revision is then selected, not the last: lowest maxStretch among
            revisions with no flipped triangles and no blockingReason.
```

Both flags are off by default: `NEXT_PUBLIC_ANIBUDDY_EDITOR_ENABLED` (the route)
and `ANIBUDDY_PIPELINE_ENABLED` (the proposal routes).

---

## Key API Contracts

### POST /api/upload → `{ jobId, cloudinaryUrl, status: "queued" }`
### GET /api/jobs/:jobId → `{ jobId, status, cloudinaryUrl, workingUrl?, imageWidth, imageHeight, boxes, assets, downloadUrl?, error? }`
### GET /api/jobs/:jobId/download → 302 to zip URL
### POST /api/crop → `{ jobId }` (triggers crop pipeline)
### POST /api/finalize → `{ jobId }` (triggers finalize pipeline)

### py_backend POST /detect → `{ boxes: DetectedBox[], image_width, image_height }`
### py_backend POST /name-assets → `{ names: Record<string, string> }`
### py_backend POST /crop → `{ assets: AssetResult[] }`

### AniBuddy
See `backend.md` for the gateway routes and `py_backend.md` for the
`/anibuddy/*` geometry endpoints. Every AniBuddy payload shape is generated from
`schemas/anibuddy/rig-document.v5.schema.json` — that file, not this page, is the
contract.
