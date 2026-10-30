# Plans and entitlements

What each plan can do lives in **one table**, enforced on the server and mirrored
on the frontend. Pro is granted by hand for now (no payments); a billing webhook
can set the plan later through the same function.

| | Free | Pro |
|---|---|---|
| Sheets per month (UTC calendar month) | 5 | unlimited |
| Export upscale | up to 2× | up to 4× |
| Padding and threshold controls (editor) | no | yes |
| Custom naming patterns | no | yes |
| API keys | 0 | 5 |
| Team sharing | no | yes |

Pro is $19 a month (`frontend/src/components/marketing/pricing.ts`). Every
feature on the pricing page is read from the table, so the page cannot promise
something the server does not enforce.

## The single source of truth

`backend/src/modules/plans/entitlements.json` holds the table, the trial length
(14 days) and the detection control ranges. `frontend/src/lib/plans/entitlements.json`
is a byte-for-byte copy; a backend test fails if the two differ. Change both
together.

## Plan model

On the user (`auth.model.ts`): `plan` (`free | byok | pro`), `planSource`
(`admin | trial | billing`), `planUpdatedAt`, `trialEndsAt`, `trialStartedAt`.

- `trialEndsAt` is the end of any time-limited Pro period, a trial or an admin
  grant with `--days`. No end date means Pro until someone changes it.
- The **effective plan** is what counts: `pro` whose `trialEndsAt` has passed is
  `free`. `byok` (Studio AI keys) counts as `free` for entitlements. Nothing
  rewrites the stored plan when a trial ends, so never gate on `user.plan`.
- `trialStartedAt` is set once by the trial and kept, so a used trial stays used.

## Backend helpers (`backend/src/modules/plans`)

| Helper | Use |
|---|---|
| `getEffectivePlan(user)` | `'free' \| 'pro'` right now |
| `getEntitlements(user)` | the table row for that plan |
| `hasEntitlement(user, key)` / `assertEntitled(user, key)` | boolean / throws 403 `PLAN_REQUIRED` |
| `requireEntitlement(key)` | Express middleware after `authenticate()` |
| `assertWithinLimit(user, key, requested)` | throws 403 `PLAN_LIMIT` when `requested` is above the limit (`requested` is the value after the action, e.g. existing keys + 1) |
| `enforceSheetLimit` | upload middleware: takes a sheet from the month before anything is stored, or 403 `SHEET_LIMIT` |
| `setUserPlan(userId, { plan, source, endsAt })` | the one way to change a plan (admin, billing webhook) |
| `resolveDetectionTuning(user, body)` | validates and gates `threshold` and `padding` |

`req.user` (from `authenticate()`) carries `plan` and `trialEndsAt`, so these
take `req.user` directly. Errors are `{ success: false, message, code, details }`
with `code` one of `PLAN_REQUIRED`, `PLAN_LIMIT`, `SHEET_LIMIT`; sheet-limit
errors include `details.resetAt`.

The sheet count is one MongoDB row per user per month (`SheetUsage`, unique on
`userId + period`). The check and the increment are a single conditional update,
so concurrent uploads cannot exceed the limit. The slot is given back if the
upload fails before a job exists.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/api/plans/me` | effective plan, entitlements, sheets used/limit/reset date, trial status |
| POST | `/api/plans/trial` | start the 14-day Pro trial, once per account (409 `TRIAL_USED` / `ALREADY_PRO`) |
| GET | `/api/admin/users?q=` | admin only: search users by email or name |
| PUT | `/api/admin/users/:id/plan` | admin only: `{ plan: 'free' \| 'pro', days? }` |

Gates on existing routes:
- `POST /api/finalize` takes `scale` (2 or 4; 4 needs Pro, else 403 `PLAN_LIMIT`).
- `POST /api/enhance/ai` takes `scale` 2 or 4 the same way (4 needs Pro); `GET /api/enhance/capabilities`
  reports the plan's `operations.upscale.maxScale`.
- `POST /api/finalize`, `POST /api/jobs/:id/export-names` and saving to a collection take `namingPattern`;
  anything but the default pattern needs Pro (403 `PLAN_REQUIRED`). `PUT /api/preferences/export` saves the
  default pattern the same way. See `docs/naming-patterns.md`.
- `POST /api/jobs/:id/redetect` takes `threshold` (1 to 100, default 50) and `padding` (0 to 64 px,
  default 0); free accounts may only send the defaults (else 403 `PLAN_REQUIRED`).

Upscale factors: the storage providers' AI upscale is a fixed 4x. The extract export (`finalize`)
resizes to exactly `scale` times the cropped width (2x is the 4x result scaled down), and AI enhance
does the same from the source width (`applyEnhance`).

Account deletion (`account.service.deleteAccount`) also removes the user's monthly sheet counters,
their Redis history index and job records, and their AI enhance jobs, deleting the stored originals,
crops and enhance sources best-effort (`account.purge.ts`). A Redis or storage failure never blocks it.

## API keys and the public API

`apiKeys` (Pro: 5) gates `backend/src/modules/apikeys` (`/api/api-keys`, session only) and
`/api/v1` (`modules/publicapi`, API key only).

- Creating a key: `assertEntitled(user, 'apiKeys')` (403 `PLAN_REQUIRED` on Free), then
  `assertWithinLimit(user, 'apiKeys', activeKeys + 1)` (403 `PLAN_LIMIT`). Listing and revoking work on
  any plan.
- `/api/v1` authenticates the key, loads its owner and calls `assertEntitled(user, 'apiKeys')` on every
  request, so when a Pro period ends the keys stay listed but answer 403 `PLAN_REQUIRED`.
- Uploads, crops and exports go through the web app's own controllers, so the sheet counter, the
  `maxUpscale` gate and the naming-pattern gate apply unchanged.
- Account deletion deletes the user's keys.

## Frontend

- `@/lib/plans`: the table, types (`PlanStatus`, `Entitlements`), `FREE_SHEETS_PER_MONTH`.
- `usePlan()` (`features/plans/PlanContext`): `{ plan, loading, refresh, startTrial, starting }`.
- `useEntitlement(key)`: `{ value, allowed, ready }`. While `ready` is false show a neutral state, not a lock.
- `<UpgradeAction />`: at a Pro gate, "Start 14-day trial" if eligible, otherwise "Contact us to upgrade" (mailto, subject only).
- `<ProBadge />`, `<TrialBadge />` (sidebar), `<UsageMeter />` (upload page), and the Settings plan
  section (`features/settings/components/PlanOverview.tsx`): the effective plan, what it includes, sheets
  used and the reset date, and the trial state. Never show the raw `user.plan`.
- `ApiRequestError` (`@/lib/api-error`) keeps `code` and `details` from API failures.

## Granting Pro (admin)

Make yourself an admin, then set plans:

```bash
pnpm --dir backend admin:grant you@example.com           # make an existing user an admin
pnpm --dir backend plan:set user@example.com pro         # Pro until changed
pnpm --dir backend plan:set user@example.com pro --days 30   # Pro for 30 days, then free again
pnpm --dir backend plan:set user@example.com free        # back to free
```

Admins also get an **Admin** entry in the account menu that opens `/admin`: search
users by email or name and set their plan. Both the page and the API check the
`admin` role; the scripts need the same `.env` as the backend.

## Trial flow

"Start 14-day trial" on the pricing page: signed in, it starts the trial in place;
signed out, it goes to `/register?next=/pricing?trial=1`, carries `next` through
sign-in, and starts the trial when the visitor lands back on `/pricing?trial=1`.
It only starts on its own if this browser remembers the click (so a plain link
cannot spend someone's one trial). Once the trial is used the CTA offers
"Contact us to upgrade".

## Tests

`pnpm --dir backend test` runs the plan tests. The MongoDB and route tests need
`MONGO_URI` and `REDIS_URL` (loaded from `backend/.env`); without them they are
skipped. They use the database `<MONGO_DB_NAME>_test` and Redis DB 15.
