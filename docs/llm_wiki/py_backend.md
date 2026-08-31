# py_backend — FastAPI AI Service

**Location:** `py_backend/`
**Port:** 8000
**Runner:** `uvicorn app.main:app --reload`
**Status:** ✅ Built

Stateless compute service. Express owns all persistence.

Two distinct workloads now live here:

1. **Extraction** — OpenCV detection and cropping, Gemini/Open Quota asset
   naming, crops uploaded to Cloudinary.
2. **AniBuddy geometry** (`app/modules/anibuddy/`, mounted at `/anibuddy/*`) —
   every geometric stage of the v4 layered-cutout pipeline. This service is
   *authoritative* for AniBuddy geometry: the browser may pose and preview, but
   it may not derive a mesh, solve weights or author diagnostics (F9 R5). It
   holds no storage credentials — sheets arrive as multipart bytes and oversized
   geometry leaves as base64 for Express to write through the `StorageAdapter`.
   The vision *calls* are deliberately not here; they live in the Next app beside
   the one provider-fallback chain.

## Error Handling

- All endpoints return JSON (`application/json`).
- Validation / fetch errors → `422 { "detail": "..." }`.
- Cloudinary upload failures → `502 { "detail": "..." }`.
- All unhandled exceptions → `500 { "detail": "Internal server error: ExcType: msg" }` via global handler in `main.py`.
- Gemini API errors → graceful degrade (identity name map returned, logs to stdout). Never propagated as HTTP errors.

## Endpoints

### GET /health
```json
{ "status": "OK" }
```

### POST /check-transparency
Input: `{ "image_url": "https://..." }`
Output: `{ "transparent": bool, "image_width": int, "image_height": int }`

`transparent` is true when the image has an alpha channel AND at least
`TRANSPARENCY_MIN_FRACTION` (default 1%) of pixels have alpha below
`TRANSPARENCY_ALPHA_THRESHOLD` (default 250). A fully-opaque RGBA returns false.

### POST /detect
Input: `{ "image_url": "https://..." }`
Output:
```json
{
  "boxes": [{ "id": "uuid", "x": 0, "y": 0, "width": 80, "height": 80, "name": "asset_001" }],
  "image_width": 800,
  "image_height": 600
}
```

Detection: alpha mask (primary) or white-bg threshold → dilate 3×3 → findContours → filter (w≥20, h≥20, area≥400) → sort top-to-bottom left-to-right → name asset_001, asset_002…

### POST /name-assets
Draws each box + systematic label onto the full image, sends ONE annotated PNG to Gemini,
returns a systematic→real name map.

Input:
```json
{
  "image_url": "https://...",
  "boxes": [{ "id": "uuid", "x": 0, "y": 0, "width": 80, "height": 80, "name": "asset_001" }]
}
```
Output: `{ "names": { "asset_001": "fire_sword", "asset_002": "health_potion" } }`

If `GEMINI_API_KEY` is empty or Gemini errors → returns identity map, logs to stdout.

### POST /crop
Input:
```json
{
  "image_url": "https://...",
  "boxes": [{ "id": "uuid", "x": 0, "y": 0, "width": 80, "height": 80, "name": "fire_sword" }],
  "job_id": "abc123"
}
```
Output:
```json
{
  "assets": [{ "id": "uuid", "name": "fire_sword", "cropped_url": "https://res.cloudinary.com/...", "public_id": "open_assets/crops/abc123/fire_sword" }]
}
```

### AniBuddy — `POST /anibuddy/*`

All of these are internal (`X-Internal-Token`) and are called only by the Express
gateway's BullMQ stage workers, never by a browser. Every refusal is a 422
carrying a user-facing sentence, because every one of them is a statement about
the request — a non-null `blockingReason`, an unknown id, a joint landing on
transparent pixels. Refuse rather than repair (F9 R7).

The heavy ones are multipart rather than JSON: a 64-part rig document exceeds
Starlette's 1 MB non-file part limit on its own, so the JSON envelope rides as a
file part named `request` alongside the sheet bytes.

| Endpoint | In | Out |
|---|---|---|
| `POST /anibuddy/decompose` | sheet + `AssetRef` | a provisional `RigDocument` v5 revision: parts with masks, rects, draw order and confidence. Classical CV only — alpha components, gutter grid, watershed, grabCut, cheapest first |
| `POST /anibuddy/rig` | document (+ sheet, + external buffers) | skeleton plus one deformer per part (`rigid`/`mesh`/`lattice`/`spline`), and the oversized numeric buffers for Node to store |
| `POST /anibuddy/render` | document + clip + sheet | frames rasterized and encoded to PNG zip, GIF, WebM or MP4, keyed by content hash |
| `GET /anibuddy/render/artifacts/{cache_key}` | — | the artifact's raw bytes as a stream, so a 40 MB zip reaches Node without base64 |
| `POST /anibuddy/semantics/annotate` | document + sheet | the sheet with numbered part outlines, plus the number→partId legend the caller must revalidate the model's reply against |
| `POST /anibuddy/critique/contact-sheet` | document + sheet | nine really-rendered frames tiled into one image, plus the revision whose diagnostics were measured on exactly those frames |
| `POST /anibuddy/critique/apply` | document + `CritiqueReport` | the corrected child revision. JSON, not multipart: applying a correction is parameter arithmetic and reads no pixel |
| `POST /anibuddy/stages/{stage}` | — | stub transport, for wiring the queue before a stage exists |

## Services

| File | Purpose |
|---|---|
| `services/detection.py` | `find_bounding_boxes(img)` + `is_transparent(img)` |
| `modules/anibuddy/decompose/` | the four escalating decomposition strategies |
| `modules/anibuddy/rig/` | contour trace, RDP simplify, Poisson sampling, triangulation, bounded biharmonic weights |
| `modules/anibuddy/kernel/` | FK, LBS, lattice, spline and the affine warp. Mirrored in TypeScript; CI holds the two to 0 ULP over 17 fixtures |
| `modules/anibuddy/render/` | rasterize, composite `PartPose` channels, encode (ffmpeg, falling back to a PNG zip) |
| `modules/anibuddy/vision/` | annotate, contact sheet, and the bounded correction applier |
| `modules/anibuddy/schemas.py` | **generated** Pydantic `RigDocument` v5. Never hand-edit; CI fails on drift |
| `services/gemini.py` | Annotate image with OpenCV, call Gemini structured JSON, de-dup names |
| `services/image_io.py` | `download_image(url)` — fetch, decode, dimension-validate; raises HTTP 422 on failure |
| `services/cloudinary_client.py` | `upload_bytes(data, folder, public_id)` — raises HTTP 502 on failure |

## Configuration (`core/config.py`)

| Env var | Default | Purpose |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | | Required |
| `CLOUDINARY_API_KEY` | | Required |
| `CLOUDINARY_API_SECRET` | | Required |
| `GEMINI_API_KEY` | `` | Optional — identity names if empty |
| `GEMINI_MODEL` | `gemini-2.0-flash` | |
| `MIN_BOX_WIDTH` | 20 | px min for box to keep |
| `MIN_BOX_HEIGHT` | 20 | px min |
| `MIN_BOX_AREA` | 400 | px² min |
| `BINARY_THRESH_VALUE` | 240 | white-bg inversion threshold |
| `INTERNAL_API_TOKEN` | `` | shared secret the Node gateway sends as `X-Internal-Token`. Empty disables enforcement (local dev) |
| `TRANSPARENCY_ALPHA_THRESHOLD` | 250 | alpha < this = transparent pixel |
| `TRANSPARENCY_MIN_FRACTION` | 0.01 | min fraction of transparent pixels to treat image as pre-cut-out |
