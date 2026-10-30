import type { Response } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import { sessionCookieOptions } from '../auth/auth.controller';
import * as accountService from './account.service';
import { objectIdSchema } from './dto/account.schema';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  UpdateProfileInput,
} from './dto/account.schema';

function requireUser(req: AuthRequest): { id: string } {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

// clearCookie must repeat the options the cookie was set with, minus maxAge.
function clearRefreshCookie(res: Response): void {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions;
  res.clearCookie('refreshToken', options);
}

export async function getAccount(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  ApiResponse.ok(res, 'Account', await accountService.getAccount(user.id));
}

export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const profile = await accountService.updateProfile(user.id, req.body as UpdateProfileInput);
  ApiResponse.ok(res, 'Profile updated', profile);
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const { accessToken, refreshToken, passwordWasSet, extensionSessionsRevoked } =
    await accountService.changePassword(user.id, req.body as ChangePasswordInput);

  // The caller keeps their own session: swap in the rotated refresh token.
  res.cookie('refreshToken', refreshToken, sessionCookieOptions);
  ApiResponse.ok(res, passwordWasSet ? 'Password set' : 'Password changed', {
    accessToken,
    extensionSessionsRevoked,
  });
}

export async function logoutEverywhere(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await accountService.logoutEverywhere(user.id);
  clearRefreshCookie(res);
  ApiResponse.ok(res, 'Signed out of all devices', result);
}

export async function listExtensionSessions(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  ApiResponse.ok(res, 'Extension sessions', await accountService.listExtensionSessions(user.id));
}

export async function revokeExtensionSession(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const parsed = objectIdSchema.safeParse(req.params['id']);
  if (!parsed.success) throw ApiError.badRequest('Invalid session id');
  await accountService.revokeExtensionSession(user.id, parsed.data);
  ApiResponse.ok(res, 'Extension session revoked');
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const { confirmation } = req.body as DeleteAccountInput;
  const result = await accountService.deleteAccount(user.id, confirmation);
  clearRefreshCookie(res);
  ApiResponse.ok(res, 'Account deleted', result);
}
