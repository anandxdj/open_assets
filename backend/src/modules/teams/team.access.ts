/**
 * Read-side helpers other modules use to ask "is this person in a team, and may
 * the team still be edited?". No writes and no imports from the collections
 * module, so collections can depend on this without a cycle.
 */
import { UserModel } from '../auth/auth.model';
import { hasEntitlement } from '../plans/entitlements';
import { TeamModel } from './team.model';
import type { ITeam } from './team.model';
import { TeamMemberModel } from './teamMember.model';
import type { TeamRole } from './teamMember.model';

/** Machine codes returned in the `code` field of team errors. */
export const TEAM_ERROR = {
  /** The owner's plan no longer includes team sharing: the team can be viewed and downloaded, not changed. */
  READ_ONLY: 'TEAM_READ_ONLY',
  ALREADY_IN_TEAM: 'TEAM_ALREADY_MEMBER',
  NO_TEAM: 'TEAM_NOT_FOUND',
  NOT_OWNER: 'TEAM_NOT_OWNER',
  OWNER_CANNOT_LEAVE: 'TEAM_OWNER_CANNOT_LEAVE',
  INVITE_INVALID: 'TEAM_INVITE_INVALID',
  INVITE_EXPIRED: 'TEAM_INVITE_EXPIRED',
  EMAIL_MISMATCH: 'TEAM_EMAIL_MISMATCH',
} as const;

export const READ_ONLY_MESSAGE =
  "This team is read-only because the owner's plan no longer includes team sharing. Members can still view and download.";

export interface TeamState {
  team: ITeam;
  role: TeamRole;
  /** False when the owner's effective plan lost `teamSharing`: nobody can edit and no invites go out. */
  writable: boolean;
}

/** True while the team owner's effective plan includes team sharing. Never reads the raw `user.plan`. */
export async function isTeamWritable(ownerId: unknown): Promise<boolean> {
  const owner = await UserModel.findById(ownerId).select('plan trialEndsAt').lean();
  return owner ? hasEntitlement(owner, 'teamSharing') : false;
}

/** The team a person is in (as owner or member), with whether it can still be edited. */
export async function getTeamState(userId: string): Promise<TeamState | null> {
  const membership = await TeamMemberModel.findOne({ user: userId }).lean();
  if (!membership) return null;
  const team = await TeamModel.findById(membership.team);
  if (!team) return null;
  return { team, role: membership.role, writable: await isTeamWritable(team.owner) };
}

/**
 * A person's standing in one specific team, or null when they are not in it.
 * Used by collection access checks, which already know the team id.
 */
export async function getMemberOfTeam(
  teamId: unknown,
  userId: string,
): Promise<{ role: TeamRole; writable: boolean } | null> {
  const membership = await TeamMemberModel.findOne({ team: teamId, user: userId }).lean();
  if (!membership) return null;
  const team = await TeamModel.findById(teamId).select('owner').lean();
  if (!team) return null;
  return { role: membership.role, writable: await isTeamWritable(team.owner) };
}
