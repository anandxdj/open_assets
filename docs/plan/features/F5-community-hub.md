# F5 — Community Hub

> **Theme C · Become a destination.** Grow Collections from a publishing feature
> into a social asset-sharing community: creator profiles, real discovery, comments,
> follows, and remix/fork. This is the compounding play — it gets stronger as F1
> (more content in) and F2 (creator footprint) land.
>
> **Priority:** P2 (M2 milestone) · **Effort:** XL (multi-phase) · **Depends on:** FX-06 (real AI tags) for discovery to be meaningful; benefits from F1 + F2.

---

## 1. Problem / opportunity

Collections today is a competent CRUD-and-gallery feature (`app/collections`,
`app/(dashboard)/dashboard/collections`, `modules/collections/`): publish folders
of images, like, download, search by text/tags, sort by recency/popularity. What
it is **not** yet is a *community*:

- **No creator identity.** You can't view "everything by this user," there are no profiles, no follows.
- **Discovery is thin.** Search works, but tags are sparse because manual uploads aren't AI-tagged (FX-06), and there's no trending/curated/category browsing beyond a sort dropdown.
- **No conversation or social proof beyond a like count.** No comments, no "who liked this," no remix lineage.
- **Likes are one-way.** `collectionLike.model.ts` enforces idempotency but the UI can't tell you *if you* liked something or let you unlike.

The opportunity: OpenAssets produces a steady stream of high-quality game assets
(extracted + generated). A community layer turns that output into a reason to
return, a discovery engine, and a moat.

---

## 2. Goals / non-goals

**Goals (phased — not all at once)**
- **Creator profiles:** public `/u/:handle` page listing a user's public collections + stats.
- **Real discovery:** trending / new / by-category feeds; meaningful tag search (requires FX-06).
- **Social actions:** like state + unlike (toggle), follow creators, comments on collections.
- **Remix/fork:** "duplicate this collection into my workspace" to build on someone's pack (attribution preserved).
- **Notifications (light):** "your collection got N likes / a comment."

**Non-goals**
- Not a full social network (no DMs, no feeds-of-everyone-you-follow in v1 beyond a simple list).
- Not moderation tooling beyond basic report/hide (note as a follow-up).
- Not changing the extraction/generation products.

---

## 3. Current state

| Piece | Where | State |
|---|---|---|
| Collection/Folder/Image models | `modules/collections/*.model.ts` | ✅ with recency/popularity indexes + text search on name/desc/tags |
| Public list + detail | `app/collections`, `app/collections/[id]` | ✅ gallery, lightbox, ZIP downloads |
| Likes | `collectionLike.model.ts` | ✅ idempotent (unique `(user, collectionId)`), but UI shows count only |
| My collections | `dashboard/collections` | ✅ CRUD + publish |
| Tags | `Image.tags`, `Collection.tags` | ⚠️ sparse — manual uploads not auto-tagged (FX-06) |
| User identity | `auth.model.ts` | has `name`, `email`; **no public handle, no avatar, no bio** |
| Comments / follows / profiles / remix | — | ❌ none |

---

## 4. Design (phased)

### Phase 1 — Tag enrichment + discovery (depends on FX-06)
- **FX-06** first: async Gemini Vision tagging on manual collection uploads (see fix backlog). Without real tags, discovery is hollow.
- Discovery feeds on the public list endpoint: `?sort=trending|new|popular`, `?tag=`, `?category=`. "Trending" = a time-decayed score over likes+downloads (compute in the aggregation, or a periodic job that writes a `trendingScore`).
- Frontend: tabbed `/collections` (Trending / New / Most Downloaded) + a tag/category filter rail. Reuse the existing gallery card.

### Phase 2 — Creator profiles + follows
- `User` gains `handle` (unique, indexed), `avatarUrl`, `bio`.
- Routes: `GET /api/users/:handle` (public profile + their public collections), `GET /api/users/:handle/collections`.
- `Follow` model `{ follower, following }` with unique compound index; `POST/DELETE /api/users/:handle/follow`; `followerCount` denormalized on `User`.
- Frontend: `/u/:handle` profile page; author badge on collection cards links here; follow button.

### Phase 3 — Likes UX + comments
- **Like state:** extend the collection detail response with `likedByMe` (cheap lookup against `collectionLike`); add unlike (`DELETE /api/collections/:id/like`) and a toggle in the UI (today it only increments).
- **Comments:** `Comment` model `{ collection, user, body, createdAt }`; `GET/POST /api/collections/:id/comments`, `DELETE` (owner/author/admin). Frontend thread on the detail page. Basic profanity/length guard; report flag (`reported` boolean) for later moderation.

### Phase 4 — Remix / fork
- "Remix" = create a new draft collection in the current user's workspace whose images reference (or copy) the source's images, with `forkedFrom: collectionId` stored for attribution.
- Decide copy semantics: **reference** (cheap, but breaks if source deletes) vs **copy** (duplicate storage objects via `storage.upload` of the fetched bytes — safe, costs storage). Recommend copy for durability; gate behind a confirm.
- Frontend: "Remix" button on public detail → lands in `/dashboard/collections` with the forked draft + an attribution line shown on publish.

### Phase 5 — Light notifications
- `Notification` model `{ user, type, payload, read, createdAt }`; write on like/comment/follow events (best-effort, non-blocking).
- A bell in the navbar with an unread count; `/notifications` list. Keep it simple (poll on an interval; no websockets in v1).

---

## 5. Data-model summary (new/changed)

```
User      += handle (unique), avatarUrl, bio, followerCount, followingCount
Follow      { follower, following, createdAt }    unique (follower, following)
Comment     { collection, user, body, reported, createdAt }   index (collection, createdAt)
Collection += forkedFrom?: ObjectId, trendingScore?: number, commentCount
Notification{ user, type, payload, read, createdAt }   index (user, createdAt)
collectionLike (existing) — UI now reads likedByMe + supports unlike
Image.tags / geminiMetadata — populated by FX-06 enrichment
```

## 6. API summary (new)

```
GET    /api/users/:handle                      public profile
GET    /api/users/:handle/collections          their public collections
POST   /api/users/:handle/follow  · DELETE      follow / unfollow
DELETE /api/collections/:id/like               unlike (pair to existing POST)
GET    /api/collections/:id (extended)         + likedByMe, commentCount
GET/POST /api/collections/:id/comments  · DELETE :commentId
POST   /api/collections/:id/remix              fork into caller's workspace
GET    /api/notifications  · POST /:id/read     light notifications
GET    /api/collections?sort=trending&tag=&category=   discovery
```

All write routes auth-guarded; reuse `assertOwner`/author checks. Add rate limits
on comment POST and follow (abuse surface).

## 7. Phased task list

1. **FX-06** AI tagging (precondition) → discovery feeds + filter UI. *(M)*
2. Profiles + handles + follows. *(L)*
3. Like-state/unlike + comments. *(M)*
4. Remix/fork (decide copy vs reference). *(L)*
5. Notifications. *(M)*

Ship 1→3 first (discovery + identity + conversation deliver most of the
community value); 4–5 are amplifiers.

## 8. Risks & mitigations

- **Empty-community cold start.** → Seed with the team's own published packs; surface "new" prominently; F1 inflow helps.
- **Tag quality** drives discovery. → FX-06 must be good; allow user tag editing as a correction path.
- **Abuse** (spam comments, follow farming, report bombing). → Rate limits, length/profanity guards, `reported` flag + an admin hide; full moderation is a follow-up.
- **Handle uniqueness/squatting.** → Reserve a handle at signup (derive from name + suffix), allow one change, unique index.
- **Remix storage cost** if copying. → Confirm dialog; consider copy-on-publish only; track via the existing storage adapter.
- **Privacy:** profiles list only *public* collections; drafts never leak.

## 9. Verification

- Tagging: a manually uploaded image gets sensible tags within seconds; search by those tags surfaces it.
- Discovery: trending reflects recent likes/downloads; tag/category filters narrow correctly.
- Profile: `/u/:handle` shows only public collections; follow/unfollow updates counts; another user's drafts never appear.
- Comments: post/delete with correct authz; report flags.
- Remix: forking creates an owned draft with attribution; publishing shows "remixed from."
- Notifications: like/comment/follow produce unread items; mark-read works.

## 10. Definition of done

A visitor can discover packs by trending/tag/category, click through to a creator's
profile, follow them, like and comment, and remix a pack into their own workspace —
all backed by real AI tags. Collections has become a place, not just a feature.
