# Security & Production-Readiness Audit — `open_assets`

**Date:** 2026-05-30
**Auditor:** Claude Code
**Scope:** Full stack — Next.js 16 frontend, Express 4 + MongoDB + Redis/BullMQ backend, FastAPI + OpenCV Python service.
**Type:** Audit only. No code was changed. Every finding cites a verified `file:line`.

> **Assumption:** `py_backend` (port 8000) is **internal-only** — reached only by the Node backend over a private network. SSRF and missing-auth on the Python service are rated as defense-in-depth (Medium) on that basis. If it is ever exposed publicly, re-rate items #9 and #10 to High/Critical.

---

## 1. Executive Summary

**Verdict: NOT ready for production.** There are 3 Critical issues that allow account/privilege takeover and cross-user data access, plus live credentials in the working tree.

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 3 |
| 🟡 Medium | 7 |
| ⚪ Low / Info | 4 |

**Fix before any deploy:** rotate leaked keys, close the registration role-escalation, add the job ownership check, stop the Python service leaking exceptions, and add rate limiting.

---

## 2. Severity Legend

- 🔴 **Critical** — remote takeover, privilege escalation, or cross-tenant data access. Block release.
- 🟠 **High** — serious exposure or missing control that will likely be exploited. Fix before launch.
- 🟡 **Medium** — real weakness; exploit needs conditions or has limited blast radius.
- ⚪ **Low / Info** — hardening, hygiene, or low-likelihood issues.

---

## 3. Findings Table

| ID | Title | Severity | Location |
|----|-------|----------|----------|
| 1 | Privilege escalation via registration `role` | 🔴 Critical | `backend/src/modules/auth/dto/register.schema.ts:9`, `auth.service.ts:34` |
| 2 | IDOR — any user reads/downloads any job | 🔴 Critical | `backend/src/modules/jobs/job.routes.ts:12-40` |
| 3 | Python service leaks exception internals | 🔴 Critical | `py_backend/app/main.py:24` |
| 4 | Live secrets in working-tree `.env` files | 🟠 High | `backend/.env`, `frontend/.env.local`, `py_backend/.env` |
| 5 | No rate limiting anywhere | 🟠 High | (absent across all services) |
| 6 | No tests, no CI, no dependency scanning | 🟠 High | (absent) |
| 7 | OAuth access token in redirect URL | 🟡 Medium | `backend/src/modules/auth/auth.controller.ts:135` |
| 8 | Frontend sends no security headers | 🟡 Medium | `frontend/next.config.ts` (empty) |
| 9 | SSRF in image fetch | 🟡 Medium | `py_backend/app/services/image_io.py:11` |
| 10 | Python service has no auth | 🟡 Medium | `py_backend/app/main.py` |
| 11 | Sensitive / unstructured logging | 🟡 Medium | `auth.service.ts:42,143,187,303`, `main.py:21` |
| 12 | Email verify accepts raw (unhashed) token | 🟡 Medium | `backend/src/modules/auth/auth.service.ts:155-159` |
| 13 | Server secrets live in frontend env file | 🟡 Medium | `frontend/.env.local` |
| 14 | Refresh endpoint has no CSRF defense | ⚪ Low | `auth.controller.ts:39-47` |
| 15 | No explicit HTTPS enforcement | ⚪ Low | (deploy-dependent) |
| 16 | No JSON body size cap | ⚪ Low | `backend/src/app.ts:21` |
| 17 | `ioredis` version drift | ⚪ Info | `backend/package.json` |

---

## 4. Detailed Findings

### 🔴 1. Privilege escalation via registration `role`

**Where:** `backend/src/modules/auth/dto/register.schema.ts:9`, `backend/src/modules/auth/auth.service.ts:34`

The registration schema accepts a `role` field straight from the request body:

```ts
// register.schema.ts:9
role: z.enum(['user', 'admin']).default('user'),
```
```ts
// auth.service.ts:34
role: role || 'user',
```

**Impact:** Anyone can `POST /api/auth/register` with `{"role":"admin"}` and become an admin. The `authorize()` middleware exists for role gating — the moment any admin route is added, this becomes full admin takeover. Critical regardless.

**Fix:** Remove `role` from `registerSchema` entirely. In `register()`, hardcode `role: 'user'`. Promote admins only out-of-band (DB / internal tool), never from client input.

---

### 🔴 2. IDOR — any authenticated user can read/download any job

**Where:** `backend/src/modules/jobs/job.routes.ts:12-40`, `backend/src/modules/jobs/job.store.ts:44`

Both job routes are authenticated but never verify ownership:

```ts
// job.routes.ts:13
const job = await getJob(req.params['jobId'] ?? '');
if (!job) throw ApiError.notFound('Job not found');
// ...returns image URLs, boxes, download URL — no owner check
```

`getJob()` returns the raw Redis hash with no user filter. The owner IS recorded (`job.store.ts:29` stores `userId`) but never compared to `req.user.id`.

**Impact:** Job IDs are the only thing protecting another user's uploaded images, detection results, and export ZIP. Any logged-in user who obtains/guesses a `jobId` reads and downloads another user's data. Cross-tenant data breach.

**Fix:** After loading the job, enforce ownership:

```ts
if (job.userId !== req.user!.id) throw ApiError.forbidden('Not your job');
```

Apply the same guard anywhere a job is loaded by ID — also check the crop and finalize controllers (`crop.controller.ts`, `finalize.controller.ts`), which load jobs from client-supplied IDs.

---

### 🔴 3. Python service leaks exception internals to the client

**Where:** `py_backend/app/main.py:24`

```py
return JSONResponse(
    status_code=500,
    content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"},
)
```

**Impact:** Raw exception type and message are returned to the caller — leaks internal paths, library internals, and possibly URLs/credentials embedded in error strings. Even internal-only, these messages flow back through the Node backend and can surface to users.

**Fix:** Return a generic body; log the detail server-side only.

```py
traceback.print_exc()  # or structured logger
return JSONResponse(status_code=500, content={"detail": "Internal server error"})
```

---

### 🟠 4. Live secrets in working-tree `.env` files

**Where:** `backend/.env`, `frontend/.env.local`, `py_backend/.env`

All three hold **real** credentials:
- `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
- `GEMINI_API_KEY`
- JWT secrets set to the placeholder `dev-...-change-in-prod`

`.gitignore` does cover them (root `.env`, `backend/.gitignore` → `.env`, `frontend/.gitignore` → `.env*`), so they may not be committed — but the keys are live on disk and must be treated as exposed.

**Impact:** Anyone with repo/disk access has working Cloudinary and Gemini credentials (billable, abusable). The committed JWT secrets are guessable defaults — if shipped, every token is forgeable.

**Fix:**
1. **Rotate now** — revoke + reissue Cloudinary and Gemini keys; assume burned.
2. Generate strong random `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` for prod (e.g. `openssl rand -hex 32`).
3. Verify history is clean: `git log --all --full-history -- "**/.env*"`. If any are tracked, scrub with `git filter-repo` and force-push.
4. In production use a real secrets manager (Vault, AWS Secrets Manager, Doppler) — not files.

---

### 🟠 5. No rate limiting anywhere

**Where:** absent — no `express-rate-limit` / `slowapi` in any `package.json` or `requirements.txt`.

Unprotected and brute-forceable: `/api/auth/login`, `/register`, `/forgot-password`, `/reset-password/:token`, `/verify-email/:token`, `/resend-verification`, and `/api/upload` (resource abuse).

**Impact:** Password brute-force, reset/verify-token guessing, email-bombing via resend, and upload-driven cost abuse (Cloudinary + Gemini).

**Fix:**
- Add `express-rate-limit`. Strict limiter on auth (e.g. 5–10 requests / 15 min / IP on login + password-reset), looser global limiter on `/api`.
- `app.set('trust proxy', 1)` is already set (`app.ts:15`), so client IPs resolve correctly behind a proxy. Good.
- Add a per-user/IP cap on `/upload`.
- (Defense-in-depth) add `slowapi` on the Python service.

---

### 🟠 6. No tests, no CI/CD, no dependency scanning

**Where:** absent — no `*.test.ts` / `*.spec.*`, no `.github/workflows/`, no `npm audit` / `pip-audit` in any pipeline.

**Impact:** Security-critical paths (auth, ownership guards, validation) have zero regression protection. Vulnerable dependencies go unnoticed.

**Fix:** Add CI that runs build + `npm audit --audit-level=high` + `pip-audit`. Add smoke tests covering login, the role-escalation fix (#1), and the job ownership guard (#2).

---

### 🟡 7. OAuth access token passed in redirect URL

**Where:** `backend/src/modules/auth/auth.controller.ts:135`

```ts
redirectUrl.searchParams.set('token', accessToken);
res.redirect(redirectUrl.toString());
```

**Impact:** The access token lands in browser history, `Referer` headers, and any proxy/CDN access logs. The frontend strips it after load, but the leak window already happened.

**Fix:** Deliver via a short-lived single-use exchange code (frontend swaps it for the token over POST), or use the URL fragment (`#token=`) which is not sent to servers, and clear it immediately.

---

### 🟡 8. Frontend sends no security headers

**Where:** `frontend/next.config.ts` (empty)

Note: `helmet()` IS enabled on the API (`backend/src/app.ts:16`) and by default sets HSTS, a baseline CSP, `X-Content-Type-Options`, and frameguard — but that only covers API responses. The Next.js app users actually load ships **no** security headers.

**Impact:** No clickjacking protection, no CSP, no HSTS on the pages users render → larger XSS/clickjacking surface.

**Fix:** Add a `headers()` block in `next.config.ts` setting `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Content-Type-Options: nosniff`.

---

### 🟡 9. SSRF in image fetch (defense-in-depth)

**Where:** `py_backend/app/services/image_io.py:11`

```py
resp = await client.get(image_url)
```

No scheme or host validation — a crafted `image_url` could target `file://`, `http://169.254.169.254` (cloud metadata), or internal hosts. Risk is bounded because the service is internal-only and URLs normally originate from Cloudinary.

**Fix:** Allowlist `https` scheme + the Cloudinary host; reject private/link-local/loopback IP ranges; keep redirect-following disabled (httpx default is off — keep it).

---

### 🟡 10. Python service has no authentication

**Where:** `py_backend/app/main.py` — `/detect`, `/crop`, `/name`, `/check-transparency` are all open.

**Impact:** Any caller able to reach port 8000 can run detection/crop and drive Gemini/Cloudinary costs. Internal-only network placement mitigates this today.

**Fix:** Keep port 8000 off the public internet (private network / firewall). Add a shared-secret header check between the Node backend and the Python service so only the backend can call it.

---

### 🟡 11. Sensitive / unstructured logging

**Where:** `backend/src/modules/auth/auth.service.ts:42,143,187,303-304`, `auth.controller.ts:137,140`, `py_backend/app/main.py:21`

Raw errors and OAuth detail strings are written to stdout; there is no logging framework, redaction, or audit trail.

**Fix:** Adopt a structured logger (pino/winston on Node; `logging` on Python). Redact tokens/PII. Drop the OAuth `detail` from `auth.service.ts:303-305`. Add audit log entries for auth events.

---

### 🟡 12. Email verification accepts a raw (unhashed) token

**Where:** `backend/src/modules/auth/auth.service.ts:155-159`

```ts
// Check both hashed and raw (for flexibility during development)
let user = await UserModel.findOne({ verificationToken: hashedInput })...
if (!user) {
  user = await UserModel.findOne({ verificationToken: trimmedToken })...
}
```

**Impact:** The raw-token fallback defeats the point of storing only the hash — anyone who reads the DB could verify accounts directly.

**Fix:** Remove the raw fallback; match the hashed token only.

---

### 🟡 13. Server secrets live in the frontend env file

**Where:** `frontend/.env.local` — contains `MONGO_URI`, `REDIS_URL`, `CLOUDINARY_API_SECRET`.

These have no `NEXT_PUBLIC_` prefix, so Next.js will **not** bundle them into the browser — but server-side DB/Cloudinary secrets do not belong in the frontend project at all.

**Fix:** Keep only `NEXT_PUBLIC_API_URL` (and other genuinely public vars) in the frontend. Move all server secrets to the backend env.

---

### ⚪ 14. Refresh endpoint has no CSRF defense

`POST /api/auth/refresh-token` (`auth.controller.ts:39-47`) relies solely on the httpOnly cookie. `sameSite=lax` gives partial CSRF cover. Consider CSRF tokens (or `sameSite=strict`) on state-changing routes.

### ⚪ 15. No explicit HTTPS enforcement

No HTTPS-redirect middleware and no app-level HSTS beyond helmet's. Acceptable if TLS is terminated at a proxy/host — document that assumption and confirm `NODE_ENV=production` is set so the `secure` cookie flag (`auth.controller.ts:10`) activates.

### ⚪ 16. No JSON body size cap

`app.use(express.json())` (`backend/src/app.ts:21`) has no `limit`. Add `express.json({ limit: '100kb' })` to bound JSON payloads (Multer already caps uploads at 20 MB).

### ⚪ 17. `ioredis` version drift

`backend/package.json` declares `^5.4.2` but a pnpm override resolves to `5.11.0`. Reconcile to avoid surprise drift.

---

## 5. Pre-Production Checklist (priority order)

1. 🔴 **Rotate** all Cloudinary + Gemini keys; set strong prod JWT secrets (#4).
2. 🔴 **Remove `role` from registration**; hardcode `'user'` (#1).
3. 🔴 **Add job ownership guard** to job/crop/finalize routes (#2).
4. 🔴 **Generic 500 body** in the Python exception handler (#3).
5. 🟠 **Rate limiting** on auth + upload (#5).
6. 🟡 **Frontend security headers** in `next.config.ts` (#8).
7. 🟡 **Structured logging** + drop sensitive log lines (#11).
8. 🟡 **SSRF allowlist** + **shared-secret auth** on Python service; keep port 8000 private (#9, #10).
9. 🟠 **CI** with build + `npm audit` / `pip-audit` (#6).
10. 🟠 **Tests** for auth, role fix, and ownership guard (#6).
11. 🟡 Move server secrets out of frontend env (#13); remove raw-token fallback (#12); OAuth token off the URL (#7).

---

## 6. Hardening Recommendations

- **MongoDB / Redis:** enable auth, bind to private network, never expose 27017/6379 publicly. Redis already TTLs job state at 24h — good.
- **Backups & retention:** define backup/restore for MongoDB; document the 24h Redis job-expiry behavior to users.
- **Monitoring:** error tracking (Sentry) + uptime/health checks on all three services (`/health` exists on Node and Python).
- **Dependencies:** schedule recurring `npm audit` / `pip-audit`; enable Dependabot.
- **Deploy:** containerize the Node backend and frontend (only `py_backend` is in `docker-compose.yml` today); enforce `NODE_ENV=production`.

---

## 7. What's Already Done Well

- **Password hashing:** bcrypt with cost 12, pre-save hook (`auth.model.ts:39-48`).
- **Input validation:** Zod schemas on auth routes; strong password policy.
- **Cookies:** refresh token is `httpOnly`, `secure` in prod, `sameSite=lax` (`auth.controller.ts:8-14`).
- **Tokens:** reset and refresh tokens stored hashed (SHA-256), with expiry on reset.
- **Uploads:** Multer enforces mime (`image/*`) + 20 MB; Cloudinary re-validates format and dimensions.
- **No SQL injection:** Mongoose ODM, no raw queries; no shell/`eval` sinks found.
- **CORS:** scoped to `FRONTEND_URL`, not wildcard, with credentials (`app.ts:17-20`).
- **API headers:** `helmet()` enabled (`app.ts:16`).

---

*End of audit. No source files were modified. Re-run after fixes to confirm closure.*
