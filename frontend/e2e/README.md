# End-to-end: visual regression and accessibility

Playwright drives the real web app against the real API with seeded data. Unit tests for logic that needs no browser (the upload state machine) run with `pnpm test` in `frontend/`.

- `visual.spec.ts`: viewport screenshots of each key route, light and dark, at 1280 and 375 wide, plus a few plan-state screens.
- `a11y.spec.ts`: axe (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) on the same routes and on the other plan states. Serious and critical violations fail; no rule is disabled.
- `keyboard.spec.ts`: keyboard-only walkthroughs (skip link, the editor's keyboard equivalents of move, resize, add, duplicate, zoom and delete, the shortcuts dialog, and cancelling an upload). Behaviour only, no screenshots.
- `routes.ts`: the route table (path, who is signed in). `auth.setup.ts` signs each seeded account in through `POST /api/auth/login` and stores the session cookie, so tests start signed in.

## Run it

Needs MongoDB and Redis, a backend and a frontend that share a `STORAGE_PROVIDER=local` setup (see the root README, "Run locally"), a seeded database, and a **production build** of the frontend (no dev overlay, no hot reload).

The seeded accounts' password is not stored in the repo. Choose one per shell, once, before seeding and running; it needs 8+ characters with an uppercase letter and a digit (the app's password rules), and the seed and the tests must see the same value. Without it both stop right away with a message.

```bash
export E2E_PASSWORD="E2e-$(openssl rand -hex 12)"
pnpm --dir backend e2e:seed                  # idempotent; run it before every run
pnpm --dir frontend build && pnpm --dir frontend start -p 3105
pnpm --dir backend start                     # port from backend/.env

# compare against the committed baselines, in the CI image
frontend/e2e/docker.sh test
# after an intended UI change: rewrite the baselines (and look at the diff in git)
frontend/e2e/docker.sh test --update-snapshots
```

Defaults point at `http://oa-ui5.localhost:3105` (web) and `:4105` (API); override with `E2E_BASE_URL`, `E2E_API_URL`, `E2E_HOST` (the host name mapped to 127.0.0.1 inside the container). `NEXT_PUBLIC_API_URL` is baked into the build, so build with the API URL the tests use. `pnpm e2e` runs Playwright directly and is for accessibility runs and debugging only: **do not update baselines that way**, a developer machine renders text differently from CI.

## Rules for baselines

- They are rendered only in `mcr.microsoft.com/playwright:v<version>-noble`, the image `ci.yml` uses. Bump the tag, `package.json` and `docker.sh` together.
- Keep them small (about 5 MB in total): viewport shots, animations off, caret hidden, dates and ids masked (`dynamicText` in `visual.spec.ts`). To cut size, set `visual: false` on a route in `routes.ts`: it stays in the axe set.
- A theme is set the way the app reads it, `localStorage.theme` (next-themes), together with `colorScheme`.

## The seed (`backend/scripts/e2e-seed.ts`)

Writes straight to Mongo, Redis and the local storage folder with fixed ids, so running it again changes nothing but relative dates.

| Account | State |
|---|---|
| `free@` | Free, 3 of 5 sheets used, trial available |
| `pro@` | Pro (admin grant), owns the team "Pixel Forge" with one pending invite |
| `trial@` | Pro on the 14-day trial, 9 days left |
| `lapsed@` | Pro period ended 16 days ago, owns "Dormant Studio" (read-only now) |
| `member@` | Free, a member of "Dormant Studio": can view and download, not edit |
| `admin@` | Admin |
| `creator@` | Free, author of five community collections: with tags, with one asset and no tags, empty, and with five 24-character tags |

All use `@openassets.test` and the password from `E2E_PASSWORD`. Every account except `creator` has three jobs cut from `frontend/public/samples/sprite-sheet.svg` (rasterised with sharp, real transparent PNG crops): `e2e-<account>-ready` (finished, with a ZIP), `-cropped` (waiting on the export screen) and `-detected` (waiting in the editor). Collections: public, draft, shared with a team, read-only team, and community packs with likes, tags (`pixel-art` is on three of them, for the tag filter) and asset counts of 0, 1, 3, 4 and 8.

The API rate limits by client address; each test sends its own `X-Forwarded-For` (`env.ts`) so a long run does not throttle itself.
