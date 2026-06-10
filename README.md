# OpenAssets

**AI-powered asset extractor.** Drop in one large image — a sprite sheet, an icon
grid, a UI mockup, a manga page — and OpenAssets detects every individual asset,
crops them out, names them intelligently, and hands you back a clean ZIP of
transparent PNGs. Optionally upscale them 2× and publish them as a shareable public
gallery.

The same pipeline is reachable three ways: a **web app**, a **Chrome extension**
(right-click any image on any page → "Extract"), and a **REST API**.

---

## What it does

```
            one packed image
                   │
                   ▼
   ┌────────────────────────────────┐
   │  1. Detect    OpenCV finds each │   bounding boxes + auto-names
   │               asset's box       │   (asset_001, asset_002, …)
   ├────────────────────────────────┤
   │  2. Name      Gemini looks at   │   fire_sword, health_potion, …
   │               the sheet         │
   ├────────────────────────────────┤
   │  3. Crop      each box sliced   │   individual transparent PNGs
   │               + bg removed      │   uploaded to object storage
   ├────────────────────────────────┤
   │  4. Export    ZIP it            │   download, or 2× AI upscale first
   └────────────────────────────────┘
                   │
                   ▼
        ZIP of named PNGs  ·  optional public gallery
```

The image never needs a transparent background to start — if it doesn't already
have an alpha channel, the pipeline runs AI background removal before detection.

---

## Architecture

Four deployable surfaces around two data stores and one object-storage provider.

```
 ┌─────────────┐      ┌──────────────────┐
 │  Frontend   │      │ Chrome Extension │
 │  Next.js    │      │  (any webpage)   │
 │  :3000      │      └────────┬─────────┘
 └──────┬──────┘               │
        │   HTTP REST (Bearer JWT)
        └──────────────┬───────┘
                       ▼
            ┌────────────────────┐     MongoDB :27017  (users, collections)
            │   Backend API      │────▶ Redis   :6379   (job state + BullMQ queues)
            │   Express / tsx    │────▶ Object storage   (Cloudinary or ImageKit)
            │   :4000            │
            └─────────┬──────────┘
                      │ HTTP (axios, x-internal-token)
                      ▼
            ┌────────────────────┐
            │  AI Service        │────▶ OpenCV / NumPy   (detect + crop)
            │  FastAPI / uvicorn │────▶ Gemini 2.0 Flash (asset naming)
            │  :8000             │────▶ Object storage   (upload crops)
            └────────────────────┘
```

| Service | Port | Stack | Responsibility |
|---|---|---|---|
| **frontend** | 3000 | Next.js 16, React 19, Tailwind 4, TypeScript | Web UI: upload, SVG canvas editor, export, public galleries |
| **backend** | 4000 | Express 4, TypeScript (run via `tsx`), BullMQ | API, auth, job orchestration, ZIP building, persistence |
| **py_backend** | 8000 | FastAPI, Python 3.11, OpenCV, Gemini | Stateless image compute: detection, naming, cropping |
| **extension** | — | Manifest V3, vanilla JS | Extract assets from any image on any webpage |
| MongoDB | 27017 | `mongo:7` | Users, auth tokens, collections (the only durable relational data) |
| Redis | 6379 | `redis:7` | Job state (24h TTL hashes) + BullMQ work queues |
| Object storage | — | Cloudinary *or* ImageKit | Originals, crops, exports, CDN delivery, AI transforms |

**Key design decisions**

- **Redis for jobs, Mongo for accounts.** Jobs are ephemeral — Redis hashes with a
  TTL are enough. Only users and published collections need a real database.
- **py_backend is stateless.** It owns no database; it downloads an image, computes,
  uploads results, and returns JSON. The Express backend owns all persistence.
- **Storage is pluggable.** Everything goes through a `StorageAdapter` interface
  (`backend/src/lib/storage/`). Set `STORAGE_PROVIDER=cloudinary` (default) or
  `imagekit` — the rest of the code never knows which is active.
- **The frontend owns box state.** Users edit bounding boxes client-side; the final
  edited list is sent once at crop time, not synced incrementally.
- **Filename *is* the asset name.** Gemini's chosen name becomes the storage
  `public_id`, so a crop downloads as `fire_sword.png` with no extra mapping.
- **One worker per stage.** Three BullMQ workers (detection → crop → finalize) run
  inside the backend process and advance jobs asynchronously.

---

## The pipeline in detail

Each user-facing action enqueues a BullMQ job; a worker advances it through a
series of statuses that the client polls (`GET /api/jobs/:jobId` every ~2s).

```
uploaded → queued → detecting → (removing_bg?) → detected
   → naming → cropping → cropped
   → finalizing → ready
   (any stage → failed, with an error message on the job)
```

**1 — Upload & Detect** (`detection.worker`)
`POST /api/upload` streams the file (multer, 20 MB cap, images only) to object
storage, creates the Redis job, and enqueues detection. The worker checks the image
for transparency; if it's opaque it runs AI background removal first. Then it asks
py_backend `/detect`, which uses the alpha channel as a mask, dilates to merge
fragments, finds contours, filters tiny boxes (`w≥20, h≥20, area≥400`), and sorts
them top-to-bottom / left-to-right into `asset_001…N`.

**2 — Name & Crop** (`crop.worker`)
The user confirms/edits boxes in the canvas and calls `POST /api/crop`. The worker
runs py_backend `/name-assets` (Gemini sees the whole annotated sheet and returns a
`snake_case` name per box) and `/crop` (NumPy slices each box, uploads each PNG with
its Gemini name as the `public_id`). Frontend auto-redirects to the export screen.

**3 — Export** (`finalize.worker`)
`POST /api/finalize` with the selected asset IDs and a `skipUpscale` flag.
- `skipUpscale: true` → zip the existing crop URLs directly (fast).
- `skipUpscale: false` → run each crop through 2× AI upscale, wait for it, then zip.

Either way the worker builds the ZIP (`archiver`, plus a `metadata.json`), uploads
it as a raw asset, and stores the `downloadUrl`. `GET /api/jobs/:jobId/download`
302-redirects to it.

> **Note:** AI background removal and AI upscale are paid storage-provider add-ons.
> If they're disabled, the affected job fails with a clear, actionable error instead
> of hanging.

---

## Repository layout

```
open_assets/
├── frontend/                Next.js web app
│   └── src/
│       ├── app/             routing only — route groups: (auth) (dashboard) (editor)
│       ├── features/        domain logic: upload / editor / collections / auth
│       ├── components/      UI (shadcn/ui), landing-page sections, layout
│       └── lib/             api-client (fetch + Bearer), token store, utils
│
├── backend/                 Express API + BullMQ workers
│   ├── index.ts             entry: connect Mongo + Redis, start 3 workers, listen
│   └── src/
│       ├── app.ts           Express factory: helmet, CORS, rate-limit, routes
│       ├── common/          config (db, redis, email, bullmq), middlewares, utils
│       ├── modules/
│       │   ├── auth/        register/login/OAuth/verify/reset — JWT (complete)
│       │   ├── upload/      POST /api/upload
│       │   ├── jobs/        GET /api/jobs/:id  ·  Redis job store + types
│       │   ├── crop/        POST /api/crop
│       │   ├── finalize/    POST /api/finalize
│       │   ├── collections/ public galleries: folders, images, likes, downloads
│       │   └── workers/     detection · crop · finalize BullMQ processors
│       └── lib/
│           ├── storage/     StorageAdapter interface + cloudinary / imagekit
│           ├── py.client.ts typed HTTP client for py_backend
│           └── zip.builder.ts
│
├── py_backend/              FastAPI AI service
│   └── app/
│       ├── main.py          app, internal-token middleware, rate limit, error handler
│       ├── routers/         /detect  /name-assets  /crop
│       ├── services/        detection · gemini · image_io · cloudinary_client
│       └── core/config.py   env-driven settings (detection tuning, thresholds)
│
├── extension/               Chrome extension (Manifest V3)
│   ├── manifest.json        permissions, context menus, Alt+Shift+E command
│   ├── background.js        service worker — runs the full extract pipeline
│   ├── content.js           in-page overlay + hovered-image tracking
│   ├── popup.* / options.*  UI, settings, JWT sync
│   └── config.js            shared defaults + auth-header helpers
│
├── docs/llm_wiki/           per-service deep-dive docs (architecture, pipelines, …)
├── docker-compose.yml       production compose (Traefik-labelled)
└── README.md                you are here
```

---

## API surface

All `/api/*` routes (except auth + public collection reads) require
`Authorization: Bearer <accessToken>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/refresh-token` · `/logout` | Email/password auth |
| GET | `/api/auth/google` · `/google/callback` | Google OAuth |
| GET/POST/PUT | `/api/auth/me`, `verify-email/:t`, `forgot-password`, `reset-password/:t` | Account lifecycle |
| POST | `/api/upload` | Multipart image → starts detection pipeline |
| GET | `/api/jobs/:jobId` | Full job state (status, boxes, assets, downloadUrl) |
| GET | `/api/jobs/:jobId/download` | 302 → ZIP URL (when `ready`) |
| POST | `/api/crop` | `{ jobId, boxes }` → name + crop pipeline |
| POST | `/api/finalize` | `{ jobId, selectedIds, skipUpscale }` → ZIP pipeline |
| GET/POST/PUT/DELETE | `/api/collections…` | Public galleries: CRUD, folders, images, `/like`, `/download` |

**Internal (py_backend, not public):** `POST /detect`, `POST /name-assets`,
`POST /crop`. Guarded by an `x-internal-token` shared secret — keep port 8000 off
the public internet.

---

## Collections (public galleries)

Beyond one-off exports, users can publish curated **collections** — named galleries
of folders and images with likes, download counts, search tags, and an auto-collaged
cover. Collections are `draft` (private) until `published`, can be scaffolded
directly from an editor job (`sourceJobId`), and are downloadable as ZIPs at the
collection or per-folder level. Backed by MongoDB (`collection.model.ts`) with
indexes for recency/popularity sorting and full-text search over name/description/tags.

---

## Auth

- **Access token** — JWT, 15 min, sent as `Authorization: Bearer`.
- **Refresh token** — 7 days, `httpOnly` cookie; `POST /api/auth/refresh-token`
  mints a new access token.
- **Google OAuth** — `/api/auth/google` → callback → tokens handed to the frontend
  via a fragment (`#token=…`) bridge route so they never hit server access logs.
- **Email** — verification + password reset via Resend (logs to console in dev when
  no API key is set).

The Chrome extension reuses the same JWT: the frontend syncs the token into
extension storage, and the extension sends it on every API call.

---

## Local development

### Prerequisites
- Node 20+ and `pnpm`
- Python 3.11+
- Docker (for MongoDB + Redis) — or your own local instances
- A Cloudinary **or** ImageKit account, and a Gemini API key

### 1. Data stores
```bash
docker compose up -d        # MongoDB :27017, Redis :6379
```
*(The committed `docker-compose.yml` is the production/Traefik setup; for local dev
just run Mongo + Redis containers, or point the env vars at instances you already
have.)*

### 2. AI service
```bash
cd py_backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill in CLOUDINARY_* and GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

### 3. Backend
```bash
cd backend
pnpm install
cp .env.example .env        # fill in the values below
pnpm dev                    # tsx watch — starts API + 3 workers on :4000
```

### 4. Frontend
```bash
cd frontend
pnpm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
pnpm dev                    # http://localhost:3000
```

### 5. Extension (optional)
`chrome://extensions` → enable Developer mode → **Load unpacked** → select
`extension/`. Set the API/frontend URLs in the extension's Options page (defaults
point at the production hosts).

### Environment variables

**`backend/.env`**
```bash
PORT=4000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/open_assets
REDIS_URL=redis://127.0.0.1:6379

# Object storage — pick one provider
STORAGE_PROVIDER=cloudinary            # or: imagekit
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
# IMAGEKIT_PRIVATE_KEY=                # required when STORAGE_PROVIDER=imagekit
# IMAGEKIT_URL_ENDPOINT=

# Auth
JWT_ACCESS_SECRET=change-me-access
JWT_REFRESH_SECRET=change-me-refresh
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

# Email (Resend) + downstream services
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@yourdomain.com
PY_BACKEND_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000
GEMINI_API_KEY=
```

**`py_backend/.env`**
```bash
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
GEMINI_API_KEY=                        # empty → falls back to identity names
GEMINI_MODEL=gemini-2.0-flash
INTERNAL_API_TOKEN=                    # shared secret the Node backend must send
ALLOWED_IMAGE_HOSTS=res.cloudinary.com,cloudinary.com
# OpenCV detection tuning (optional): MIN_BOX_WIDTH / MIN_BOX_HEIGHT / MIN_BOX_AREA / BINARY_THRESH_VALUE
```

**`frontend/.env.local`**
```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Commands

| Where | Command | Does |
|---|---|---|
| backend | `pnpm dev` | API + workers, hot-reload (`tsx watch`) |
| backend | `pnpm typecheck` | `tsc --noEmit` |
| backend | `pnpm test` | Node test runner over `src/__tests__` |
| frontend | `pnpm dev` / `pnpm build` | Next.js dev / production build |
| frontend | `pnpm lint` | ESLint |
| py_backend | `uvicorn app.main:app --reload` | FastAPI dev server |

---

## Deployment

`docker-compose.yml` builds `py_backend` and `backend` images behind a **Traefik**
reverse proxy (external `traefik` network, Let's Encrypt TLS, host-based routing).
Mongo and Redis are expected as separate managed/containerized services on the same
network. In production, set `INTERNAL_API_TOKEN` so only the Node backend can reach
the AI service, and keep py_backend's port off the public internet.

---

## Credits

Studio features (AI outpainting, Parallax/Tile/Sprite/Props studios) are adapted from
[image-extender](https://github.com/boona13/image-extender) by **boona13** (MIT License).
See `frontend/src/features/studio/LICENSE-image-extender.txt`.

---

## Further reading

Per-service deep dives live in [`docs/llm_wiki/`](docs/llm_wiki/):
[`architecture.md`](docs/llm_wiki/architecture.md) ·
[`pipelines.md`](docs/llm_wiki/pipelines.md) ·
[`backend.md`](docs/llm_wiki/backend.md) ·
[`frontend.md`](docs/llm_wiki/frontend.md) ·
[`py_backend.md`](docs/llm_wiki/py_backend.md) ·
[`auth.md`](docs/llm_wiki/auth.md) ·
[`storage.md`](docs/llm_wiki/storage.md) ·
[`env_vars.md`](docs/llm_wiki/env_vars.md)

> Some wiki pages predate the pluggable-storage refactor and still say
> "Cloudinary only" / "Google Vision" — the storage layer is now provider-agnostic
> (`backend/src/lib/storage/`) and asset naming is done by **Gemini**. This README
> reflects the current code.
```
