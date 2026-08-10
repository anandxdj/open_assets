# Environment Variables

## backend/.env

```bash
# Server
PORT=4000
NODE_ENV=development

# MongoDB — auth data only
MONGO_URI=mongodb://localhost:27017/open_assets

# Redis — job state + BullMQ queues
REDIS_URL=redis://127.0.0.1:6379

# Cloudinary — all image storage
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# JWT
JWT_ACCESS_SECRET=change-me-access
JWT_REFRESH_SECRET=change-me-refresh

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

# Resend — transactional email
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@yourdomain.com

# Python AI service
PY_BACKEND_URL=http://localhost:8000

# CORS
FRONTEND_URL=http://localhost:3000
```

## py_backend/.env

```bash
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Asset naming — provider chain is Open Quota, then Gemini, then identity names.
# Open Quota (primary). Empty = Gemini-only. Note the /llm root, not /llm/v1:
# we call the native Gemini surface at <root>/v1beta/models/<model>:generateContent.
OPENQUOTA_API_KEY=
OPENQUOTA_BASE_URL=https://openquota.anands.dev/llm
OPENQUOTA_MODEL=auto

# Gemini (fallback) — get key from https://aistudio.google.com/
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash

# Shared secret the Node backend must send in X-Internal-Token (empty disables)
INTERNAL_API_TOKEN=

# Host allowlist for image fetches (comma-separated)
ALLOWED_IMAGE_HOSTS=res.cloudinary.com,cloudinary.com

# OpenCV detection tuning
MIN_BOX_WIDTH=20
MIN_BOX_HEIGHT=20
MIN_BOX_AREA=400
BINARY_THRESH_VALUE=240
```

## frontend/.env.local

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000

# Studio (server-only, used by /api/studio/* route handlers)
EXPRESS_INTERNAL_URL=http://localhost:4000
INTERNAL_SERVICE_TOKEN=change-me-service-token

# Open Quota — primary provider for the text/vision studio routes.
# Empty = OpenRouter-only. BYOK requests never reach it.
OPENQUOTA_API_KEY=
OPENQUOTA_BASE_URL=https://openquota.anands.dev/llm/v1
OPENQUOTA_MODEL=auto

# OpenRouter — fallback for text/vision, sole provider for the image routes
OPENROUTER_API_KEY=
OPENROUTER_MOCK=0
```

## Service Dependency Map

| Var | Used By | Purpose |
|---|---|---|
| MONGO_URI | backend | auth user storage |
| REDIS_URL | backend | job state + BullMQ |
| CLOUDINARY_* | backend + py_backend | image upload/retrieve |
| JWT_ACCESS_SECRET | backend | JWT sign/verify |
| JWT_REFRESH_SECRET | backend | refresh JWT sign/verify |
| GOOGLE_CLIENT_ID/SECRET | backend | OAuth |
| GOOGLE_CALLBACK_URL | backend | OAuth redirect |
| RESEND_API_KEY | backend | email delivery |
| RESEND_FROM_EMAIL | backend | email from address |
| PY_BACKEND_URL | backend | HTTP calls to FastAPI |
| FRONTEND_URL | backend | CORS allow-list |
| OPENQUOTA_API_KEY | py_backend + frontend | primary LLM provider (optional — falls back) |
| OPENQUOTA_BASE_URL | py_backend + frontend | proxy root; `/llm` for py_backend, `/llm/v1` for frontend |
| OPENQUOTA_MODEL | py_backend + frontend | routing strategy, not a model id (default `auto`) |
| GEMINI_API_KEY / GEMINI_MODEL | py_backend | asset-naming fallback (optional — degrades gracefully) |
| INTERNAL_API_TOKEN | py_backend | shared secret for Node→FastAPI calls |
| ALLOWED_IMAGE_HOSTS | py_backend | host allowlist for image fetches |
| MIN_BOX_* / BINARY_THRESH_* | py_backend | OpenCV detection tuning |
| NEXT_PUBLIC_API_URL | frontend | backend base URL for API calls |
| EXPRESS_INTERNAL_URL | frontend | Express reachable from the Next server (credits) |
| INTERNAL_SERVICE_TOKEN | frontend + backend | guards the credit-refund endpoint |
| OPENROUTER_API_KEY | frontend | fallback text/vision provider; sole image provider |
| OPENROUTER_MOCK | frontend | `1` returns fixtures, no provider call |

## Docker services (docker-compose.yml)

```bash
# MongoDB accessible at: mongodb://localhost:27017/open_assets
# Redis accessible at: redis://localhost:6379
```
No additional env vars needed for local Docker services.
