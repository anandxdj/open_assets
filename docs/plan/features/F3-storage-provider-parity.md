# F3 — Storage-Provider Parity

> **Theme B · Make the foundation real.** The README sells a pluggable storage
> layer ("set `STORAGE_PROVIDER`, the rest never knows"). That's true at the Node
> layer and false below it. This feature makes it true end-to-end.
>
> **Priority:** P0 (it carries FX-01) · **Effort:** L · **Blocks:** F1 Phase 3 (upscale-before-save), anything that uploads via py_backend on ImageKit.

---

## 1. Problem

`STORAGE_PROVIDER=imagekit` is documented (README.md:293-298) and the Node layer
honors it (`backend/src/lib/storage/index.ts:7-13` selects the adapter; both
adapters fully implement the interface). **But py_backend ignores it entirely:**

1. **Host allowlist is Cloudinary-only.** `py_backend/app/core/config.py:15` —
   `ALLOWED_IMAGE_HOSTS` defaults to `res.cloudinary.com,cloudinary.com`.
   `image_io.py:32-34` rejects any other host. On ImageKit, the Node workers pass
   `ik.imagekit.io` / custom-endpoint URLs to `/check-transparency`, `/detect`,
   `/name-assets`, `/crop` → **every call 422s** ("Image host is not in the
   allowlist"). The pipeline dies on the first step.

2. **Crop uploads hardcode Cloudinary.** `py_backend/app/services/cloudinary_client.py:6-22`
   uploads crops straight to Cloudinary regardless of provider. Even past the
   allowlist, crops land in Cloudinary while the rest of the app reads ImageKit —
   split-brain storage — and Cloudinary creds may be unset → 502.

3. **Inconsistent transform-failure semantics (FX-10).** At the Node layer,
   `cloudinary.adapter.ts:77-114` `pollUntilReady` throws on a failed
   transform; `imagekit.adapter.ts:84-90` `warmup` swallows errors and returns
   the URL unconditionally. So bg-removal/upscale failures are loud on Cloudinary
   and silent on ImageKit (the worker proceeds with a possibly-404 URL).

Net: the storage abstraction is a lie below Node, and the two adapters don't even
agree on what failure means.

---

## 2. Goals / non-goals

**Goals**
- `STORAGE_PROVIDER=imagekit` runs the full extraction pipeline end-to-end with no manual host-allowlist surgery.
- py_backend uploads crops to **whichever provider the deployment chose**, never a hardcoded one.
- Both adapters (Node) agree on transform-failure semantics: a failed bg-removal/upscale **throws**, so the worker fails the job loudly instead of producing a dead URL.
- Provider choice is unambiguous across the Node↔py boundary (no relying on two services independently reading the same env and hoping they match).

**Non-goals**
- Not adding a third provider (S3, etc.) — though the abstraction should make it possible later.
- Not migrating existing Cloudinary deployments (no data move).

---

## 3. Current state

| Layer | Provider awareness | State |
|---|---|---|
| Node `storage/index.ts` | Selects adapter by `STORAGE_PROVIDER` | ✅ correct |
| Node `cloudinary.adapter.ts` | full interface, throws on transform fail | ✅ |
| Node `imagekit.adapter.ts` | full interface, **swallows** transform fail | ⚠️ FX-10 |
| py `image_io.py` allowlist | Cloudinary hosts only | ❌ FX-01 |
| py `cloudinary_client.py` upload | Cloudinary hardcoded | ❌ FX-01 |
| Env examples | `STORAGE_PROVIDER`/`IMAGEKIT_*` missing from `backend/.env.example` | ❌ FX-09 |

---

## 4. Design

### 4.1 Make py_backend provider-aware

Introduce a small storage abstraction in py_backend mirroring the Node one:

```
py_backend/app/services/storage/
  __init__.py        get_storage_client()  -> selects by STORAGE_PROVIDER
  base.py            class StorageClient(Protocol): upload_bytes(...) -> {url, public_id}
  cloudinary.py      existing cloudinary_client logic, moved here
  imagekit.py        NEW: ImageKit upload via their REST API / SDK
```

`config.py` gains `STORAGE_PROVIDER` (default `cloudinary`) and the ImageKit creds
(`IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`). The crop router calls
`get_storage_client().upload_bytes(...)` instead of the Cloudinary module directly.

### 4.2 Provider-derived allowlist

Two sub-fixes:
- **Default `ALLOWED_IMAGE_HOSTS` from the provider.** If unset, derive it: Cloudinary → `res.cloudinary.com,cloudinary.com`; ImageKit → host of `IMAGEKIT_URL_ENDPOINT` + `ik.imagekit.io`. Keep the explicit override for custom domains/CDNs.
- Keep the SSRF defenses intact (https-only, private-IP/metadata blocking, dimension caps in `image_io.py`) — only the *host list* becomes provider-aware, not the safety checks.

### 4.3 Unambiguous provider across the boundary (recommended)

Don't rely on two services independently reading `STORAGE_PROVIDER` and matching.
Have the **Node backend send the provider (and the target upload params) in the
request body** to py_backend's `/crop` (and any upload-causing route). py_backend
uploads using exactly what Node told it. This makes a mismatch impossible and lets
Node remain the single source of truth for storage config.

(Lower-effort alternative: just ensure both `.env` files set the same
`STORAGE_PROVIDER` and document it loudly. The body-param approach is more robust;
choose based on appetite.)

### 4.4 Fix ImageKit transform semantics (FX-10)

`imagekit.adapter.ts` `warmup` should verify the transformed asset is actually
ready/successful (HEAD/GET the transformed URL, or poll an equivalent of
Cloudinary's readiness check) and **throw** on failure, matching
`cloudinary.adapter.ts`. The worker's existing try/catch then fails the job with a
clear error instead of silently shipping a dead URL.

### 4.5 Env documentation (FX-09)

- `backend/.env.example`: add `STORAGE_PROVIDER`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`, `INTERNAL_API_TOKEN` with comments.
- `py_backend/.env.example`: add `STORAGE_PROVIDER`, the ImageKit creds, `INTERNAL_API_TOKEN`, `ALLOWED_IMAGE_HOSTS`; note the allowlist auto-derives when blank.
- Comment that `INTERNAL_API_TOKEN` (Node↔py) ≠ `INTERNAL_SERVICE_TOKEN` (studio refund).

---

## 5. Phased tasks

**Phase 1 — Allowlist unblock (fastest path to "ImageKit doesn't 422")** *(S)*
1. Provider-derived `ALLOWED_IMAGE_HOSTS` default in `config.py`.
2. Env example updates (FX-09).
3. Verify detect/name on an ImageKit-hosted URL no longer 422s.

**Phase 2 — Provider-aware uploads in py_backend** *(L)*
4. Add `app/services/storage/` abstraction + `imagekit.py` upload impl.
5. Move Cloudinary upload into the abstraction; select by provider (or by request body param per §4.3).
6. Crop router uses the abstraction.
7. Verify crops land in ImageKit when `STORAGE_PROVIDER=imagekit`.

**Phase 3 — Transform-failure parity (FX-10)** *(S)*
8. `imagekit.adapter.ts` `warmup` throws on transform failure.
9. Verify a forced ImageKit transform failure fails the job with a clear error (matches Cloudinary behavior).

## 6. Risks & mitigations

- **ImageKit API differences** (upload auth, response shape, transform readiness). → Build `imagekit.py` against their current REST docs; add a smoke test that round-trips an upload + delete.
- **Two services drifting** on provider config. → Prefer §4.3 (Node sends provider in body); if not, add a boot-time log in both services printing the active provider so mismatches are visible.
- **Regression for Cloudinary users.** → Cloudinary remains the default; Phase 2 must keep the existing Cloudinary path byte-for-byte. Cover with the existing pipeline + a Cloudinary smoke.
- **Allowlist over-broadening.** → Derive narrowly (only the active provider's hosts), keep SSRF checks; never widen to `*`.

## 7. Verification

- With `STORAGE_PROVIDER=cloudinary` (default): full pipeline unchanged, all existing behavior intact.
- With `STORAGE_PROVIDER=imagekit`: upload → detect → crop → assets stored on ImageKit → upscale/bg-removal succeed or fail loudly; no manual allowlist edit needed.
- Forced transform failure on ImageKit → job goes `failed` with a clear error (not a silent dead URL).
- `.env.example` copy → both providers configurable from comments alone.

## 8. Definition of done

A deployment can switch `STORAGE_PROVIDER` between `cloudinary` and `imagekit` and
the entire extraction pipeline (and studio upscale-before-save, F1 Phase 3) works
on either, with identical, loud failure semantics. The README's storage claim
becomes true. FX-01 and FX-10 close.
