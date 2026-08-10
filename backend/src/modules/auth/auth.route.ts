import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from './auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { authLimiter } from '../../common/middlewares/rateLimit';
import { registerSchema } from './dto/register.schema';
import { loginSchema } from './dto/login.schema';
import { forgotPasswordSchema } from './dto/forgot-password.schema';
import { resetPasswordSchema } from './dto/reset-password.schema';

const router = Router();

// SECURITY (#5): strict limiter on brute-forceable / token-guessing endpoints.
router.post('/register', authLimiter, validate(registerSchema), AuthController.register as any);
router.post('/login', authLimiter, validate(loginSchema), AuthController.login as any);
router.post('/refresh-token', AuthController.refreshToken as any);
router.post('/logout', AuthController.logout as any);
router.get('/verify-email/:token', authLimiter, AuthController.verifyEmail as any);
router.post('/resend-verification', authLimiter, AuthController.resendVerification as any);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), AuthController.forgotPassword as any);
router.put('/reset-password/:token', authLimiter, validate(resetPasswordSchema), AuthController.resetPassword as any);
router.get('/me', authenticate() as any, AuthController.me as any);

// Chrome extension device sessions. Browser login remains on the first-party web app;
// the extension exchanges a short-lived, PKCE-bound code for a revocable device token.
router.post('/extension/authorize', authenticate() as any, AuthController.extensionAuthorize as any);
router.post('/extension/token', AuthController.extensionToken as any);
router.post('/extension/refresh', AuthController.extensionRefresh as any);
router.delete('/extension/session/current', AuthController.extensionLogout as any);

// Google OAuth
router.get('/google', AuthController.googleLogin);
router.get('/google/callback', AuthController.googleCallback as any);

export default router;
