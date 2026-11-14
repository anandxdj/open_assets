# Storage — Cloudinary

> The notes below describe the Cloudinary provider. `STORAGE_PROVIDER` can also be `imagekit`, or
> `local` (files under `LOCAL_STORAGE_DIR`, served by the API at `/storage/<key>`; for development
> and self-hosting without cloud keys). See "Local storage" in the root README for what the local
> provider can and cannot do (resize instead of AI upscale, no AI enhance, no AI background removal).
>
> **Background removal runs on every provider.** Detection (py_backend `classify_background`) stores
> `background: { kind: transparent | flat | chroma | complex, color? }` on the job. The crop worker
> (`backend/src/modules/workers/cropBackground.ts`) takes `backgroundRemoval: auto | flat | ai | none`
> (absent = auto): flat and chroma sheets are keyed by `keyOutFlatBackground` on our server for free
> (it downloads the stored sheet, keys it, uploads the PNG through the adapter, `originals/<jobId>_nobg`,
> and crops from that), and `adapter.applyBackgroundRemoval` (Cloudinary `e_background_removal`,
> ImageKit `e-bgremove`, paid) is only called for a complex sheet in `auto`, or for `ai`. Local storage has
> no AI: it keeps the background and the job records `backgroundReason`. The job records
> `backgroundMethod` (`none | server | ai`). `removeEnclosedBackground` applies whenever the keyer runs.
> AI removal runs once on the whole sheet (one paid call), not per crop (N paid calls). The worker then checks that the
> result is really transparent and records `backgroundReason` when the AI left it opaque (it can take the paper itself
> for the subject).
> The flat/chroma rule lives in `py_backend/app/services/detection.py` and `backend/src/lib/background.ts`,
> pinned by `backend/src/__tests__/fixtures/background-cases`.
> With `local`, py_backend's `/crop` is called with `inline: true` and returns the PNGs, which the
> backend stores under `crops/<jobId>/` (`backend/src/lib/cropStore.ts`).

**Old local files after a provider switch.** Seeded or earlier uploads made with `STORAGE_PROVIDER=local`
are stored in the database as `<API>/storage/<key>` URLs. `createApp()` (`backend/src/app.ts`) mounts
the read-only `/storage` route (`createLocalStorageRouter`) through `resolveServedStorageDir()`
(`backend/src/lib/storage/local.paths.ts`) whatever the provider:
- `local`: always, as before.
- `cloudinary` / `imagekit`: when `LOCAL_STORAGE_DIR` is set (even if the folder does not exist yet) or
  the default `./.local-storage` exists. The route is GET/HEAD only, with the same path-traversal checks,
  content types, `Cache-Control: public, max-age=300`, sandboxing CSP and `nosniff` headers, and nothing
  writable: new files still go to the active provider's adapter.
- Production with another provider: also needs `ALLOW_LOCAL_STORAGE=1`. This keeps the existing guard
  (files are public by URL, so a stray folder must not be published by accident); a deployment that really
  stored files locally in production already had to set it. `checkEnv` warns when it is on with a
  `LOCAL_STORAGE_DIR` and another provider.
`AppOptions.localStorageDir` overrides all of this (tests).

**Single storage provider for all images** (Cloudinary by default).

## SDK Init (`backend/src/common/config/cloudinary.ts`)

```typescript
import { v2 as cloudinary } from 'cloudinary'
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})
export { cloudinary }
```

Same pattern in `py_backend/app/services/cloudinary_client.py` using the Python SDK.

## Folder Structure

```
open_assets/
  originals/          Original uploaded images (full sprite sheets, etc.)
  crops/<jobId>/      Individual cropped assets per job
  exports/            Final zip files (raw resource type)
```

## Upload Patterns

### Original image (Node — upload route)
```typescript
// stream buffer from multer memory storage into Cloudinary
const result = await new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: 'open_assets/originals', resource_type: 'image' },
    (err, result) => err ? reject(err) : resolve(result)
  )
  stream.end(req.file.buffer)
})
// result.secure_url, result.public_id
```

### Cropped asset (Python — py_backend crop endpoint)
```python
# encode numpy crop to bytes, upload to Cloudinary
_, buf = cv2.imencode('.png', cropped_img)
result = cloudinary.uploader.upload(
    buf.tobytes(),
    folder=f"open_assets/crops/{job_id}",
    resource_type="image"
)
# result['secure_url'], result['public_id']
```

### Zip file (Node — export worker)
```typescript
// upload zip buffer as raw resource
const result = await cloudinary.uploader.upload(zipPath, {
  folder: 'open_assets/exports',
  resource_type: 'raw',
  public_id: exportJobId,
})
// result.secure_url used as downloadUrl in Redis
```

## Transformation Params (Enhancement Pipeline)

Transformations are **URL-based** — append to the Cloudinary delivery URL. No re-upload needed.

| Operation | Cloudinary Param | Example |
|---|---|---|
| AI Upscale (2x) | `e_upscale` | `...upload/e_upscale/open_assets/crops/...` |
| Background Remove | `e_background_removal` | `...upload/e_background_removal/open_assets/crops/...` |
| Convert to WebP | `f_webp` | `...upload/f_webp/open_assets/crops/...` |
| Convert to PNG | `f_png` | `...upload/f_png/open_assets/crops/...` |
| Resize (keep ratio) | `c_scale,w_512` | `...upload/c_scale,w_512/open_assets/crops/...` |

For eager pre-generation (so the transform is cached before the user needs it):
```typescript
await cloudinary.uploader.explicit(publicId, {
  type: 'upload',
  eager: [{ effect: 'upscale' }],
})
```

## Python SDK Usage

```python
import cloudinary
import cloudinary.uploader

cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
)
```

## Env Vars Required

```
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```
