# py_backend — FastAPI AI Service

**Location:** `py_backend/`
**Port:** 8000
**Runner:** `uvicorn app.main:app --reload`
**Status:** ✅ Built

Stateless compute service. Express owns all persistence. py_backend only does
OpenCV work + Gemini naming and uploads crops to Cloudinary.

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

## Services

| File | Purpose |
|---|---|
| `services/detection.py` | `find_bounding_boxes(img)` + `is_transparent(img)` |
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
| `TRANSPARENCY_ALPHA_THRESHOLD` | 250 | alpha < this = transparent pixel |
| `TRANSPARENCY_MIN_FRACTION` | 0.01 | min fraction of transparent pixels to treat image as pre-cut-out |
