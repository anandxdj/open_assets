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
   │  2. Name      an LLM looks at   │   fire_sword, health_potion, …
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
            │  FastAPI / uvicorn │────▶ Open Quota → Gemini (asset naming)
            │  :8000             │────▶ Object storage   (upload crops)
            └────────────────────┘
```

| Service | Port | Stack | Responsibility |
|---|---|---|---|
| **frontend** | 3000 | Next.js 16, React 19, Tailwind 4, TypeScript | Web UI: upload, SVG canvas editor, export, public galleries |
| **backend** | 4000 | Express 4, TypeScript (run via `tsx`), BullMQ | API, auth, job orchestration, ZIP building, persistence |
| **py_backend** | 8000 | FastAPI, Python 3.11, OpenCV, Open Quota/Gemini | Stateless image compute: detection, naming, cropping |
| **extension** | — | Manifest V3, WXT, React, TypeScript | Extract assets from any image on any webpage; queue ChatGPT generations |
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
- **LLMs are pluggable too, and chained.** Same adapter shape, in two places:
  `frontend/src/app/api/studio/_lib/llm/` (studio text/vision) and
  `py_backend/app/services/llm/` (asset naming). Both put **Open Quota** first and
  fall back to the original provider on any failure. With `OPENQUOTA_API_KEY`
  unset, each chain collapses to exactly its previous behaviour. See
  [`docs/llm_wiki/llm_providers.md`](docs/llm_wiki/llm_providers.md).
- **The frontend owns box state.** Users edit bounding boxes client-side; the final
  edited list is sent once at crop time, not synced incrementally.
- **Filename *is* the asset name.** The LLM's chosen name becomes the storage
  `public_id`, so a crop downloads as `fire_sword.png` with no extra mapping.
- **One worker per stage.** BullMQ workers (detection → crop → finalize, plus `enhance` for
  AI enhance) run inside the backend process and advance jobs asynchronously.

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
runs py_backend `/name-assets` (an LLM sees the whole annotated sheet and returns a
`snake_case` name per box — Open Quota first, then Gemini, then identity names) and
`/crop` (NumPy slices each box, uploads each PNG with its returned name as the
`public_id`). Frontend auto-redirects to the export screen.

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
│   ├── index.ts             entry: validate env, connect Mongo + Redis, start the 4 workers, listen, shut down gracefully
│   └── src/
│       ├── app.ts           Express factory: helmet, CORS, /health, rate-limit, routes
│       ├── common/          config (env check, cors, cookies, db, redis, email, bullmq), health,
│       │                    lifecycle (graceful shutdown), middlewares, utils
│       ├── modules/
│       │   ├── auth/        register/login/OAuth/verify/reset — JWT (complete)
│       │   ├── upload/      POST /api/upload
│       │   ├── jobs/        GET /api/jobs, /api/jobs/:id  ·  Redis job store + per-user index + types
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
├── extension/               Chrome extension (Manifest V3, WXT + React) — see its README
│   ├── entrypoints/         background service worker, ChatGPT content script, popup, side panel
│   └── src/shared/          account sign-in, extract pipeline, storage, URL/permission config
│
├── docs/llm_wiki/           per-service deep-dive docs (architecture, pipelines, …)
├── docker-compose.yml       the whole stack: web, API + workers, AI service, MongoDB, Redis
├── docker-compose.traefik.yml  Traefik routing layer for the VPS
├── docker-compose.dev.yml   MongoDB + Redis only, on localhost, for running from source
├── .env.example             configuration for docker-compose.yml
├── build-push.sh            build + push the three images (run on your workstation)
├── deploy-vps.sh            pull + start the stack (run on the VPS)
└── README.md                you are here
```

---

## API surface

All `/api/*` routes (except auth + public collection reads) require
`Authorization: Bearer <accessToken>`. `GET /health` (outside `/api`, no auth, not rate
limited) reports MongoDB and Redis for Docker and load balancers.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/refresh-token` · `/logout` | Email/password auth |
| GET | `/api/auth/google` · `/google/callback` | Google OAuth |
| GET/POST/PUT | `/api/auth/me`, `verify-email/:t`, `forgot-password`, `reset-password/:t` | Account lifecycle |
| POST | `/api/upload` | Multipart image → starts detection pipeline |
| GET | `/api/jobs?limit=&cursor=` | The signed-in user's jobs (history), newest first, `{ jobs, nextCursor }`; `limit` 1–100, default 50 |
| DELETE | `/api/jobs/:jobId/history` | Remove one job from the user's history (the job itself stays until it expires) |
| DELETE | `/api/jobs/history` | Clear the user's history |
| GET | `/api/jobs/:jobId` | Full job state (status, boxes, assets, downloadUrl) |
| GET | `/api/jobs/:jobId/download` | 302 → ZIP URL (when `ready`) |
| POST | `/api/crop` | `{ jobId, boxes }` → name + crop pipeline |
| POST | `/api/finalize` | `{ jobId, selectedIds, skipUpscale, scale }` → ZIP pipeline (`scale` 4 needs Pro) |
| GET/POST/DELETE | `/api/api-keys` · `/api/api-keys/:id` | API keys (Pro, signed-in session only): list, create (the full key is returned once), revoke |
| any | `/api/v1/…` | Public API (Pro), `Authorization: Bearer oa_live_…` only: `GET /me`, `POST`/`GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/crop`, `POST /jobs/:id/export`, `GET /jobs/:id/download`. Per-key rate limits, coded errors. Docs at `/docs/api` |
| GET/POST | `/api/plans/me` · `/api/plans/trial` | Plan, limits, usage; start the 14-day trial ([plans](docs/plans-and-entitlements.md)) |
| GET/PUT | `/api/admin/users` · `/api/admin/users/:id/plan` | Admin only: find users, set their plan |
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

- **Access token** — JWT, 15 min, sent as `Authorization: Bearer`. "Sign out everywhere" and
  password changes and resets set `tokensValidAfter` on the user, and `authenticate()` rejects any
  access token issued before it, so they take effect at once instead of at expiry.
- **API key** — `oa_live_…`, Pro only, for `/api/v1` only (it is not a session and cookies and JWTs are
  not accepted there). Only a SHA-256 hash is stored; revoke it in Settings.
- **Refresh token** — 7 days, `httpOnly` cookie; `POST /api/auth/refresh-token`
  mints a new access token. `Secure`, `SameSite` and `Domain` come from `COOKIE_SECURE`,
  `COOKIE_SAMESITE` and `COOKIE_DOMAIN` (defaults: `Secure` + `SameSite=None` in
  production, `Lax` in development).
- **Google OAuth** — `/api/auth/google` → callback → tokens handed to the frontend
  via a fragment (`#token=…`) bridge route so they never hit server access logs.
- **Email** — verification + password reset via Resend (logs to console in dev when
  no API key is set).

The Chrome extension signs in through the web app (`/extension/connect`, PKCE through
`chrome.identity`) and gets its own device token plus a short-lived access token, which it
sends on every API call. In production the backend must list the extension's origin in
`EXTENSION_ORIGINS`.

---

## Run locally

Every service has a `.env.example` that lists each variable it reads, with a comment
for each one. The root [`.env.example`](.env.example) does the same for Docker Compose.

You need a **Cloudinary** (or ImageKit) account for storage, because uploads fail
without one. LLM keys are optional: with neither `OPENQUOTA_API_KEY` nor
`GEMINI_API_KEY`, naming degrades to `asset_001…N`.

### With Docker (the whole stack)

Needs Docker with the Compose plugin. It builds and starts the web app, the API with
its workers, the AI service, MongoDB and Redis, each with a healthcheck.

```bash
cp .env.example .env
```

Then edit `.env`:

1. Set `APP_ENV=development`. In `production` (the default) the backend refuses to start
   with placeholder secrets and sets `Secure` cookies, which need HTTPS.
2. Fill `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_API_TOKEN` and
   `INTERNAL_SERVICE_TOKEN` with four different values from `openssl rand -hex 32`.
3. Add your `CLOUDINARY_*` keys (and an LLM key if you want AI naming).

```bash
docker compose up -d --build --wait    # first build takes a few minutes
docker compose ps                      # every service should say "healthy"
```

Open http://localhost:3000 (web app) and http://localhost:4000/health (API). The ports
come from `FRONTEND_PORT` and `BACKEND_PORT`; if you change them, also change
`FRONTEND_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL` to match and rebuild
(`NEXT_PUBLIC_*` values are baked into the frontend image).

MongoDB and Redis publish no ports, so they cannot clash with databases already on your
machine. Useful commands:

```bash
docker compose logs -f backend         # follow one service
docker compose down                    # stop, keep the data volumes
docker compose down -v                 # stop and delete all data
```

### From source (databases in Docker, apps on your machine)

Prerequisites: Node 20+ with pnpm 10 (`corepack enable`) and Python 3.11+.

**1. Data stores.** Start MongoDB and Redis on localhost, or point `MONGO_URI` and
`REDIS_URL` at instances you already run:

```bash
docker compose -f docker-compose.dev.yml up -d    # MongoDB :27017, Redis :6379
```

**2. AI service** (http://localhost:8000):

```bash
cd py_backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                # fill in CLOUDINARY_* and an LLM key
uvicorn app.main:app --reload --port 8000
```

**3. Backend** (http://localhost:4000):

```bash
cd backend
pnpm install
cp .env.example .env     # set MONGO_URI; fill CLOUDINARY_*; defaults cover the rest
pnpm dev                 # tsx watch: the API and the 4 workers in one process
```

On start it checks its environment and prints what is missing or wrong. In development
a missing Cloudinary key is only a warning, so you can sign up and browse without it.
`curl localhost:4000/health` reports MongoDB and Redis.

**4. Web app** (http://localhost:3000):

```bash
cd frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

**5. Browser extension (optional).** See [`extension/README.md`](extension/README.md):
`pnpm install && pnpm build` in `extension/`, then **Load unpacked** on
`chrome://extensions`. For local work set `WXT_PUBLIC_API_URL=http://localhost:4000` and
`WXT_PUBLIC_FRONTEND_URL=http://localhost:3000` in `extension/.env` before building.

### Checks

| Where | Command | Does |
|---|---|---|
| backend | `pnpm typecheck` · `pnpm test` | `tsc --noEmit` · Node test runner over `src/__tests__` |
| backend | `pnpm plan:set <email> <free\|pro> [--days N]` · `pnpm admin:grant <email>` | Grant or end Pro by hand · make a user an admin ([plans](docs/plans-and-entitlements.md)) |
| frontend | `pnpm lint` · `pnpm build` | ESLint · production build |
| extension | `pnpm typecheck` · `pnpm test` · `pnpm build` | types · Vitest · Chrome MV3 build |
| py_backend | `pytest` | `tests/` |
| root | `docker compose config -q` | validates the compose file against your `.env` |

---

## Deploy

The production setup is the same Compose stack, run on a VPS from images you build once
and push to a registry. Two scripts drive it:

| Script | Runs on | Does |
|---|---|---|
| [`build-push.sh`](build-push.sh) | your workstation or CI | builds the `backend`, `py_backend` and `frontend` images (linux/amd64) and pushes them as `<OA_REGISTRY>/openasset-{backend,py-backend,frontend}:<OA_VERSION>` |
| [`deploy-vps.sh`](deploy-vps.sh) | the VPS | `docker compose pull`, `up -d --remove-orphans --wait`, then `ps`. It exits non-zero if a service does not become healthy |

Both read `OA_REGISTRY` and `OA_VERSION` from `.env`, which is why a single `.env` format
serves local runs and the VPS.

**What the stack contains.** `frontend` and `backend` (Express API plus the four BullMQ
workers, one process) publish ports on `127.0.0.1` only. `py_backend`, `mongo` and `redis`
publish nothing and are reachable only inside the stack. MongoDB and Redis keep their data
in the named volumes `mongo-data` and `redis-data`. Every service restarts
`unless-stopped`, rotates its logs (3 × 10 MB) and has a healthcheck.

### One-time setup on the VPS

1. Install Docker with the Compose plugin and point two DNS names at the server, for
   example `openassets.example.com` (web app) and `api.openassets.example.com` (API).
2. Run a reverse proxy that terminates TLS. The repo includes a Traefik layer
   ([`docker-compose.traefik.yml`](docker-compose.traefik.yml)) that joins the web app and
   the API to an existing Docker network named `proxy` and sets the routing labels. With
   something else (nginx, Caddy), proxy the two hosts to `127.0.0.1:3000` and
   `127.0.0.1:4000`.
3. Clone the repo (or copy `docker-compose*.yml`, `deploy-vps.sh` and `.env`) and create
   the VPS `.env`:

   ```bash
   cp .env.example .env
   ```

   Set at least:

   | Variable | Value |
   |---|---|
   | `APP_ENV` | `production` |
   | `OA_REGISTRY`, `OA_VERSION` | where the images live and which tag to run |
   | `FRONTEND_URL`, `NEXT_PUBLIC_SITE_URL` | `https://openassets.example.com` |
   | `NEXT_PUBLIC_API_URL` | `https://api.openassets.example.com` |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_API_TOKEN`, `INTERNAL_SERVICE_TOKEN` | four different values of `openssl rand -hex 32` |
   | `CLOUDINARY_*` (or `STORAGE_PROVIDER=imagekit` and `IMAGEKIT_*`) | storage credentials. Without them the stack starts, but uploads fail and AI enhance reports "not configured" |
   | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | email, or verification links are only logged |
   | `GOOGLE_*` | optional Google sign-in; the callback URL is `<API URL>/api/auth/google/callback` |
   | `EXTENSION_ORIGINS` | `chrome-extension://<id>` once the extension has an ID |
   | `COOKIE_SAMESITE` | `lax` when the web app and API share a registrable domain, otherwise leave empty (`none`) |

   For Traefik also uncomment `COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml`
   and set `TRAEFIK_FRONTEND_HOST` and `TRAEFIK_BACKEND_HOST` (and, for HTTPS,
   `TRAEFIK_ENTRYPOINT=websecure`, `TRAEFIK_TLS=true`).

In production the backend validates its environment on start and exits with the full list
of problems: missing secrets, placeholder or short JWT secrets, `SameSite=None` without
`Secure`, bad CORS origins. It only logs warnings for degraded features such as missing
storage credentials or `RESEND_API_KEY`.

### Release

On your workstation, with a `.env` that holds the **production** values (the script refuses
`localhost` URLs, because `NEXT_PUBLIC_*` are baked into the frontend image):

```bash
docker login
bash build-push.sh
```

Then on the VPS, with the same `OA_VERSION` in its `.env`:

```bash
bash deploy-vps.sh
curl -fsS https://api.openassets.example.com/health
```

To ship a new version, bump `OA_VERSION` in both `.env` files and repeat. To roll back, set
the old `OA_VERSION` on the VPS and run `bash deploy-vps.sh`.

### Operating it

- **Health.** `GET /health` on the API returns `200 {"status":"ok"}` only while MongoDB and
  Redis both answer, `503` with `degraded` otherwise and `503 shutting_down` while it drains.
  Docker uses it for the backend healthcheck.
- **Shutdown.** `docker compose stop` sends SIGTERM. The backend stops accepting requests,
  lets running jobs finish, closes the queues, Redis and MongoDB, and exits (up to
  `SHUTDOWN_TIMEOUT_MS`, 25 s; Compose waits 35 s before killing it).
- **Logs.** `docker compose logs -f backend`.
- **Backups.** MongoDB holds the only durable data (users, collections, credits):

  ```bash
  docker compose exec -T mongo mongodump --archive --gzip > openassets-$(date +%F).gz
  docker compose exec -T mongo mongorestore --archive --gzip --drop < openassets-2026-01-31.gz
  ```

  Redis only holds job state that expires after 24 hours and queued work.
- **Security.** Keep `mongo`, `redis` and `py_backend` off the public internet (they publish no
  ports; do not add any). `INTERNAL_API_TOKEN` is the only authentication on the AI service.

### Coming from the old compose file

The previous `docker-compose.yml` ran only `backend` and `py_backend`, read
`backend/.env` and `py_backend/.env`, pointed Redis at a shared `openpoll-redis` container and
took MongoDB from `MONGO_URI` in `backend/.env`. Now there is one root `.env`, and the stack
carries its own MongoDB and Redis. If your users and collections already live in a MongoDB
outside the stack, set `MONGO_URI` (and `MONGO_DB_NAME`) in `.env` to it and nothing needs
migrating. Otherwise `mongodump` the old database and `mongorestore` it into the new `mongo`
service. Job state in Redis expires after 24 hours, so it does not need moving. The web app was
not part of the stack before; it now builds from `frontend/`. Copy the values you used in
`backend/.env`, `py_backend/.env` and `frontend/.env.local` into the root `.env` (see the table
above for names).

---

## Credits

Studio features (AI outpainting, Parallax/Tile/Sprite/Props studios) are adapted from
[image-extender](https://github.com/boona13/image-extender) by **boona13** (MIT License).
See `frontend/src/features/studio/LICENSE-image-extender.txt`.

---

## Further reading

Plans, limits and granting Pro: [`docs/plans-and-entitlements.md`](docs/plans-and-entitlements.md).

Per-service deep dives live in [`docs/llm_wiki/`](docs/llm_wiki/):
[`architecture.md`](docs/llm_wiki/architecture.md) ·
[`pipelines.md`](docs/llm_wiki/pipelines.md) ·
[`backend.md`](docs/llm_wiki/backend.md) ·
[`frontend.md`](docs/llm_wiki/frontend.md) ·
[`py_backend.md`](docs/llm_wiki/py_backend.md) ·
[`auth.md`](docs/llm_wiki/auth.md) ·
[`storage.md`](docs/llm_wiki/storage.md) ·
[`llm_providers.md`](docs/llm_wiki/llm_providers.md) ·
[`env_vars.md`](docs/llm_wiki/env_vars.md)

> Some wiki pages predate the pluggable-storage refactor and still say
> "Cloudinary only" / "Google Vision" — the storage layer is now provider-agnostic
> (`backend/src/lib/storage/`) and asset naming goes through the LLM chain in
> `py_backend/app/services/llm/`. This README reflects the current code.
```
