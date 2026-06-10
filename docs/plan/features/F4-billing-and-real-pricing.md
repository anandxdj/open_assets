# F4 — Billing & Real Pricing

> **Theme B · Make the foundation real** (and the monetization track). Two parts:
> a cheap honesty fix now (the pricing page lies), and a real billing build later
> (when monetization is a priority) on top of the credits economy that already exists.
>
> **Priority:** P2 for the honest rewrite (do soon) · monetization build is M3, scheduled when prioritized · **Effort:** S (rewrite) + XL (full billing) · **Depends on:** nothing for the rewrite; the credits primitives (`modules/usage/`) for the build.

---

## 1. Problem

`app/pricing/page.tsx` advertises a product that doesn't exist:
- Tiers like "$150 Pro", "Hobby — 5 sprite sheets/mo", "Enterprise" — none of which map to anything implemented.
- The **real** economy is: 150 free studio credits/month (lazily reset, atomic deduct) + BYOK (bring your own OpenRouter key → bypass credits entirely). No paid tier exists.
- CTAs ("START 14-DAY TRIAL", "START FREE SANDBOX") just link to `/register`. The "startups program" links to a personal Twitter DM.

So the page makes promises the backend can't keep, and there is **no billing system at all** — `User.plan` is `'free'|'byok'|'pro'` but nothing ever sets `'pro'` or charges money.

---

## 2. Goals / non-goals

**Part A — Honest rewrite (now)**
- The pricing/landing copy describes the *actual* model: generous free credits + BYOK for unlimited. Remove fictional tiers, fake trials, and the personal-DM link.

**Part B — Real billing (later)**
- Real paid plans that grant more monthly credits and/or unlock pro models (gemini-3-pro-image, gpt-image) without BYOK.
- Stripe (or equivalent) checkout + webhooks that flip `User.plan` and adjust the monthly credit grant.
- Optional metered credit top-ups ("buy 500 credits").
- Self-serve billing portal (upgrade/downgrade/cancel, invoices).

**Non-goals**
- Not changing the credits *mechanics* — `consume`/`refund`/cost-table are solid and atomic; billing sits on top.
- Not building usage analytics beyond what billing needs.
- BYOK stays free forever (it costs us nothing).

---

## 3. Current state (what's already built)

| Piece | Where | State |
|---|---|---|
| Credits balance + monthly grant | `auth.model.ts` (`credits`, `creditsGrantedAt`, `plan`) | ✅ exists |
| Atomic deduct / idempotent refund | `usage.service.ts` | ✅ race-tested |
| Server-authoritative cost table | `usage.service.ts:14-22` | ✅ (mind FX-23 matcher) |
| Balance API | `GET /api/usage/me` | ✅ returns `{credits, plan, monthlyGrant, resetAt}` |
| `plan` field | `'free'|'byok'|'pro'` | ⚠️ `'pro'` never set by anything |
| Pricing page | `app/pricing/page.tsx` | ❌ fictional |
| Billing/Stripe | — | ❌ does not exist |

The economic *core* is half-built: metering works, only the "take money and grant
more" layer is missing.

---

## 4. Design

### 4.1 Part A — Honest rewrite (S, do now)

Rewrite `pricing/page.tsx` to two real columns:
- **Free** — 150 studio credits/month, all extraction features, public collections. CTA → `/register`.
- **BYOK** — unlimited generation with your own OpenRouter key, no credits consumed. CTA → studio settings / docs on getting an OpenRouter key.

Remove the trial language, fake quotas, Enterprise tier, and the Twitter-DM
startups link (or replace with a real contact). Add the link from Navbar/footer
(FX-19). This is purely frontend + copy.

### 4.2 Part B — Real billing (XL, scheduled)

**Plan model.** Define plan tiers as config (not hardcoded in UI):

```ts
const PLANS = {
  free: { monthlyCredits: 150, proModels: false, price: 0 },
  pro:  { monthlyCredits: 2000, proModels: true,  priceId: 'stripe_price_...' },
  // top-ups: one-time credit packs
};
```

The monthly grant logic in `usage.service.ts` already resets credits lazily — extend it to grant `PLANS[user.plan].monthlyCredits` instead of a constant 150.

**Stripe integration.**
- New backend module `modules/billing/`:
  - `POST /api/billing/checkout` (auth) → create a Stripe Checkout session for a plan/top-up → return URL.
  - `POST /api/billing/webhook` (Stripe signature-verified, **not** auth-guarded; raw body) → on `checkout.session.completed` / `customer.subscription.updated|deleted`: set `user.plan`, `user.stripeCustomerId`, reset/grant credits; on top-up: `$inc` credits via the existing atomic path.
  - `POST /api/billing/portal` (auth) → Stripe billing portal session.
- `User` gains `stripeCustomerId`, `stripeSubscriptionId`, `planRenewsAt`.

**Pro-model gating.** Today any signed-in user with credits can call any model; the
cost table just charges more (gemini-3-pro=4, gpt-image=10). Decide: do pro models
require `plan: 'pro'`, or just enough credits? If gated, add a check in the studio
route's credit-consume step (server-side, in `usage.service.consume` or the route)
that rejects pro-model ops for non-pro plans with a clear upsell code
(`PLAN_REQUIRED`) — threaded to the frontend like the existing `INSUFFICIENT_CREDITS`.

**Frontend.**
- Pricing page CTAs → `/api/billing/checkout`.
- Account/billing settings page: current plan, credits, renew date, manage-subscription (portal), buy top-up.
- New `StudioApiError` code `PLAN_REQUIRED` → upsell modal (reuse the FX-07 / F1 error-handling infra).

### 4.3 Security notes

- Webhook must verify Stripe signatures and use the **raw** body (Express JSON parser must be bypassed for that route — note the 100kb JSON cap in `app.ts:47`).
- Never trust client-sent prices/credit amounts — derive everything from server-side plan config + Stripe price IDs.
- Idempotency: webhooks can replay; key credit grants on the Stripe event id (mirror the `UsageEvent` idempotency pattern).

---

## 5. Phased tasks

**Phase A — Honest rewrite** *(S, now)*
1. Rewrite `pricing/page.tsx` to Free + BYOK reality.
2. Remove fake CTAs / personal DM link; add Navbar/footer link.

**Phase B1 — Billing backend** *(L)*
3. `modules/billing/` (checkout, webhook, portal); `User` Stripe fields.
4. Plan config; extend monthly grant to read plan.
5. Webhook idempotency + signature verification + raw-body route.

**Phase B2 — Gating + frontend** *(M)*
6. Pro-model gating (if chosen) + `PLAN_REQUIRED` code threaded to studio error UX.
7. Pricing CTAs → checkout; billing settings page; top-up flow.

**Phase B3 — Hardening** *(M)*
8. Tests (webhook idempotency, grant-on-upgrade, downgrade/cancel) — overlaps F7.
9. Dunning/failed-payment handling; downgrade-on-cancel grace.

## 6. Risks & mitigations

- **Webhook replay / double-grant.** → Idempotency keyed on Stripe event id.
- **Body-parser conflict** for the webhook. → Mount the raw-body webhook route before/around the JSON parser.
- **Plan/credits desync** (user upgrades mid-cycle). → Define prorating policy up front; keep grant logic in one place (`usage.service`).
- **Scope creep.** → Part A is independent and ships now; Part B only when monetization is a real priority. Don't block the honest rewrite on the full build.

## 7. Verification

- Part A: pricing page reflects real model; no dead/false CTAs; reachable from nav.
- Part B: test-mode Stripe checkout → webhook flips `plan` to `pro` and grants credits; portal cancel → downgrades at period end; top-up `$inc`s credits atomically; replayed webhook grants once; pro-model op rejected for free plan with `PLAN_REQUIRED`.

## 8. Definition of done

**A:** the pricing page tells the truth and links somewhere real. **B (when
scheduled):** a user can pay, get more credits / pro-model access, manage their
subscription, and the credits economy stays atomic and idempotent under webhook
replay.
