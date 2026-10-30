import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../auth/auth.middleware';
import type { AuthRequest } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { requireEntitlement } from '../plans/plans.middleware';
import { createTeamSchema, inviteSchema, renameTeamSchema } from './dto/team.schema';
import * as ctrl from './team.controller';

const FIFTEEN_MIN = 15 * 60 * 1000;

/** Every invite sends an email to an address the owner typed, so sending is capped per owner. */
const inviteSendLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
  message: { success: false, message: 'Too many invites, please try again in a few minutes.' },
});

/** Invite links are secrets: looking one up or accepting it is capped per address. */
const inviteLinkLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again in a few minutes.' },
});

// Mounted at /api/team.
const router = Router();

// The invitee's side. The link is the credential, so the preview needs no session;
// accepting does, and also checks that the account's email is the invited one.
router.get('/invite/:token', inviteLinkLimiter, asyncHandler(ctrl.previewInvite));
router.post('/invite/:token/accept', inviteLinkLimiter, authenticate(), asyncHandler(ctrl.acceptInvite));

// Everything below acts on the signed-in user's own team.
router.use(authenticate());

router.get('/', asyncHandler(ctrl.getTeam));
router.post('/', requireEntitlement('teamSharing'), validate(createTeamSchema), asyncHandler(ctrl.createTeam));
router.put('/', validate(renameTeamSchema), asyncHandler(ctrl.renameTeam));
router.delete('/', asyncHandler(ctrl.dissolveTeam));

router.post('/invites', inviteSendLimiter, validate(inviteSchema), asyncHandler(ctrl.inviteMember));
router.post('/invites/:id/resend', inviteSendLimiter, asyncHandler(ctrl.resendInvite));
router.delete('/invites/:id', asyncHandler(ctrl.revokeInvite));

router.delete('/members/:userId', asyncHandler(ctrl.removeMember));
router.post('/leave', asyncHandler(ctrl.leaveTeam));

export { router as teamRouter };
