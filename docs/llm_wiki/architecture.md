# Architecture

## System Diagram

```
Browser (Next.js :3000)
         |
         | HTTP REST
         v
Express API (:4000)
   |          |
   |          +---> MongoDB :27017  (auth: users, tokens)
   |          +---> Redis :6379     (job state, BullMQ queues)
   |          +---> Cloudinary      (all image storage)
   |
   | HTTP (axios)
   v
FastAPI py_backend (:8000)
   |
   +---> OpenCV / numpy     (detection, cropping)
   +---> Cloudinary SDK     (upload cropped images)
   +---> Google Vision API  (batch label detection)
```

## Services

| Service | Port | Technology | Purpose |
|---|---|---|---|
| Frontend | 3000 | Next.js 16, React 19, Tailwind 4, TypeScript | UI, canvas editor |
| Backend | 4000 | Express, TypeScript, tsx | API, auth, BullMQ workers |
| AI Service | 8000 | FastAPI, Python 3.11, OpenCV | Image detection, cropping, Vision |
| MongoDB | 27017 | Docker, mongo:7 | Auth data only |
| Redis | 6379 | Docker, redis:7-alpine | Job state + BullMQ |
| Cloudinary | external | SaaS | All image storage + CDN |
| Google Vision | external | REST API | Asset label detection (batch, 16/call max) |

## Request Flow: Upload → Detect → Export

```
1. POST /api/upload (multipart)
   → multer (memory buffer, 20MB limit)
   → Cloudinary upload_stream (folder: open_assets/originals)
   → Redis: createJob (status=uploaded)
   → BullMQ: detectionQueue
   → Response: { jobId, cloudinaryUrl, status: "queued" }

2. BullMQ detection.worker (async)
   → axios POST py_backend:8000/detect { image_url }
   → py_backend: OpenCV contours → named boxes (asset_001, asset_002...)
   → Redis: updateJob (status=detected, boxes=JSON, imageWidth, imageHeight)

3. Frontend polls GET /api/jobs/:jobId every 2s
   → Returns { status, boxes, imageWidth, imageHeight }
   → On detected: render Konva canvas with bounding boxes

4. User edits boxes in canvas → POST /api/crop-export { jobId, boxes }
   → Redis: createExportJob (status=pending)
   → BullMQ: exportQueue
   → Response: { exportJobId }

5. BullMQ export.worker (async)
   → axios POST py_backend:8000/crop-and-analyze { image_url, boxes, job_id }
   → py_backend: numpy slice each box → Cloudinary upload (public_id = box.name)
   → py_backend: ONE batch Google Vision call for all cropped URLs
   → Returns AssetResult[] { id, name, cropped_url, labels, description }
   → Node archiver: zip all crops (downloaded by URL) + metadata.json
   → Cloudinary: upload zip (resource_type: raw, folder: open_assets/exports)
   → Redis: updateExportJob (status=ready, downloadUrl)

6. Frontend polls GET /api/export/:exportJobId/status
   → On ready: GET /api/export/:exportJobId/download → 302 → Cloudinary zip URL
```

## Auth Flow

```
Register/Login → JWT access token (15m) + refresh token (7d, httpOnly cookie)
Access token → Bearer header on all protected routes
Refresh → POST /api/auth/refresh-token → new access token
Google OAuth → /api/auth/google → /api/auth/google/callback → redirect with tokens
```

## Directory Structure

```
open_assets/
  frontend/          Next.js app (src/ structure, feature-domain organized)
  backend/           Express API
  py_backend/        FastAPI AI service
  docs/llm_wiki/     This documentation
  plan.md            Project overview
  docker-compose.yml Redis + MongoDB
```

## Key Design Decisions

- **No SQL for jobs** — Redis hashes are sufficient; jobs are ephemeral (24h TTL)
- **Cloudinary only** — no ImageKit, no S3; Cloudinary handles upload + CDN
- **py_backend is stateless** — no DB, pure compute; Express owns all persistence
- **Auth is done** — `src/modules/auth/` is complete; do not modify
- **Frontend owns final box state** — user edits bounding boxes client-side; edited list sent on export, not synced incrementally
- **Single Vision batch call** — all crops uploaded first, then ONE Google Vision call for all; mapped back by index
- **Asset names set at crop time** — `public_id = box.name` in Cloudinary → filename IS the asset name (asset_001.png)
- **Frontend structure** — Feature/Domain-Driven: `src/app/` routing only, business logic in `src/features/`
