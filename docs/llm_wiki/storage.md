# Storage — Cloudinary

**Single storage provider for all images.** No S3, no ImageKit.

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
