# Future-Feature Roadmap

> Where OpenAssets goes next. Themes, the dependency graph that orders them,
> per-feature one-paragraph pitches, and a suggested milestone sequence that
> interleaves the fix backlog ([`01-fixes-and-wireups.md`](01-fixes-and-wireups.md))
> so nothing valuable gets built on a broken foundation.
>
> Each feature has a deep-dive in [`features/`](features/). This doc is the map;
> those are the territory.

---

## Product thesis

Today OpenAssets does two things well in isolation — **extract** assets from
packed images, and **generate** assets in five AI studios — and lets users
**publish** results to public Collections. The next chapter is about making
those three loops feed each other and turning a tool into a destination:

> *Generate or extract → refine → publish → get discovered → others remix.*

The roadmap is organized around three themes:

| Theme | What it means | Features |
|---|---|---|
| **A. Close the loop** | Every producer surface can save into the platform; nothing is a dead-end. | F1 (studio→collections), F2 (history) |
| **B. Make the foundation real** | The plumbing the product *claims* to have actually works and is trustworthy. | F3 (storage parity), F4 (billing), F7 (testing/CI) |
| **C. Become a destination** | Collections grow from a feature into a community. | F5 (community hub), F6 (extension v2) |

---

## The feature set

### F1 — Studio → Collections bridge *(Theme A · Studio Integration Phase 6)*
The five studios export only to local files. Add "Save to Collection" so generated
parallax layers, tilesets, sprite sheets, and prop atlases land in the same
Collections that extracted assets do — with optional upscale-before-save. This is
the single highest-leverage feature: it connects the generation product to the
publishing product and was already scoped (and deferred) in the original studio
plan. **Also fixes FX-07** (studio error UX) because the save flow forces us to
finish the auth/credit interactive prompts. → [F1](features/F1-studio-collections-bridge.md)

### F2 — History & job persistence *(Theme A)*
The History page is a stub, and it's unbuildable today: jobs live only in Redis
with a 24h TTL and there is no per-user index or list endpoint. Build the
persistence (a per-user job index + a `GET /jobs` list route), then a real
History screen showing past extractions, their status, and re-download / re-open
links. Unlocks "my work" as a first-class concept. → [F2](features/F2-history-and-job-persistence.md)

### F3 — Storage-provider parity *(Theme B · also FX-01/FX-10)*
`STORAGE_PROVIDER=imagekit` is documented but broken below the Node layer
(py_backend hardcodes Cloudinary + a Cloudinary-only host allowlist). Make the
abstraction true end-to-end: a pluggable upload client in py_backend, a
provider-derived allowlist, and consistent transform-failure semantics across
adapters. Foundation work that everything storage-touching depends on. →
[F3](features/F3-storage-provider-parity.md)

### F4 — Billing & real pricing *(Theme B)*
The pricing page is fictional. Either retire it to an honest free+BYOK
description (do immediately, cheap) or build a real plan/credits/billing system
(Stripe, plan tiers mapped to the existing `User.plan` + credits economy, webhooks,
metered top-ups). The credits primitives already exist and are atomic, so the
economic core is half-built. → [F4](features/F4-billing-and-real-pricing.md)

### F5 — Community hub *(Theme C)*
Grow Collections into a social surface: creator profiles, discovery (trending /
new / search by tag with real AI tags — depends on FX-06), likes you can see the
state of, comments, follows, and "remix"/fork. This is the destination play; it
compounds with F1 (more content flowing in) and F2 (creators see their footprint).
→ [F5](features/F5-community-hub.md)

### F6 — Extension v2 completion *(Theme C · also FX-08/FX-14/FX-22)*
The Chrome extension is ~90% overhauled but has a non-functional live-progress
bar (wrong message channel), a JWT-storage decision that drifted from the security
spec, and stub icons. Finish it, then extend: extract-to-collection from the
extension, multi-image batch extract, and a polished onboarding. →
[F6](features/F6-extension-v2-completion.md)

### F7 — Testing & CI hardening *(Theme B)*
Collections, auth, and workers have zero test coverage; CI skips frontend
`build`/`lint` and all py tests. Before the codebase grows further, build the
safety net: integration tests for the collections ZIP/authz paths, auth flows,
worker failure transitions, plus CI steps that actually catch a broken build. →
[F7](features/F7-testing-and-ci-hardening.md)

---

## Dependency graph

```
                      ┌─────────────────────────────┐
                      │  FX-02/03/04/09 (P0 fixes)   │  ← do first; unblock everything
                      └──────────────┬──────────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
        ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
        │ F3 storage  │     │ F7 testing  │     │ F1 studio→  │
        │ parity      │     │ + CI        │     │ collections │
        │ (FX-01/10)  │     │ (FX-15)     │     │ (FX-07)     │
        └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
               │                   │                   │
               │   (safe storage   │  (regression net  │
               │    for all uploads)│   under refactors)│
               └─────────┬─────────┴─────────┬─────────┘
                         ▼                   ▼
                  ┌─────────────┐     ┌─────────────┐
                  │ FX-06 tag   │────▶│ F5 community│
                  │ enrichment  │     │ hub         │
                  └─────────────┘     └──────┬──────┘
                         ▲                   │
                         │                   ▼
                  ┌─────────────┐     ┌─────────────┐
                  │ F2 history  │     │ F6 extension│
                  │ + job index │     │ v2          │
                  └─────────────┘     └─────────────┘

   F4 billing — independent track; do the honest-rewrite now,
   schedule the Stripe build when monetization is a priority.
```

**Reading it:** the P0 fixes gate everything. F3 (storage) and F7 (tests) are
foundation — ideally land before large feature work so new code sits on a true
abstraction and can't regress silently. F1 is the highest-value Theme-A feature
and is mostly independent. F5 (community) depends on FX-06 (real tags) for
discovery to be meaningful and benefits from F1 (content inflow) and F2 (creator
footprint). F4 is its own track.

---

## Suggested milestones

### M0 — Trustworthy foundation (≈1 sprint)
- P0 fixes: **FX-02, FX-03, FX-04, FX-09** (auth, py fail-open, compose, env examples).
- **F3** storage-provider parity (FX-01, FX-10).
- Honest pricing rewrite (the cheap half of **F4**).
- *Exit:* both storage providers work end-to-end; the documented setup commands actually work; no fictional product claims.

### M1 — Close the loop (≈1–2 sprints)
- **F1** studio → collections bridge (carries **FX-07** studio error UX).
- **F2** history + per-user job index.
- First slice of **F7** (collections + auth integration tests) landed alongside so the new endpoints are covered.
- *Exit:* nothing a user produces is a dead-end; "my work" is browsable.

### M2 — Destination (≈2–3 sprints)
- **FX-06** AI tag enrichment → then **F5** community hub (profiles, discovery, comments, follows).
- **F6** extension v2 completion + extract-to-collection.
- Remainder of **F7** (worker tests, CI build/lint/py).
- *Exit:* Collections is a place people browse, not just a place exports land.

### M3 — Monetize (when ready)
- Full **F4** billing (Stripe, plan tiers, metered top-ups) on top of the existing atomic credits economy.

P2/P3 cleanup items from the fix backlog get folded into whichever milestone
touches their files (e.g. delete dead components when refactoring the editor,
tighten CORS when revisiting auth).

---

## Out of scope (parked ideas, not planned)

Captured so they aren't re-proposed as if new. Promote to a feature doc only when prioritized.

- Real-time collaborative editing of bounding boxes (multiplayer canvas).
- Animation/GIF export from sprite studio sheets directly.
- A public REST API with API keys for programmatic extraction (the surface exists; productizing it is a separate effort tied to F4).
- Desktop/Electron wrapper.
- Self-hosted model inference (replace OpenRouter/Gemini deps).
