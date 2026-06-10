# F2 — History & Job Persistence

> **Theme A · Close the loop.** Turn the stub History page into a real "my work"
> surface — which first requires the persistence layer it needs, because today
> jobs are unindexed and expire in 24h.
>
> **Priority:** P1 · **Effort:** L (backend persistence + frontend) · **Depends on:** FX-02 (auth) being correct so per-user filtering is safe.

---

## 1. Problem

`app/(dashboard)/history/page.tsx` is a literal placeholder ("History page —
coming soon", comment `// Phase 9+: replace with <HistoryScreen />`).
`features/history` does not exist. But the page is not just unbuilt — it's
**unbuildable with current persistence**:

- `backend/src/modules/jobs/job.routes.ts` exposes only `GET /jobs/:jobId` and `GET /jobs/:jobId/download`. **No list endpoint.**
- `job.store.ts:6` — jobs are stored only under `job:${jobId}` with `JOB_TTL = 86400` (24h). `userId` is inside the hash but **not indexed**. There is no `user:{id}:jobs` set.
- After 24h a job evaporates from Redis entirely.

So "show me my past extractions" has nothing to query. Finished *collections*
survive in Mongo, but raw editor jobs (the thing a History page is about) do not.

---

## 2. Goals / non-goals

**Goals**
- A per-user index of jobs that survives long enough to be useful.
- `GET /api/jobs` — paginated, ownership-filtered list of a user's jobs.
- A real History screen: list past jobs with thumbnail, status, asset count, created time, and actions (re-open editor if still live, re-download if export exists, or "expired").
- Be honest about expiry: clearly mark jobs whose underlying Redis data has aged out.

**Non-goals**
- Not turning every job into permanent storage of all crops (expensive). We index metadata; heavy artifacts can still expire.
- Not building analytics dashboards (separate effort).
- Not history for studio generations (those don't create backend jobs; studio history would be local/F1-collections-based).

---

## 3. Current state

| Piece | Where | State |
|---|---|---|
| Job hash | `job.store.ts` | `job:${id}` hash, 24h TTL, `userId` field present but unindexed. |
| Job read | `job.routes.ts` | `GET /jobs/:jobId` works; `GET /jobs/:jobId/download` is dead (FX-05). |
| Job creation | `upload.controller.ts` | Creates the hash on upload; knows `userId`. |
| Frontend | `history/page.tsx` | Stub. `useJobPolling` exists for single-job reads. |
| Collections (durable) | Mongo | Finished, published work lives here permanently — complementary to job history. |

---

## 4. Design

### 4.1 Persistence — two options

**Option A (recommended): Mongo `Job` summary collection.**
On job creation and on each terminal status transition, upsert a lightweight
summary doc:

```ts
interface IJobSummary {
  jobId: string;            // matches the Redis job id
  user: ObjectId;           // indexed
  status: JobStatus;        // last known
  originalImageUrl: string; // for thumbnail
  assetCount: number;
  thumbnailUrl?: string;    // first crop or a collage
  collectionId?: ObjectId;  // if scaffolded to a collection
  redisExpired: boolean;    // set true by a sweep once the Redis hash is gone
  createdAt: Date;
  updatedAt: Date;
}
// index: { user: 1, createdAt: -1 }
```

- Pros: survives past 24h, queryable, sortable, paginatable, joins to collections. Re-uses the DB we already run.
- Cons: a second write path; must keep status in sync (write on terminal transitions, not every poll).

**Option B: Redis per-user sorted set.**
`ZADD user:{id}:jobs <createdAtScore> <jobId>`; list = `ZREVRANGE`. Give the set a
longer TTL than the job hash. Simpler, but you lose the metadata once the job hash
expires (you'd have an id with nothing behind it), and Redis isn't where you want
durable user data. **Use only if you explicitly want history capped at the job TTL.**

→ Go with **Option A**. It matches the existing "Redis for ephemeral jobs, Mongo
for durable user data" design decision stated in the README.

### 4.2 Write points

- `upload.controller.ts` — create the `JobSummary` (`status: queued`) right after the Redis hash.
- Workers (`detection/crop/finalize.worker.ts`) — on terminal/meaningful transitions (`detected`, `cropped`, `ready`, `failed`), patch the summary's `status`, `assetCount`, `thumbnailUrl`. Keep it to a handful of writes, not per-poll.
- A small periodic sweep (or lazy-on-read check) sets `redisExpired: true` when `job:${id}` no longer exists.

### 4.3 API

```
GET /api/jobs?cursor=&limit=20&status=        (auth required)
  → { jobs: JobSummaryDTO[], nextCursor }
  filtered to req.user._id, sorted createdAt desc.
```

Reuse the cursor/pagination style from `GET /api/collections`. Ownership filter is
mandatory (test it — see F7).

### 4.4 Frontend

- `features/history/components/HistoryScreen.tsx` + `features/history/api.ts` (`listJobs`).
- Card grid: thumbnail, status pill (reuse studio/editor status styling), asset count, relative time.
- Actions by state:
  - live (`detected`/`cropped`/`ready` and not expired) → "Open in editor" (`/editor/:jobId`).
  - `ready` + has export → "Download" (depends on FX-05 decision — if server download is revived, link it; else re-open editor to client-zip).
  - `failed` → show error, "Retry" (re-upload original).
  - `redisExpired` → greyed, "Expired — re-upload to extract again", link to the source collection if scaffolded.
- Wire the Navbar/dashboard link (FX-19) once this ships.

---

## 5. Phased tasks

**Phase 1 — Persistence** *(M)*
1. `JobSummary` model + indexes.
2. Write on create (`upload.controller.ts`) + terminal transitions (3 workers).
3. Expiry reconciliation (lazy check on read is simplest).

**Phase 2 — API** *(S)*
4. `GET /api/jobs` paginated, ownership-filtered.
5. Integration test for ownership + pagination (F7 overlap).

**Phase 3 — Frontend** *(M)*
6. `HistoryScreen` + `api.ts`.
7. Per-state actions; expired handling.
8. Navbar/dashboard link + `/dashboard` index fix (FX-19).

## 6. Risks & mitigations

- **Status drift** between Redis and the summary. → Write summary only on meaningful transitions; treat Redis as source of truth when both exist, summary as fallback when Redis is gone.
- **Thumbnail cost** — generating collages is work. → Use the first crop URL or the original (downscaled by the CDN) as the thumbnail; skip bespoke collage in v1.
- **Privacy** — never leak another user's jobs. → Ownership filter enforced server-side + a test (F7). Mirror the `assertOwner` pattern used in collections.
- **FX-05 coupling** — the "Download" action depends on whether the server download route is revived or removed. → Resolve FX-05 first or branch the UI on "client-zip only."

## 7. Verification

- Upload 3 images as user A, 2 as user B → `GET /api/jobs` returns only the caller's, newest first, paginated.
- A job past 24h shows `redisExpired` and the expired UI; a scaffolded one links to its collection.
- Failed job surfaces its error and a retry.
- Ownership test: user B cannot see user A's jobs by any param.

## 8. Definition of done

A signed-in user sees a real, paginated list of their past extractions with
correct status and the right action per state; the data survives past the 24h
Redis TTL via the Mongo summary; the History route is reachable from nav and no
longer a stub.
