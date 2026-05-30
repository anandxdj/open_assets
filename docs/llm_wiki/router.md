# LLM Wiki — Router

Index for all project documentation. Read the relevant file before touching that area of code.

## Files

| File | What It Covers |
|---|---|
| [architecture.md](./architecture.md) | System diagram, service boundaries, ports, full request flow |
| [auth.md](./auth.md) | Auth module — endpoints, JWT flow, MongoDB schema, Google OAuth — DO NOT MODIFY |
| [storage.md](./storage.md) | Cloudinary: folder structure, upload patterns |
| [redis_schema.md](./redis_schema.md) | All Redis key patterns, hash fields, TTLs, job state machine |
| [pipelines.md](./pipelines.md) | All 5 pipelines: what runs where, data flow, worker logic |
| [backend.md](./backend.md) | Express module structure, all routes, middleware — Phases 1-6 complete |
| [py_backend.md](./py_backend.md) | FastAPI endpoints, OpenCV detection logic, Google Vision, Pydantic schemas |
| [frontend.md](./frontend.md) | Next.js folder structure, feature domains, API client, types, phase plans |
| [env_vars.md](./env_vars.md) | All environment variables across all services |
| [build_order.md](./build_order.md) | Phase-by-phase implementation sequence — Phase 7 is NEXT |

## Build Status

| Layer | Status |
|---|---|
| Backend (Phases 1-6) | ✅ complete — typecheck clean |
| py_backend | ✅ complete |
| Frontend structure | ✅ scaffolded — Feature/Domain-Driven, src/ layout |
| Frontend upload page | 🔲 Phase 7 NEXT |
| Frontend Konva editor | 🔲 Phase 8 |
| Frontend polish + history | 🔲 Phase 9 |

## Quick Start for LLMs

1. Read `architecture.md` — understand the full system shape
2. Read the file for the specific area you're working on
3. Never touch `backend/src/modules/auth/` — that module is complete and tested
4. All job/asset state lives in Redis — see `redis_schema.md`
5. All images live in Cloudinary — see `storage.md`
6. Frontend uses `@/*` → `src/*` path alias; features live in `src/features/`, not in `src/app/`
