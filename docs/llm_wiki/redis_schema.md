# Redis Schema

All job state lives in Redis hashes. No SQL. TTL = 24h on all job keys.

## Key Patterns

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `job:<uuid>` | Hash | 86400s | Full job state: detection → crop → finalize |

## Job Hash — `job:<uuid>`

| Field | Type | Set When |
|---|---|---|
| `status` | string | every transition (see state machine) |
| `cloudinaryUrl` | string | upload |
| `publicId` | string | upload |
| `workingUrl` | string | after BG removal (or same as cloudinaryUrl if already transparent) |
| `isTransparent` | string | `'true'` \| `'false'` — after transparency check |
| `imageWidth` | string | after detection |
| `imageHeight` | string | after detection |
| `boxes` | string | `JSON.stringify(BoundingBox[])` — after detection; updated by crop controller |
| `nameMap` | string | `JSON.stringify(Record<string,string>)` — systematic id → Gemini name |
| `assets` | string | `JSON.stringify(Asset[])` — after crop, each has cropped_url |
| `selectedIds` | string | `JSON.stringify(string[])` — set by finalize controller |
| `skipUpscale` | string | `'true'` \| `'false'` — set by finalize controller |
| `downloadUrl` | string | after finalize — Cloudinary raw zip URL |
| `error` | string | when status=failed |
| `userId` | string | upload |
| `createdAt` | string | upload |

### BoundingBox shape (inside `boxes` JSON)
```typescript
{
  id: string        // uuid
  x: number
  y: number
  width: number
  height: number
  label?: string    // Gemini-assigned name (set after naming step)
  croppedUrl?: string
}
```

### Asset shape (inside `assets` JSON)
```typescript
{
  id: string
  name: string       // Gemini-assigned filename
  cropped_url: string
  public_id: string
}
```

## Job Store API (`src/modules/jobs/job.store.ts`)

```typescript
createJob(jobId: string, data: CreateJobInput): Promise<void>
updateJob(jobId: string, patch: Partial<JobHash>): Promise<void>
getJob(jobId: string): Promise<JobHash | null>
parseBoxes(raw: string): BoundingBox[]
parseAssets(raw: string): Asset[]
```

All write operations refresh the TTL via `redis.expire(key, 86400)`.

## State Machine

```
uploaded → queued → detecting → removing_bg → detected
                                    ↓ (if already transparent, skip removing_bg)
                                 detected → naming → cropping → cropped
                                                                   ↓
                                                               finalizing → ready
(any step → failed)
```

| Status | Set By | Meaning |
|---|---|---|
| `uploaded` | upload.controller | Cloudinary upload done, job created |
| `queued` | upload.controller | Added to detectionQueue |
| `detecting` | detection.worker | Worker started |
| `removing_bg` | detection.worker | Cloudinary BG removal in progress |
| `detected` | detection.worker | Boxes stored, ready for canvas editing |
| `naming` | crop.worker | Gemini naming in progress |
| `cropping` | crop.worker | Cropping assets via py_backend |
| `cropped` | crop.worker | All assets cropped and uploaded |
| `finalizing` | finalize.worker | Building ZIP |
| `ready` | finalize.worker | ZIP uploaded, downloadUrl set |
| `failed` | any worker | Error stored in `error` field |

## Redis Client (`src/common/config/redis.ts`)

```typescript
import { Redis } from 'ioredis'
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')
```

Same client instance used by both BullMQ and job.store.ts.
