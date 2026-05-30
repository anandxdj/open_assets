# open_assets — Project Plan

## What It Is
AI-powered asset extraction tool. Upload sprite sheet / icon pack / manga panel / UI kit → auto-detect individual assets via OpenCV → review bounding boxes on canvas → export cropped assets as zip.

## Storage
| Data | Store |
|---|---|
| User accounts, auth tokens | MongoDB |
| Job state, bounding boxes | Redis (hashes, 24h TTL) |
| All images (originals, crops, zips) | Cloudinary |
| AI auto-naming/tagging | Gemini Flash API |

## Services
| Service | Port | Stack |
|---|---|---|
| Frontend | 3000 | Next.js 16 + React 19 + Tailwind 4 + TypeScript |
| Backend API | 4000 | Express + TypeScript (tsx) |
| AI Service | 8000 | FastAPI + Python + OpenCV |
| MongoDB | 27017 | Docker |
| Redis | 6379 | Docker |

## 5 Pipelines
1. **Detection** — OpenCV contour detection → bounding boxes stored in Redis
2. **Extraction** — numpy crop slices → Cloudinary crop uploads → zip via archiver
3. **Enhancement** — Cloudinary `e_upscale` / `e_background_removal` transformations
4. **Organization** — Gemini Flash vision API → auto-labels + tags in Redis
5. **Export** — archiver zip → Cloudinary raw upload → download redirect

## Build Order
- Phase 0: plan.md + docs/llm_wiki + docker-compose.yml ← YOU ARE HERE
- Phase 1: Fix backend (package.json, app.ts, .env, .gitignore)
- Phase 2: Add Cloudinary + BullMQ configs
- Phase 3: Redis job store + upload route
- Phase 4: py_backend detect + crop endpoints
- Phase 5: BullMQ detection worker
- Phase 6: Frontend upload page
- Phase 7: Frontend Konva editor
- Phase 8: Export worker + download route
- Phase 9: Enhancement routes (Cloudinary transforms)
- Phase 10: Auto-naming via Gemini

## LLM Wiki
Full project documentation at `docs/llm_wiki/`. Start with `router.md`.

## Key Decisions
- No SQL — Redis handles all job/asset state (ephemeral, auto-expires)
- No ImageKit — Cloudinary handles everything (upload, CDN, AI transforms)
- Bounding boxes sent from frontend on export (user's edited state is authoritative)
- py_backend is stateless — no DB, just OpenCV compute
- Auth is complete — do not modify `src/modules/auth/`
