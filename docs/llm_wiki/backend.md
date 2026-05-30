# Backend — Express API

**Location:** `backend/`
**Port:** 4000
**Runner:** `tsx watch index.ts`
**Status:** ✅ Built, typechecking clean

## Folder Structure

```
backend/
  index.ts                          entry: connectDB, Redis ping, start 3 workers, listen
  src/
    app.ts                          Express factory: CORS, json, cookies, routes, errorHandler
    common/
      config/
        db.ts                       MongoDB connect
        redis.ts                    ioredis client (BullMQ compat)
        email.ts                    Resend email service
        cloudinary.ts               Cloudinary v2 SDK init
        bullmq.ts                   detectionQueue + cropQueue + finalizeQueue
      middlewares/
        errorHandler.ts             Catches ApiError → JSON; unhandled → 500 JSON
        validate.middleware.ts      Zod validation middleware
      utils/
        ApiError.ts                 badRequest/unauthorized/forbidden/notFound/conflict/internal
        ApiResponse.ts              ok(res, msg, data) / created(res, msg, data)
        asyncHandler.ts             Wraps async route fns → .catch(next) for Express 4
        extractError.ts             Extracts Axios/Error messages; py_backend detail field
        jwt.utils.ts
    modules/
      auth/                         COMPLETE — do not modify
      jobs/
        job.types.ts                JobStatus (10 states), BoundingBox, Asset, JobHash, JobResponse
        job.store.ts                createJob, updateJob, getJob, parseBoxes, parseAssets
        job.routes.ts               GET /api/jobs/:jobId, GET /api/jobs/:jobId/download
      upload/
        upload.controller.ts        multer buffer → Cloudinary → validate format/dims → Redis → BullMQ
        upload.routes.ts            POST /api/upload (authenticate + multer 20MB)
      crop/
        crop.controller.ts          POST /api/crop — save edited boxes, enqueue cropQueue
        crop.routes.ts              POST /api/crop (authenticate)
      finalize/
        finalize.controller.ts      POST /api/finalize — validate selectedIds, store skipUpscale, enqueue finalizeQueue
        finalize.routes.ts          POST /api/finalize (authenticate)
      workers/
        detection.worker.ts         BullMQ: transparency check → bg removal? → detect → detected
        crop.worker.ts              BullMQ: Gemini naming + bg already done → crop → cropped
        finalize.worker.ts          BullMQ: skipUpscale? direct zip : upscale → zip → Cloudinary raw → ready
    lib/
      py.client.ts                  checkTransparency, detectAssets, nameAssets, cropAssets
      cloudinary.transform.ts       applyBackgroundRemoval, buildUpscaleUrl, pollUntilReady
      zip.builder.ts                buildAndUploadZip(items, jobId) → Cloudinary raw URL
```

## All Routes

### Auth (at /api/auth) — DO NOT MODIFY
See `auth.md`.

### Upload
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/upload | Yes | multer (20MB, image/* only) → Cloudinary validate (format + dims) → Redis → detection queue |

### Jobs
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/jobs/:jobId | Yes | Full job state: status, boxes, assets, downloadUrl, error |
| GET | /api/jobs/:jobId/download | Yes | 302 → Cloudinary zip URL (only when status=ready) |

### Crop
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/crop | Yes | `{ jobId, boxes }` — save user's confirmed boxes, enqueue crop job |

### Finalize
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/finalize | Yes | `{ jobId, selectedIds, skipUpscale? }` — validate ids, store skipUpscale flag, enqueue finalize job |

`skipUpscale: true` → ZIP uses original cropped_url (fast, no Cloudinary polling)
`skipUpscale: false` → ZIP uses 2× AI upscaled URL via `e_upscale` (slower, paid add-on required)

## Error Handling

All routes use `asyncHandler` wrapper → errors reach `errorHandler` middleware.

`ApiError` subclasses → JSON `{ success: false, message: "..." }` with correct HTTP status.

Worker failures → `updateJob(jobId, { status: 'failed', error: <message> })`.
Error messages include which step failed and why (py_backend `detail` extracted via `extractError`).

Cloudinary add-on misconfiguration → non-retried `pollUntilReady` error with actionable message.

## Key Types

**`JobStatus`** (10 states):
```
uploaded → queued → detecting → (removing_bg?) → detected
  → naming → cropping → cropped
  → finalizing → ready
  (any → failed)
```

**`JobHash`** fields (Redis):
`status, cloudinaryUrl, publicId, workingUrl, isTransparent, imageWidth, imageHeight, boxes, nameMap, assets, selectedIds, skipUpscale, downloadUrl, error, userId, createdAt`

**`BoundingBox`** — `{ id, x, y, width, height, label?, croppedUrl? }`

**`Asset`** — `{ id, name, cropped_url, public_id }`

**`AuthRequest.user`** — `{ id, email, name, role }` (NOT `_id`)

## tsconfig Notes

- `module: "Preserve"` + `moduleResolution: "Bundler"` — for tsx runner
- `verbatimModuleSyntax: true` — all type imports must use `import type`
- `erasableSyntaxOnly: true` — no enums, no namespaces, no parameter properties
- `noUncheckedIndexedAccess: true` — array index returns `T | undefined`

## Cloudinary Add-ons Required

Both are **paid add-ons** — must be enabled in your Cloudinary account:
- **AI Background Removal** (`e_background_removal`) — used in detection worker
- **AI Upscale** (`e_upscale`) — used in finalize worker when `skipUpscale=false`

If disabled, the job fails with a clear error on the hash rather than silently.
Upscale is skipped entirely when `skipUpscale=true` (Download path).
