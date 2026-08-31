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

# The Next app as a service this gateway calls INTO, for the AniBuddy vision
# calls a queued job makes. Falls back to FRONTEND_URL.
NEXT_INTERNAL_URL=http://localhost:3000
# Shared secret for server-to-server calls between this gateway and Next, in both
# directions. Must match the Next app's INTERNAL_SERVICE_TOKEN.
INTERNAL_SERVICE_TOKEN=change-me-service-token
# Shared secret this gateway sends to py_backend as X-Internal-Token. Deliberately
# NOT the same as INTERNAL_SERVICE_TOKEN and held by this process only — the Next
# app must never have it, or a browser-facing route could reach every py_backend
# endpoint. Empty disables enforcement on both sides (local development).
INTERNAL_API_TOKEN=

# AniBuddy: the vision model a queued stage's usage event is pre-authorized
# against. Must match the Next app's ANIBUDDY_PROPOSAL_MODEL.
ANIBUDDY_PROPOSAL_MODEL=google/gemini-2.5-flash
# One critique job is up to three renders plus three vision calls under a single
# wall-clock budget, so it defaults to one at a time.
ANIBUDDY_CRITIQUE_CONCURRENCY=1
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
# Asset naming is a vision task. This overrides the legacy unified value.
OPENQUOTA_VISION_MODEL=auto
# Legacy fallback used when the specialized setting is absent.
OPENQUOTA_MODEL=auto

# Gemini (fallback) — get key from https://aistudio.google.com/
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

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

# AniBuddy editor route gate. Off by default: (anibuddy)/layout.tsx serves
# ComingSoonPage until this is on.
NEXT_PUBLIC_ANIBUDDY_EDITOR_ENABLED=0

# Studio (server-only, used by /api/studio/* route handlers)
EXPRESS_INTERNAL_URL=http://localhost:4000
INTERNAL_SERVICE_TOKEN=change-me-service-token

# Open Quota — primary provider for the text/vision studio routes.
# Empty = OpenRouter-only. BYOK requests never reach it.
OPENQUOTA_API_KEY=
OPENQUOTA_BASE_URL=https://openquota.anands.dev/llm/v1
# Text-only routes use the smarter profile; image-bearing routes use the
# dashboard fallback chain by default.
OPENQUOTA_TEXT_MODEL=auto:smart
OPENQUOTA_VISION_MODEL=auto
# Legacy fallback used when a specialized setting is absent.
OPENQUOTA_MODEL=auto

# OpenRouter — fallback for text/vision, sole provider for the image routes
OPENROUTER_API_KEY=
OPENROUTER_FALLBACK_MODEL=google/gemini-2.5-flash
OPENROUTER_MOCK=0

# AniBuddy — concept interview (the one browser-reachable AniBuddy LLM route)
ANIBUDDY_PROMPT_OPENQUOTA_MODEL=google/gemini-2.5-flash
ANIBUDDY_PROMPT_OPENQUOTA_FALLBACK_MODEL=auto
# AniBuddy — the three internal v5 proposal routes (semantics, motion, critique)
# share one vision model so their three revalidators tune against one failure
# profile. Must match the backend's ANIBUDDY_PROPOSAL_MODEL.
ANIBUDDY_PROPOSAL_MODEL=google/gemini-2.5-flash
ANIBUDDY_PROPOSAL_FALLBACK_MODEL=auto
# Off by default: the proposal routes answer 503 until this is on.
ANIBUDDY_PIPELINE_ENABLED=0
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
| OPENQUOTA_TEXT_MODEL | frontend | text-only routing strategy (default `auto:smart`) |
| OPENQUOTA_VISION_MODEL | py_backend + frontend | image-bearing routing strategy (default `auto`) |
| OPENQUOTA_MODEL | py_backend + frontend | legacy routing-strategy fallback, not a model ID |
| GEMINI_API_KEY / GEMINI_MODEL | py_backend | asset-naming fallback (optional — degrades gracefully) |
| INTERNAL_API_TOKEN | backend + py_backend | shared secret for Node→FastAPI calls. The Next app deliberately does not hold it |
| ALLOWED_IMAGE_HOSTS | py_backend | host allowlist for image fetches |
| MIN_BOX_* / BINARY_THRESH_* | py_backend | OpenCV detection tuning |
| NEXT_PUBLIC_API_URL | frontend | backend base URL for API calls |
| EXPRESS_INTERNAL_URL | frontend | Express reachable from the Next server (credits) |
| INTERNAL_SERVICE_TOKEN | frontend + backend | guards the credit-refund endpoint, the AniBuddy annotate proxy, and the gateway's AniBuddy vision calls |
| NEXT_INTERNAL_URL | backend | Next reachable from the gateway, for the AniBuddy vision calls (falls back to FRONTEND_URL) |
| NEXT_PUBLIC_ANIBUDDY_EDITOR_ENABLED | frontend | gates the `/anibuddy` editor route; off serves ComingSoonPage |
| ANIBUDDY_PIPELINE_ENABLED | frontend | gates the internal semantics/motion/critique routes; off answers 503 |
| ANIBUDDY_PROPOSAL_MODEL | frontend + backend | one vision model for all three proposal calls; the two must agree or the credit pre-authorization names a model that is never requested |
| ANIBUDDY_PROPOSAL_FALLBACK_MODEL | frontend | Open Quota routing profile tried after the explicit model |
| ANIBUDDY_PROMPT_OPENQUOTA_MODEL / _FALLBACK_MODEL | frontend | the concept-interview call only |
| ANIBUDDY_CRITIQUE_CONCURRENCY | backend | critique jobs in flight; 1 by default |
| OPENROUTER_API_KEY | frontend | fallback text/vision provider; sole image provider |
| OPENROUTER_FALLBACK_MODEL | frontend | OpenRouter model ID used after Open Quota fails |
| OPENROUTER_MOCK | frontend | `1` returns fixtures, no provider call |

## Docker services (docker-compose.yml)

```bash
# MongoDB accessible at: mongodb://localhost:27017/open_assets
# Redis accessible at: redis://localhost:6379
```
No additional env vars needed for local Docker services.
