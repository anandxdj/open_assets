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
                                    + the five AniBuddy stage queues
        config.ts                   frozen server config (Rule 2: the only process.env reader)
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
      anibuddy/                     AniBuddy v4 stage gateway — see below
      usage/                        credits: atomic consume, idempotent refund, served-model reconcile
      workers/
        detection.worker.ts         BullMQ: transparency check → bg removal? → detect → detected
        crop.worker.ts              BullMQ: Gemini naming + bg already done → crop → cropped
        finalize.worker.ts          BullMQ: skipUpscale? direct zip : upscale → zip → Cloudinary raw → ready
        anibuddy.worker.ts          BullMQ: one worker over the four stage queues + one for the critique loop
    lib/
      py.client.ts                  checkTransparency, detectAssets, nameAssets, cropAssets
      cloudinary.transform.ts       applyBackgroundRemoval, buildUpscaleUrl, pollUntilReady
      zip.builder.ts                buildAndUploadZip(items, jobId) → Cloudinary raw URL
```

## AniBuddy stage gateway (`src/modules/anibuddy/`)

This gateway is the **only** path between the browser and the AniBuddy pipeline.
It owns auth, credits, the `StorageAdapter` and Mongo persistence; it holds
`INTERNAL_API_TOKEN` and is the only process that may reach py_backend.

Five transports across two services, chosen per stage:

| Transport | Goes to | For |
|---|---|---|
| `decompose-multipart`, `rig-multipart`, `render-multipart` | py_backend | geometry — OpenCV and NumPy, no model call |
| `motion-vision` | Next `/api/enhance/anibuddy/motion` | the `animate` stage, whose entire work IS a vision call |
| `stub` | py_backend `/anibuddy/stages/:stage` | wiring a queue before its stage exists |

Two of the pipeline's model calls are not transports at all, because they are
steps *inside* the critique loop rather than stages: the gateway posts them to
Next's `critique` and `semantics` routes over `x-service-token`.

Routes, mounted at `/api`:

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/anibuddy/assets` | JWT | upload a sheet through the `StorageAdapter` |
| `POST` / `GET /api/anibuddy/projects` | JWT | create / list |
| `GET /api/anibuddy/projects/:id` | JWT | the polling surface for stage progress |
| `POST /api/anibuddy/projects/:id/enqueue` | JWT | run one stage; pre-authorizes credits |
| `POST /api/anibuddy/projects/:id/critique` | JWT | run the closed loop. Its own route because it charges per pass and refunds by failure class, so there is nothing to consume up front |
| `POST` `PUT` `DELETE /api/anibuddy/projects/:id/clips[/:clipId]` | JWT | clip persistence. The body is a `Clip`, never a document, so no field on these routes can author geometry or diagnostics |
| `POST /api/anibuddy/internal/annotate` | `x-service-token` | the one route Next calls *into* this gateway on. It exists so the browser-adjacent app never holds `INTERNAL_API_TOKEN` |

Queues: `anibuddy-decompose`, `anibuddy-rig`, `anibuddy-animate`,
`anibuddy-render`, `anibuddy-critique`. Every stage worker is idempotent on the
stage's `inputHash`, so a retried job returns the cached artifact rather than
re-spending credits.

`anibuddy.rig-document.generated.model.ts` and `dto/rig-document.generated.ts`
are **generated** from `schemas/anibuddy/rig-document.v5.schema.json`. Never hand
-edit them; `pnpm schema:anibuddy:check` fails CI on drift. Zod is the validating
boundary — Mongo is only a storage projection, and tagged unions land there as
`Mixed`.

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
