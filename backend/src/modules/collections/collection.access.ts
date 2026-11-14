/**
 * Who may do what with a collection. Every collection route asks this module;
 * nothing compares `creator` to the requester on its own any more.
 *
 *   owner        the creator. Views, edits and manages (rename, publish, delete,
 *                share with the team), whatever their plan.
 *   team member  in the team the collection is shared with. Views and downloads;
 *                edits folders and images while the team owner's plan still
 *                includes team sharing. Never manages.
 *   anyone       views and downloads a published community pack.
 *   everyone else: nothing (403).
 *
 * Editing means folders and images. Rename, description, tags, publishing,
 * deleting the collection and moving it in or out of the team are "manage":
 * owner only.
 */
import { ApiError } from '../../common/utils/ApiError';
import { READ_ONLY_MESSAGE, TEAM_ERROR, getMemberOfTeam } from '../teams/team.access';

export interface AccessSubject {
  creator: unknown;
  teamId?: unknown;
  isPublic?: boolean;
}

export type AccessVia = 'owner' | 'team' | 'public' | 'none';

export interface CollectionAccess {
  view: boolean;
  edit: boolean;
  manage: boolean;
  via: AccessVia;
  /** The caller is a team member and edit is off only because the team is read-only. */
  teamReadOnly: boolean;
}

const NONE: CollectionAccess = { view: false, edit: false, manage: false, via: 'none', teamReadOnly: false };

/** An ObjectId, a populated document (`{ _id }`) or a string, as a string. */
export function idOf(value: unknown): string {
  if (value && typeof value === 'object' && '_id' in value) return String((value as { _id: unknown })._id);
  return String(value);
}

export async function resolveCollectionAccess(
  collection: AccessSubject,
  userId: string | undefined,
): Promise<CollectionAccess> {
  if (userId && collection.creator && idOf(collection.creator) === userId) {
    return { view: true, edit: true, manage: true, via: 'owner', teamReadOnly: false };
  }

  if (userId && collection.teamId) {
    const member = await getMemberOfTeam(collection.teamId, userId);
    if (member) {
      return { view: true, edit: member.writable, manage: false, via: 'team', teamReadOnly: !member.writable };
    }
  }

  if (collection.isPublic) return { ...NONE, view: true, via: 'public' };
  return NONE;
}

/** The same decision as a shape the API returns with each collection. */
export function accessSummary(access: CollectionAccess) {
  return { canEdit: access.edit, canManage: access.manage, via: access.via, teamReadOnly: access.teamReadOnly };
}

export function assertCanView(access: CollectionAccess): void {
  if (!access.view) throw ApiError.forbidden('This collection is private');
}

/** Folders and images. 403 TEAM_READ_ONLY when the only thing missing is the owner's plan. */
export function assertCanEdit(access: CollectionAccess): void {
  if (access.edit) return;
  if (!access.view) throw ApiError.forbidden('Not your collection');
  if (access.teamReadOnly) throw new ApiError(403, READ_ONLY_MESSAGE, TEAM_ERROR.READ_ONLY);
  throw ApiError.forbidden('You can view this collection but not edit it');
}

/** Rename, publish, delete, share: the owner only. */
export function assertCanManage(access: CollectionAccess): void {
  if (access.manage) return;
  if (!access.view) throw ApiError.forbidden('Not your collection');
  throw ApiError.forbidden('Only the collection owner can do this');
}
