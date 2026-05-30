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

## Key API Contracts

### POST /api/upload → `{ jobId, cloudinaryUrl, status: "queued" }`
### GET /api/jobs/:jobId → `{ jobId, status, cloudinaryUrl, workingUrl?, imageWidth, imageHeight, boxes, assets, downloadUrl?, error? }`
### GET /api/jobs/:jobId/download → 302 to zip URL
### POST /api/crop → `{ jobId }` (triggers crop pipeline)
### POST /api/finalize → `{ jobId }` (triggers finalize pipeline)

### py_backend POST /detect → `{ boxes: DetectedBox[], image_width, image_height }`
### py_backend POST /name-assets → `{ names: Record<string, string> }`
### py_backend POST /crop → `{ assets: AssetResult[] }`
