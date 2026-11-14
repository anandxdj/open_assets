# Team sharing (Pro)

A Pro account can create a team, invite people by email and share its own
collections with them. Everyone on the team can view, edit and download a shared
collection. Teammates can be on any plan.

## Model

| Collection | Holds |
|---|---|
| `teams` | `name`, `owner` (unique) |
| `teammembers` | `team`, `user` (**unique**), `role` (`owner` \| `member`), `joinedAt`. The owner has a row too. |
| `teaminvites` | `team`, `email` (lowercase), `tokenHash` (unique), `invitedBy`, `expiresAt`, `lastSentAt`. Unique on `(team, email)`. |
| `collections.teamId` | Set while the collection is shared with its owner's team. |

**One team per person.** A person is in at most one team, as owner or as member.
This is enforced by the unique indexes on `teams.owner` and `teammembers.user`,
not only in code, so two simultaneous requests cannot break it. To join another
team, leave the first one; to start your own, leave or dissolve first. This keeps
the model small: "your team" is a single lookup, and the UI has one Team section.

**Seats.** The new numeric entitlement `teamSeats` (Free 0, Pro 10, in both
`entitlements.json` files) caps the team, owner included. Seats in use are
members plus pending invites that have not expired, so a team can never be
over-invited. The limit is the **owner's** plan; members' plans do not matter.
Counting is re-checked after the write, so simultaneous invites or accepts cannot
overshoot the cap. Errors are the usual `403 PLAN_LIMIT` / `PLAN_REQUIRED`.

**Lapsed plan = read-only.** Nothing is stored when a plan ends: the team is
read-only whenever the owner's *effective* plan no longer has `teamSharing`
(an expired trial, a timed grant that ended, an admin switching them to free).
Then:

- members can still view and download, but every edit answers
  `403 TEAM_READ_ONLY`;
- no new invites go out (`PLAN_REQUIRED`) and nobody can accept one
  (`TEAM_READ_ONLY`);
- the owner can still remove members, withdraw invites, take collections back
  out of the team, dissolve it, and edit their own collections as before;
- the owner cannot share more collections;
- everything returns the moment the owner is Pro again.

The Settings Team section and the Team tab say so, to both owner and members.

## Who may do what with a collection

One module, `backend/src/modules/collections/collection.access.ts`, decides this.
Every collection route asks it; none compares `creator` itself any more.

| | Owner | Team member | Anyone (published pack) | Everyone else |
|---|---|---|---|---|
| View, download, like | yes | yes | yes | no (403) |
| Create folders, add and delete images | yes | yes, while the team is editable | no | no |
| Rename, edit, publish, delete, share with the team | yes | **no** | no | no |

Notes:

- Folder and image routes check access **before** reading an upload, so a
  refused request never buffers a file or writes to storage (`requireEditAccess`
  runs before multer).
- Saving an editor export (with a naming pattern) goes through the same route.
  The job must be the caller's own, and a custom naming pattern is gated on the
  **caller's** plan, not the collection owner's.
- Liking now needs view access (it used to work on any id, private or not).
- Public community packs behave as before; the team is not revealed to the public.
- Private collections still answer 403 to people who cannot see them.
- ZIP downloads of private and team collections are fetched with the access
  token (a plain link cannot send it); published packs keep the plain link.

## Invites

- The owner invites by email. A random 32-byte token (base64url) goes in the
  link `/team/invite/<token>`; only its SHA-256 is stored.
- Valid 7 days. Resending (or inviting the same address again) makes a **new**
  token and resets the clock; the old link stops working. Expired invites stay
  listed (marked expired) so the owner can resend them.
- The owner can withdraw an invite and remove a member; a member can leave. The
  owner cannot leave: dissolve the team instead (collections stay theirs, they
  just stop being shared).
- Accepting needs a signed-in, verified account **whose email is the invited
  one** (`403 TEAM_EMAIL_MISMATCH` otherwise; the invite survives). Someone already
  in a team gets `409 TEAM_ALREADY_MEMBER`.
- The accept page (`/team/invite/[token]`) is public for the preview, sends
  people through sign-in or sign-up with `?next=` set to itself (same-origin
  paths only, also through Google sign-in), and is `noindex` with
  `Referrer-Policy: no-referrer`; `/team/` is in the robots disallow list.
- Sending is rate limited per owner, and invite-link lookups per IP.
- Email: `sendTeamInviteEmail` (Resend). Without `RESEND_API_KEY` it logs
  `[Email Mock]` lines, including the link outside production.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/api/team` | the caller's team, members, (owner) invites, seats, `readOnly`; plus `entitled`/`seatLimit` for their own plan |
| POST | `/api/team` | create (Pro). 409 if already in a team |
| PUT | `/api/team` | rename (owner) |
| DELETE | `/api/team` | dissolve (owner) |
| POST | `/api/team/invites` | `{ email }` (owner, Pro, seat available) |
| POST | `/api/team/invites/:id/resend` | new link, new 7 days (owner, Pro) |
| DELETE | `/api/team/invites/:id` | withdraw (owner, always allowed) |
| DELETE | `/api/team/members/:userId` | remove (owner, always allowed) |
| POST | `/api/team/leave` | leave (member) |
| GET | `/api/team/invite/:token` | preview: team name, inviter, invited address, expiry. No session needed |
| POST | `/api/team/invite/:token/accept` | join. Session and matching email needed |
| PUT | `/api/collections/:id/team` | `{ shared }`: move an own collection into or out of the team (owner) |

`GET /api/collections/mine` returns the caller's own collections **and** the ones
shared with their team, each with `access: { canEdit, canManage, via, teamReadOnly }`.
`GET /api/collections/:id` returns the same `access` and the `team` name (to the
owner and the team only).

Error codes: `TEAM_READ_ONLY`, `TEAM_ALREADY_MEMBER`, `TEAM_NOT_FOUND`,
`TEAM_NOT_OWNER`, `TEAM_OWNER_CANNOT_LEAVE`, `TEAM_INVITE_INVALID` (404),
`TEAM_INVITE_EXPIRED` (410), `TEAM_EMAIL_MISMATCH`, plus `PLAN_REQUIRED` and
`PLAN_LIMIT` from the plans module.

## Account deletion

Decision: **the owner's team is dissolved and the collections they shared are
deleted with the rest of their data.** They are the owner's collections (the
creator), so the existing deletion already removes them, images and stored files
included; keeping them alive under someone else would mean transferring ownership,
which teams do not have. Members therefore lose access. Because they cannot be
asked, the delete-account dialog warns the owner first: it names the team, how
many members lose access and how many shared collections are deleted, and pending
invites stop working. The response also reports `teamDissolved` and
`teamMembersRemoved`.

A **member** deleting their account is simply removed from the team. What they
added to the owner's collections stays, and so do the stored files those images
point at (account deletion skips any file an image row still references). Their
own collections are deleted as for any account.

The team is detached first (collections are unshared, then members, invites and
the team go), so a stopped deletion never leaves collections visible to people
who were just cut off, and a retry is safe.

## Where things live

- Backend: `backend/src/modules/teams/` (models, `team.service.ts`,
  `team.access.ts`, `team.mail.ts`, routes), `collections/collection.access.ts`,
  `account/account.service.ts`.
- Frontend: `frontend/src/features/team/` (API, Settings section, invite screen,
  delete-dialog warning), the Team tab in `features/collections/components/MyCollectionsScreen.tsx`,
  editing and downloads in `PackDetailScreen.tsx`.
- Tests: `teams.routes.test.ts`, `collections.team-access.test.ts`,
  `teams.account.test.ts` (shared set-up in `__tests__/helpers/teamHarness.ts`).
  They need `MONGO_URI` and `REDIS_URL` and use `<MONGO_DB_NAME>_test` and Redis DB 15.
