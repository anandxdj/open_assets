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
ACCESS_TOKEN_SECRET=change-me-access
REFRESH_TOKEN_SECRET=change-me-refresh

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

# Google Vision REST API — get from Google Cloud Console → APIs & Services → Credentials
GOOGLE_VISION_API_KEY=

# OpenCV detection tuning
MIN_BOX_WIDTH=20
MIN_BOX_HEIGHT=20
MIN_BOX_AREA=400
BINARY_THRESH_VALUE=240
VISION_BATCH_SIZE=16
```

## frontend/.env.local

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Service Dependency Map

| Var | Used By | Purpose |
|---|---|---|
| MONGO_URI | backend | auth user storage |
| REDIS_URL | backend | job state + BullMQ |
| CLOUDINARY_* | backend + py_backend | image upload/retrieve |
| ACCESS_TOKEN_SECRET | backend | JWT sign/verify |
| REFRESH_TOKEN_SECRET | backend | refresh JWT sign/verify |
| GOOGLE_CLIENT_ID/SECRET | backend | OAuth |
| GOOGLE_CALLBACK_URL | backend | OAuth redirect |
| RESEND_API_KEY | backend | email delivery |
| RESEND_FROM_EMAIL | backend | email from address |
| PY_BACKEND_URL | backend | HTTP calls to FastAPI |
| FRONTEND_URL | backend | CORS allow-list |
| GOOGLE_VISION_API_KEY | py_backend | batch asset label detection (optional — degrades gracefully) |
| VISION_BATCH_SIZE | py_backend | max images per Vision API call (default 16) |
| MIN_BOX_* / BINARY_THRESH_* | py_backend | OpenCV detection tuning |
| NEXT_PUBLIC_API_URL | frontend | backend base URL for API calls |

## Docker services (docker-compose.yml)

```bash
# MongoDB accessible at: mongodb://localhost:27017/open_assets
# Redis accessible at: redis://localhost:6379
```
No additional env vars needed for local Docker services.
