import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { accountLimiter } from '../../common/middlewares/rateLimit';
import { asyncHandler } from '../../common/utils/asyncHandler';
import {
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
} from './dto/account.schema';
import * as ctrl from './account.controller';

// Mounted at /api/account. Everything here acts on the signed-in user only, so
// authentication is applied once for the whole router.
const router = Router();

router.use(authenticate());

router.get('/', asyncHandler(ctrl.getAccount));
router.put('/profile', validate(updateProfileSchema), asyncHandler(ctrl.updateProfile));
router.put('/password', accountLimiter, validate(changePasswordSchema), asyncHandler(ctrl.changePassword));
router.post('/logout-all', accountLimiter, asyncHandler(ctrl.logoutEverywhere));

// Chrome extension device sessions (created by /api/auth/extension/token).
router.get('/extension-sessions', asyncHandler(ctrl.listExtensionSessions));
router.delete('/extension-sessions/:id', asyncHandler(ctrl.revokeExtensionSession));

router.delete('/', accountLimiter, validate(deleteAccountSchema), asyncHandler(ctrl.deleteAccount));

export { router as accountRouter };
