# Security Remediation — `open_assets`

**Date:** 2026-05-30
**Companion to:** `SECURITY_AUDIT.md` (re-run the audit after the manual deploy actions below).

This phase shipped the **Public Collections & Community Hub** feature and closed the audit's 17 findings. Because the feature adds public read/download surfaces, the ownership and SSRF fixes were treated as prerequisites, not follow-ups.

## Finding status

| # | Finding | Status | Where |
|---|---------|--------|-------|
| 1 | Registration role-escalation | ✅ Fixed | `register.schema.ts` (no `role`), `auth.service.ts` (`role:'user'` hardcoded) |
| 2 | Job IDOR (cross-tenant read) | ✅ Fixed | new `common/utils/authz.ts` `assertOwner()`, applied in `job.routes.ts`, `crop.controller.ts`, `finalize.controller.ts`; reused for all collection authz |
| 3 | Python exception leak | ✅ Fixed | `py_backend/app/main.py` generic 500 + server-side `logging` |
| 4 | Live secrets in working tree | ⚠️ Code done / **manual rotation required** | server secrets removed from `frontend/.env.local`; **rotate keys + set strong JWT secrets (see below)** |
| 5 | No rate limiting | ✅ Fixed | `express-rate-limit` (`rateLimit.ts`: auth 10/15m, upload 30/15m, global 1000/15m); `slowapi` 120/min on Python |
| 6 | No tests / CI / dep scanning | ✅ Added | `.github/workflows/ci.yml` (typecheck + tests + `pnpm audit` + `pip-audit`); smoke tests `backend/src/__tests__/security.test.ts` |
| 7 | OAuth token in redirect URL | ✅ Fixed | token now in URL **fragment**; `auth.controller.ts`, `app.ts`, frontend `callback/page.tsx` (reads hash + scrubs it) |
| 8 | Frontend ships no security headers | ✅ Fixed | `frontend/next.config.ts` `headers()` (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) |
| 9 | SSRF in image fetch | ✅ Fixed | `image_io.py` `_validate_image_url()` — https-only, host allowlist, blocks private/link-local/loopback (incl. `169.254.169.254`) |
| 10 | Python service has no auth | ✅ Fixed (opt-in) | `X-Internal-Token` shared secret — Node `py.client.ts` sends, Python `main.py` middleware enforces when `INTERNAL_API_TOKEN` set |
| 11 | Sensitive / unstructured logging | ◑ Partial | OAuth `detail` no longer logged or returned to client (`auth.service.ts`); Python uses `logging`. Full pino/winston framework **deferred** |
| 12 | Email verify accepts raw token | ✅ Fixed | `auth.service.ts` — hashed-token match only |
| 13 | Server secrets in frontend env | ✅ Fixed | `frontend/.env.local` reduced to `NEXT_PUBLIC_API_URL` |
| 14 | Refresh endpoint CSRF | ◑ Accepted | `sameSite=lax` already blocks cross-site POST from sending the cookie; documented. Tighten to `strict`/token if threat model changes |
| 15 | No explicit HTTPS enforcement | ◑ Documented | TLS terminated at proxy/host; set `NODE_ENV=production` so the `secure` cookie flag activates (see below) |
| 16 | No JSON body size cap | ✅ Fixed | `express.json({ limit: '100kb' })` in `app.ts` |
| 17 | `ioredis` version drift | ✅ Fixed | `backend/package.json` declares `^5.11.0` |

## Required manual / deploy actions (not doable from code)

1. **Rotate now** (treat as burned — they were in plaintext on disk): Cloudinary `API_KEY`/`API_SECRET`, `GEMINI_API_KEY`.
2. **Set strong prod JWT secrets**: `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` (e.g. `openssl rand -hex 32`) in `backend/.env`. The current values are the `dev-…-change-in-prod` placeholders.
3. **Set `INTERNAL_API_TOKEN`** to the same value in `backend/.env` and `py_backend/.env` to activate the Node→Python shared-secret check (#10). Keep port 8000 off the public internet.
4. **Set `NODE_ENV=production`** in the backend so the refresh cookie is `secure` (#15). Terminate TLS at the proxy/host.
5. Keep MongoDB/Redis on a private network with auth enabled; never expose 27017/6379 publicly.

## Verification done in this phase

- `backend`: `pnpm typecheck` ✅, `pnpm test` ✅ (6/6 — covers role-strip #1 and `assertOwner` #2).
- `frontend`: `tsc --noEmit` ✅.
- `py_backend`: standard FastAPI/slowapi wiring (validated in CI via `compileall` + `pip install`; no local Python runtime).
