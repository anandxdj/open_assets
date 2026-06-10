# F7 — Testing & CI Hardening

> **Theme B · Make the foundation real.** Collections, auth, and workers have
> zero test coverage; CI skips frontend `build`/`lint` and all py tests. Before
> the codebase grows (F1, F5 add a lot of surface), build the safety net so
> regressions can't ship silently.
>
> **Priority:** P2 (but front-load alongside M1 feature work) · **Effort:** L · **Depends on:** FX-02 (auth) ideally fixed first so auth tests assert correct behavior; otherwise independent.

---

## 1. Problem

The test suite is narrow and CI is permissive. From the audit:

**What's covered (backend `src/__tests__/`):**
- Cost table for all op/model combos (`usage.test.ts`).
- consume/refund Zod schema validation.
- Atomic-deduct race (gated on `MONGO_URI`).
- `assertOwner` IDOR guard (4 cases).
- `registerSchema` role-stripping + weak-password rejection (`security.test.ts`).

**What's NOT covered (the dangerous gaps):**
- **Collections:** zero tests. No coverage of the ZIP download output (the feature spec §8.1 explicitly asked for a "valid structured zip" test), like idempotency, Cloudinary-deletion-on-delete, private/draft 403 enforcement, or the missing Gemini-tagging path.
- **Auth:** no tests for refresh flow, Google callback, verify/reset, or the cookie-name bug (FX-02) — a test would have caught it.
- **Workers:** no tests for detection/crop/finalize failure→`status:'failed'` transitions.
- The dead `GET /jobs/:id/download` route (FX-05) is untested (would fail if tested).
- `consume`/`refund` 402 path, refund-of-unknown-event, double-refund have no assertions.

**CI gaps (`.github/workflows/ci.yml`):**
- **frontend:** only `tsc --noEmit` + audit — **no `next build`, no `lint`**. `frontend/AGENTS.md` warns this is a non-standard Next.js where a broken build is plausible; CI won't catch it.
- **py_backend:** only `compileall` + `pip-audit` — **no tests, no lint/type check** (no pytest exists).
- **extension:** not covered at all (no manifest/JSON lint).

So: the most business-critical, most-edited modules (collections, auth, the
extraction pipeline) are the least tested, and CI green doesn't mean "it builds."

---

## 2. Goals / non-goals

**Goals**
- Integration tests for the collections authz + ZIP + lifecycle paths.
- Auth flow tests (register/login/refresh/verify/reset + the FX-02 cookie contract).
- Worker failure-transition tests.
- Fill the usage 402/refund-edge gaps.
- CI that runs frontend `build` + `lint`, py lint + a smoke test, and manifest JSON lint.
- A test DB story (ephemeral Mongo + Redis) so the `MONGO_URI`-gated tests actually run in CI.

**Non-goals**
- Not 100% coverage chasing. Target the high-risk, high-churn paths.
- Not E2E browser automation in v1 (the `verify`/`ce-test-browser` skills cover manual/ad-hoc; a Playwright suite is a later add).
- Not load/perf testing.

---

## 3. Current state

| Surface | Test runner | Coverage | CI |
|---|---|---|---|
| backend | Node test runner over `src/__tests__` | usage cost/schema/race, authz guard, register schema | typecheck + test + audit ✅ |
| frontend | none | none | tsc + audit only ⚠️ |
| py_backend | none | none | compileall + pip-audit only ⚠️ |
| extension | none | none | none ❌ |

The race test (`usage.test.ts`) already shows the pattern for DB-backed tests — it
just needs `MONGO_URI` available in CI to run instead of skip.

---

## 4. Design

### 4.1 Test infrastructure
- **Ephemeral datastores in CI:** add Mongo + Redis service containers to the backend CI job (GitHub Actions `services:`), set `MONGO_URI`/`REDIS_URL` so the gated tests (race, and new collections/auth tests) actually run. Locally, point at the dev compose (FX-04).
- **Test helpers:** a `tests/helpers/` with DB connect/teardown, a user factory (issuing a real JWT via `jwt.utils`), and a fake storage adapter (in-memory) so collection tests don't hit Cloudinary/ImageKit.
- **Mock py_backend / Gemini / OpenRouter** at the HTTP boundary for worker and studio-route tests (mirror the existing `OPENROUTER_MOCK` philosophy).

### 4.2 Backend test targets (priority order)
1. **Collections authz + lifecycle** (highest risk):
   - private/draft → 403 to non-owner on get/download; public → 200.
   - create → folder → addImages (multipart, with fake storage) → get tree shape.
   - delete cascades to folders/images and calls `storage.delete` (assert via fake adapter).
   - whole-collection ZIP = nested-by-folder; per-folder ZIP = flat; both valid archives with expected entries (the spec's "valid structured zip" test).
   - like idempotency: same user twice → count +1; `likedByMe` reflects state.
2. **Auth flows:** register (role stripped), login (verified-email gate), refresh (valid/expired/tampered), verify/reset (expiry + hashed-token match), and the **FX-02 cookie contract** (refresh cookie alone does/doesn't authenticate per the chosen fix).
3. **Workers:** each worker's failure path writes `status:'failed'` + `error`; crop naming-failure degrades gracefully; finalize skip-upscale vs upscale branches.
4. **Usage edges:** 402 on insufficient credits, refund of unknown event (no-op), double-refund idempotency.

### 4.3 Frontend CI
- Add `pnpm lint` (studio files must be clean; repo-wide has known failures — scope or fix-forward; decide a baseline) and **`pnpm build`** to the frontend job. A failing `next build` must fail CI (the AGENTS.md warning makes this non-optional).
- Optional: a tiny set of component/unit tests for the api-client refresh logic and `studioClient` error mapping (pure logic, no browser).

### 4.4 py_backend CI
- Add `ruff` (lint) + `mypy` (types, best-effort) and a minimal `pytest` smoke: detection threshold math, `image_io` SSRF rejections (private IP, non-allowlisted host, oversize), Gemini empty-key fallback returns identity names. Add `pytest`/`ruff` to `requirements-dev.txt`.

### 4.5 Extension CI
- JSON-lint `manifest.json`; optionally `web-ext lint` for MV3 validation. Cheap guardrail against a malformed manifest shipping.

---

## 5. Phased tasks

**Phase 1 — Infra + highest-risk backend tests** *(M)*
1. CI Mongo+Redis services; test helpers + fake storage adapter.
2. Collections authz/ZIP/lifecycle/like tests.
3. Usage 402/refund-edge tests.

**Phase 2 — Auth + workers** *(M)*
4. Auth flow tests (incl. FX-02 contract).
5. Worker failure-transition tests with mocked py_backend.

**Phase 3 — Frontend + py + extension CI** *(M)*
6. Frontend `build` + `lint` in CI.
7. py `ruff`/`mypy` + pytest smoke.
8. Manifest JSON lint.

## 6. Risks & mitigations

- **Flaky DB tests in CI.** → Service containers with health checks; unique DB name per run; teardown in `afterEach`.
- **Repo-wide frontend lint already failing.** → Establish a baseline (lint only changed/studio files, or fix the existing failures once) so the gate is enforceable, not perpetually red. Document the policy.
- **Slow CI.** → Run service-backed tests in their own job; cache pnpm/pip; parallelize frontend/backend/py jobs.
- **Tests coupling to implementation.** → Assert behavior (response shapes, status transitions, archive contents), not internals; avoid brittle snapshotting.

## 7. Verification

- CI on a PR runs: backend typecheck+tests (with DB), frontend tsc+lint+**build**, py compileall+ruff+pytest, manifest lint — all green required to merge.
- Deliberately breaking each guarded behavior (e.g. revert FX-02, break a collection authz check, introduce a `next build` error) makes the corresponding CI step fail.
- The previously-skipped race test now runs (not skips) in CI.

## 8. Definition of done

The high-risk modules (collections, auth, workers) have integration coverage that
would catch the bugs in this very backlog; CI green genuinely means "type-checks,
lints, builds, and the core flows pass" across all four surfaces; DB-backed tests
run in CI instead of skipping.
