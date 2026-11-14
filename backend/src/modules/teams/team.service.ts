import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { hashToken } from '../../common/utils/jwt.utils';
import type { AuthRequest } from '../auth/auth.middleware';
import { UserModel } from '../auth/auth.model';
import { CollectionModel } from '../collections/collection.model';
import { assertEntitled, assertWithinLimit, getEntitlements, hasEntitlement } from '../plans/entitlements';
import { READ_ONLY_MESSAGE, TEAM_ERROR, getTeamState, isTeamWritable } from './team.access';
import type { TeamState } from './team.access';
import { teamMailer } from './team.mail';
import { TeamModel } from './team.model';
import { TeamInviteModel } from './teamInvite.model';
import type { ITeamInvite } from './teamInvite.model';
import { TeamMemberModel } from './teamMember.model';
import type { TeamRole } from './teamMember.model';

/** The signed-in user as `authenticate()` provides it, with the plan fields entitlements read. */
export type TeamActor = NonNullable<AuthRequest['user']>;

/** An invite link works for this long. */
export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export interface TeamMemberView {
  id: string;
  name: string;
  email: string;
  picture?: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamInviteView {
  id: string;
  email: string;
  expiresAt: string;
  expired: boolean;
  lastSentAt: string;
}

export interface TeamOverview {
  /** The viewer's own plan includes team sharing (they may create a team). */
  entitled: boolean;
  /** Seats the viewer's own plan would give a team they own. */
  seatLimit: number;
  team: null | {
    id: string;
    name: string;
    role: TeamRole;
    /** The owner's plan lapsed: view and download only, no invites, no editing. */
    readOnly: boolean;
    owner: { id: string; name: string };
    members: TeamMemberView[];
    /** Pending and expired invites. Only the owner sees them. */
    invites: TeamInviteView[];
    /** `used` counts members (owner included) plus invites that have not expired. `limit` is the owner's plan. */
    seats: { used: number; limit: number };
    sharedCollections: number;
  };
}

export interface InvitePreview {
  teamName: string;
  invitedBy: string;
  /** The address the invite was sent to: the one the invitee must sign in with. */
  email: string;
  expiresAt: string;
  /** The owner's plan lapsed, so the team cannot take new members right now. */
  readOnly: boolean;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function isDuplicateKey(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000);
}

function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url'); // 43 characters
  return { token, tokenHash: hashToken(token) };
}

function iso(date: Date): string {
  return new Date(date).toISOString();
}

async function requireOwnedTeam(userId: string): Promise<TeamState> {
  const state = await getTeamState(userId);
  if (!state) throw new ApiError(404, 'You are not in a team.', TEAM_ERROR.NO_TEAM);
  if (state.role !== 'owner') {
    throw new ApiError(403, 'Only the team owner can do this.', TEAM_ERROR.NOT_OWNER);
  }
  return state;
}

/** Members (owner included) and invites that still hold a seat. */
async function seatsInUse(teamId: Types.ObjectId | string, now: Date) {
  const [members, invites] = await Promise.all([
    TeamMemberModel.countDocuments({ team: teamId }),
    TeamInviteModel.countDocuments({ team: teamId, expiresAt: { $gt: now } }),
  ]);
  return { members, invites, used: members + invites };
}

function inviteView(invite: Pick<ITeamInvite, 'id' | 'email' | 'expiresAt' | 'lastSentAt'>, now: Date): TeamInviteView {
  return {
    id: String(invite.id),
    email: invite.email,
    expiresAt: iso(invite.expiresAt),
    expired: invite.expiresAt.getTime() <= now.getTime(),
    lastSentAt: iso(invite.lastSentAt),
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** The viewer's team (as owner or member), or none, plus what their own plan allows. */
export async function getTeamOverview(user: TeamActor, now: Date = new Date()): Promise<TeamOverview> {
  const own = { entitled: hasEntitlement(user, 'teamSharing', now), seatLimit: getEntitlements(user, now).teamSeats };
  const state = await getTeamState(user.id);
  if (!state) return { ...own, team: null };

  const { team, role, writable } = state;
  const [memberRows, inviteRows, ownerUser, shared, seats] = await Promise.all([
    TeamMemberModel.find({ team: team._id }).sort({ joinedAt: 1 }).lean(),
    role === 'owner' ? TeamInviteModel.find({ team: team._id }).sort({ createdAt: -1 }) : Promise.resolve([]),
    UserModel.findById(team.owner).select('name plan trialEndsAt').lean(),
    CollectionModel.countDocuments({ teamId: team._id }),
    seatsInUse(team._id, now),
  ]);
  const people = await UserModel.find({ _id: { $in: memberRows.map((m) => m.user) } })
    .select('name email picture')
    .lean();
  const byId = new Map(people.map((p) => [String(p._id), p]));

  const members: TeamMemberView[] = memberRows.flatMap((row) => {
    const person = byId.get(String(row.user));
    if (!person) return []; // a user deleted mid-way; account deletion removes their row next
    return [
      {
        id: String(person._id),
        name: person.name,
        email: person.email,
        ...(person.picture ? { picture: person.picture } : {}),
        role: row.role,
        joinedAt: iso(row.joinedAt),
      },
    ];
  });

  return {
    ...own,
    team: {
      id: String(team._id),
      name: team.name,
      role,
      readOnly: !writable,
      owner: { id: String(team.owner), name: ownerUser?.name ?? 'Unknown' },
      members,
      invites: inviteRows.map((invite) => inviteView(invite, now)),
      seats: {
        used: role === 'owner' ? seats.used : seats.members,
        limit: ownerUser ? getEntitlements(ownerUser, now).teamSeats : 0,
      },
      sharedCollections: shared,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Team
 * ------------------------------------------------------------------ */

/** Creates the caller's team. Needs team sharing on their plan, and no team yet (one per person). */
export async function createTeam(user: TeamActor, name: string): Promise<TeamOverview> {
  assertEntitled(user, 'teamSharing');
  assertWithinLimit(user, 'teamSeats', 1);

  if (await TeamMemberModel.exists({ user: user.id })) {
    throw new ApiError(409, 'You are already in a team. Leave it before creating your own.', TEAM_ERROR.ALREADY_IN_TEAM);
  }

  let team;
  try {
    team = await TeamModel.create({ name, owner: user.id });
  } catch (err) {
    if (isDuplicateKey(err)) throw new ApiError(409, 'You already own a team.', TEAM_ERROR.ALREADY_IN_TEAM);
    throw err;
  }
  try {
    await TeamMemberModel.create({ team: team._id, user: user.id, role: 'owner' });
  } catch (err) {
    await TeamModel.deleteOne({ _id: team._id });
    if (isDuplicateKey(err)) throw new ApiError(409, 'You are already in a team.', TEAM_ERROR.ALREADY_IN_TEAM);
    throw err;
  }
  return getTeamOverview(user);
}

export async function renameTeam(user: TeamActor, name: string): Promise<TeamOverview> {
  const { team } = await requireOwnedTeam(user.id);
  team.name = name;
  await team.save();
  return getTeamOverview(user);
}

/**
 * Removes a team and everything attached to it. Collections are not deleted:
 * they stop being shared and stay with their owner. The order is the safe one
 * to stop half way: unshare first, so a retry never leaves anything visible.
 */
async function dissolve(teamId: Types.ObjectId): Promise<void> {
  await CollectionModel.updateMany({ teamId }, { $unset: { teamId: 1 } });
  await TeamInviteModel.deleteMany({ team: teamId });
  await TeamMemberModel.deleteMany({ team: teamId });
  await TeamModel.deleteOne({ _id: teamId });
}

/** Owner dissolves the team. Their collections go back to being private to them. */
export async function dissolveTeam(user: TeamActor): Promise<void> {
  const { team } = await requireOwnedTeam(user.id);
  await dissolve(team._id as Types.ObjectId);
}

/**
 * Account deletion hook. An owner's team is dissolved (the collections are
 * deleted with the rest of their account right after); a member is removed.
 * Idempotent, so a retried deletion is safe.
 */
export async function detachUserFromTeam(
  userId: string,
): Promise<{ role: TeamRole | null; membersRemoved: number; sharedCollections: number }> {
  const membership = await TeamMemberModel.findOne({ user: userId }).lean();
  if (!membership) return { role: null, membersRemoved: 0, sharedCollections: 0 };

  if (membership.role === 'owner') {
    const [members, sharedCollections] = await Promise.all([
      TeamMemberModel.countDocuments({ team: membership.team, user: { $ne: userId } }),
      CollectionModel.countDocuments({ teamId: membership.team }),
    ]);
    await dissolve(membership.team);
    return { role: 'owner', membersRemoved: members, sharedCollections };
  }

  await TeamMemberModel.deleteOne({ _id: membership._id });
  return { role: 'member', membersRemoved: 0, sharedCollections: 0 };
}

/* ------------------------------------------------------------------ *
 * Members
 * ------------------------------------------------------------------ */

export async function removeMember(user: TeamActor, memberUserId: string): Promise<void> {
  const { team } = await requireOwnedTeam(user.id);
  if (memberUserId === user.id) {
    throw ApiError.badRequest('You own this team. Dissolve it instead of removing yourself.');
  }
  const removed = await TeamMemberModel.deleteOne({ team: team._id, user: memberUserId, role: 'member' });
  if (removed.deletedCount === 0) throw ApiError.notFound('That person is not in your team');
}

export async function leaveTeam(user: TeamActor): Promise<void> {
  const state = await getTeamState(user.id);
  if (!state) throw new ApiError(404, 'You are not in a team.', TEAM_ERROR.NO_TEAM);
  if (state.role === 'owner') {
    throw new ApiError(
      400,
      'You own this team, so you cannot leave it. Dissolve it instead.',
      TEAM_ERROR.OWNER_CANNOT_LEAVE,
    );
  }
  await TeamMemberModel.deleteOne({ team: state.team._id, user: user.id });
}

/* ------------------------------------------------------------------ *
 * Invites (owner)
 * ------------------------------------------------------------------ */

/**
 * Creates or refreshes the invite for an address and emails the link. The link
 * is new every time (the old one stops working) and valid for 7 days. Only the
 * token's hash is stored.
 */
async function issueInvite(user: TeamActor, state: TeamState, email: string, now: Date): Promise<TeamInviteView> {
  const { team } = state;
  const existing = await TeamInviteModel.findOne({ team: team._id, email });
  // A live invite already holds its seat, so refreshing it never needs a new one.
  const holdsSeat = Boolean(existing && existing.expiresAt.getTime() > now.getTime());
  if (!holdsSeat) {
    const { used } = await seatsInUse(team._id, now);
    assertWithinLimit(user, 'teamSeats', used + 1, now);
  }

  const { token, tokenHash } = newInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);

  let invite: ITeamInvite;
  try {
    if (existing) {
      existing.tokenHash = tokenHash;
      existing.expiresAt = expiresAt;
      existing.lastSentAt = now;
      existing.invitedBy = user.id as unknown as Types.ObjectId;
      invite = await existing.save();
    } else {
      invite = await TeamInviteModel.create({
        team: team._id,
        email,
        tokenHash,
        invitedBy: user.id,
        expiresAt,
        lastSentAt: now,
      });
    }
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict('That address was just invited. Reload to see it.');
    throw err;
  }

  if (!holdsSeat) {
    // Two invites sent at the same moment can both pass the check above. Count
    // again now that this one is stored; if the team is over, this one yields.
    const { used } = await seatsInUse(team._id, now);
    try {
      assertWithinLimit(user, 'teamSeats', used, now);
    } catch (err) {
      await TeamInviteModel.deleteOne({ _id: invite._id });
      throw err;
    }
  }

  await teamMailer.sendInvite({ to: email, teamName: team.name, inviterName: user.name, token, expiresAt });
  return inviteView(invite, now);
}

export async function inviteMember(user: TeamActor, email: string, now: Date = new Date()): Promise<TeamInviteView> {
  const state = await requireOwnedTeam(user.id);
  // Team sharing on the owner's plan: a lapsed owner sends no new invites.
  assertEntitled(user, 'teamSharing', now);

  if (email === user.email.toLowerCase()) throw ApiError.badRequest('That is your own email address.');
  const person = await UserModel.findOne({ email }).select('_id').lean();
  if (person && (await TeamMemberModel.exists({ team: state.team._id, user: person._id }))) {
    throw ApiError.conflict('That person is already in your team.');
  }
  return issueInvite(user, state, email, now);
}

export async function resendInvite(user: TeamActor, inviteId: string, now: Date = new Date()): Promise<TeamInviteView> {
  const state = await requireOwnedTeam(user.id);
  assertEntitled(user, 'teamSharing', now);
  const invite = await TeamInviteModel.findOne({ _id: inviteId, team: state.team._id }).select('email');
  if (!invite) throw ApiError.notFound('Invite not found');
  return issueInvite(user, state, invite.email, now);
}

/** Revoking is always allowed, also while the team is read-only: it only takes access away. */
export async function revokeInvite(user: TeamActor, inviteId: string): Promise<void> {
  const { team } = await requireOwnedTeam(user.id);
  const removed = await TeamInviteModel.deleteOne({ _id: inviteId, team: team._id });
  if (removed.deletedCount === 0) throw ApiError.notFound('Invite not found');
}

/* ------------------------------------------------------------------ *
 * Invites (invitee)
 * ------------------------------------------------------------------ */

async function findLiveInvite(token: string, now: Date): Promise<ITeamInvite> {
  const invite = await TeamInviteModel.findOne({ tokenHash: hashToken(token) });
  if (!invite) {
    throw new ApiError(404, 'This invite link is not valid. It may have been used or withdrawn.', TEAM_ERROR.INVITE_INVALID);
  }
  if (invite.expiresAt.getTime() <= now.getTime()) {
    throw new ApiError(410, 'This invite has expired. Ask the team owner to send a new one.', TEAM_ERROR.INVITE_EXPIRED);
  }
  return invite;
}

/** What the accept page shows. The token is the credential: only its holder gets this. */
export async function previewInvite(token: string, now: Date = new Date()): Promise<InvitePreview> {
  const invite = await findLiveInvite(token, now);
  const team = await TeamModel.findById(invite.team).lean();
  if (!team) {
    await TeamInviteModel.deleteOne({ _id: invite._id });
    throw new ApiError(404, 'This invite link is not valid. The team no longer exists.', TEAM_ERROR.INVITE_INVALID);
  }
  const inviter = await UserModel.findById(invite.invitedBy).select('name').lean();
  return {
    teamName: team.name,
    invitedBy: inviter?.name ?? 'The team owner',
    email: invite.email,
    expiresAt: iso(invite.expiresAt),
    readOnly: !(await isTeamWritable(team.owner)),
  };
}

/**
 * Joins the team. The signed-in account's email must be the one invited, and
 * verified. Members can be on any plan; the owner's plan decides the seats.
 */
export async function acceptInvite(user: TeamActor, token: string, now: Date = new Date()): Promise<TeamOverview> {
  const invite = await findLiveInvite(token, now);

  const account = await UserModel.findById(user.id).select('isVerified email').lean();
  if (!account) throw ApiError.unauthorized('User no longer exists');
  if (!account.isVerified) throw ApiError.forbidden('Verify your email address before joining a team.');
  if (account.email.toLowerCase() !== invite.email) {
    throw new ApiError(
      403,
      `This invite was sent to ${invite.email}. Sign in with that address to accept it.`,
      TEAM_ERROR.EMAIL_MISMATCH,
    );
  }

  const team = await TeamModel.findById(invite.team);
  if (!team) {
    await TeamInviteModel.deleteOne({ _id: invite._id });
    throw new ApiError(404, 'This invite link is not valid. The team no longer exists.', TEAM_ERROR.INVITE_INVALID);
  }
  const owner = await UserModel.findById(team.owner).select('plan trialEndsAt').lean();
  if (!owner || !hasEntitlement(owner, 'teamSharing', now)) {
    throw new ApiError(403, READ_ONLY_MESSAGE, TEAM_ERROR.READ_ONLY);
  }

  const current = await TeamMemberModel.findOne({ user: user.id }).lean();
  if (current) {
    if (String(current.team) === String(team._id)) {
      // Already in: the link is spent either way.
      await TeamInviteModel.deleteOne({ _id: invite._id });
      return getTeamOverview(user, now);
    }
    throw new ApiError(
      409,
      'You are already in a team. Leave it in Settings before joining another.',
      TEAM_ERROR.ALREADY_IN_TEAM,
    );
  }

  const members = await TeamMemberModel.countDocuments({ team: team._id });
  assertWithinLimit(owner, 'teamSeats', members + 1, now);

  let membership;
  try {
    membership = await TeamMemberModel.create({ team: team._id, user: user.id, role: 'member' });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // A double click: the same person's other request got in first. That is a success.
    const joined = await TeamMemberModel.findOne({ user: user.id }).lean();
    if (joined && String(joined.team) === String(team._id)) {
      await TeamInviteModel.deleteOne({ _id: invite._id });
      return getTeamOverview(user, now);
    }
    throw new ApiError(409, 'You are already in a team.', TEAM_ERROR.ALREADY_IN_TEAM);
  }
  // Two people accepting at the same moment can both pass the check above.
  try {
    assertWithinLimit(owner, 'teamSeats', await TeamMemberModel.countDocuments({ team: team._id }), now);
  } catch (err) {
    await TeamMemberModel.deleteOne({ _id: membership._id });
    throw err;
  }

  await TeamInviteModel.deleteOne({ _id: invite._id });
  return getTeamOverview(user, now);
}
