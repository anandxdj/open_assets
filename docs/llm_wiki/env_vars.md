# Environment Variables

The `.env.example` files are the reference. Every variable the code reads is listed in
one of them with a comment, so this page only says which file belongs to what. (It used
to repeat the values and drifted out of date.)

| File | Used by | Copy to |
|---|---|---|
| [`/.env.example`](../../.env.example) | `docker compose` (the whole stack) | `.env` |
| [`/backend/.env.example`](../../backend/.env.example) | Express API + workers, run from source | `backend/.env` |
| [`/py_backend/.env.example`](../../py_backend/.env.example) | FastAPI AI service, run from source | `py_backend/.env` |
| [`/frontend/.env.example`](../../frontend/.env.example) | Next.js web app, run from source | `frontend/.env.local` |
| [`/extension/.env.example`](../../extension/.env.example) | Chrome extension build | `extension/.env` |

## Things worth knowing

- **Backend validates on start.** `backend/src/common/config/env.ts` checks the
  environment before any other module loads and exits with a list of every problem.
  In production it requires `MONGO_URI`, `REDIS_URL`, `FRONTEND_URL`, `PY_BACKEND_URL` and
  two different JWT secrets of 32+ characters (not the `.env.example` placeholders). Missing
  optional pieces (storage credentials, email, extension origin, shared tokens) are logged
  as warnings: the API still starts and the affected features report "not configured".
- **CORS and cookies are env-driven.** Allowed origins are `FRONTEND_URL`, `CORS_ORIGINS`
  and `EXTENSION_ORIGINS`; outside production any localhost port and unpacked extension
  also pass. `COOKIE_SECURE`, `COOKIE_SAMESITE` and `COOKIE_DOMAIN` control the refresh-token
  cookie (production default: `Secure`, `SameSite=None`).
- **`NEXT_PUBLIC_*` are build-time.** The frontend inlines them into the bundle, so a change
  needs a rebuild (a new image under Docker). The same goes for the extension's
  `WXT_PUBLIC_*`. Never put a secret in one of them.
- **Shared secrets.** `INTERNAL_API_TOKEN` is shared by the backend and the AI service;
  `INTERNAL_SERVICE_TOKEN` by the backend and the web app's Studio routes. Under Compose,
  set each once in the root `.env`.
- **Two Open Quota URLs.** The web app calls `https://openquota.anands.dev/llm/v1`; the AI
  service calls the `/llm` root. In the root `.env` they are `OPENQUOTA_BASE_URL` and
  `OPENQUOTA_PY_BASE_URL`.
- **Job lifetime.** Job state in Redis expires after 24 hours (`JOB_TTL` in
  `backend/src/modules/jobs/job.store.ts`). It is a constant, not a variable.
