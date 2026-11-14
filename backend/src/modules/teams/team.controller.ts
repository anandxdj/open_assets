import type { Response } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { AuthRequest } from '../auth/auth.middleware';
import { inviteTokenParam, objectIdParam } from './dto/team.schema';
import type { CreateTeamInput, InviteInput } from './dto/team.schema';
import * as service from './team.service';
import type { TeamActor } from './team.service';

function requireUser(req: AuthRequest): TeamActor {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  return req.user;
}

function idParam(req: AuthRequest, name: string, label: string): string {
  const parsed = objectIdParam.safeParse(req.params[name]);
  if (!parsed.success) throw ApiError.badRequest(`Invalid ${label}`);
  return parsed.data;
}

function tokenParam(req: AuthRequest): string {
  const parsed = inviteTokenParam.safeParse(req.params['token']);
  // Same answer as an unknown token, so the shape of a valid one is not revealed.
  if (!parsed.success) throw new ApiError(404, 'This invite link is not valid.', 'TEAM_INVITE_INVALID');
  return parsed.data;
}

export async function getTeam(req: AuthRequest, res: Response): Promise<void> {
  ApiResponse.ok(res, 'Team', await service.getTeamOverview(requireUser(req)));
}

export async function createTeam(req: AuthRequest, res: Response): Promise<void> {
  const { name } = req.body as CreateTeamInput;
  ApiResponse.created(res, 'Team created', await service.createTeam(requireUser(req), name));
}

export async function renameTeam(req: AuthRequest, res: Response): Promise<void> {
  const { name } = req.body as CreateTeamInput;
  ApiResponse.ok(res, 'Team renamed', await service.renameTeam(requireUser(req), name));
}

export async function dissolveTeam(req: AuthRequest, res: Response): Promise<void> {
  await service.dissolveTeam(requireUser(req));
  ApiResponse.ok(res, 'Team dissolved', null);
}

export async function inviteMember(req: AuthRequest, res: Response): Promise<void> {
  const { email } = req.body as InviteInput;
  ApiResponse.created(res, 'Invite sent', await service.inviteMember(requireUser(req), email));
}

export async function resendInvite(req: AuthRequest, res: Response): Promise<void> {
  ApiResponse.ok(res, 'Invite sent again', await service.resendInvite(requireUser(req), idParam(req, 'id', 'invite id')));
}

export async function revokeInvite(req: AuthRequest, res: Response): Promise<void> {
  await service.revokeInvite(requireUser(req), idParam(req, 'id', 'invite id'));
  ApiResponse.ok(res, 'Invite withdrawn', null);
}

export async function removeMember(req: AuthRequest, res: Response): Promise<void> {
  await service.removeMember(requireUser(req), idParam(req, 'userId', 'member id'));
  ApiResponse.ok(res, 'Member removed', null);
}

export async function leaveTeam(req: AuthRequest, res: Response): Promise<void> {
  await service.leaveTeam(requireUser(req));
  ApiResponse.ok(res, 'You left the team', null);
}

export async function previewInvite(req: AuthRequest, res: Response): Promise<void> {
  ApiResponse.ok(res, 'Invite', await service.previewInvite(tokenParam(req)));
}

export async function acceptInvite(req: AuthRequest, res: Response): Promise<void> {
  ApiResponse.ok(res, 'You joined the team', await service.acceptInvite(requireUser(req), tokenParam(req)));
}
