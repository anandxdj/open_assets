import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import { verifyAccessToken } from '../../common/utils/jwt.utils';
import type { AuthRequest } from './auth.middleware';

const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.register(req.body);
      return ApiResponse.created(res, 'Registration successful. Please verify your email.', user);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { user, accessToken, refreshToken } = await AuthService.login(req.body);

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', refreshToken, sessionCookieOptions);

      return ApiResponse.ok(res, 'Login successful', { user, accessToken });
    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      const { accessToken } = await AuthService.refresh(token);
      return ApiResponse.ok(res, 'Token refreshed', { accessToken });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      if (token) {
        await AuthService.logoutByToken(token);
      }
      
      res.clearCookie('refreshToken', sessionCookieOptions);
      return ApiResponse.ok(res, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  static async resendVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      if (!email) {
        throw ApiError.badRequest('Email is required');
      }
      await AuthService.resendVerification(email);
      return ApiResponse.ok(res, 'Verification email resent');
    } catch (error) {
      next(error);
    }
  }

  static async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.verifyEmail(req.params.token as string);
      return ApiResponse.ok(res, 'Email verified successfully');
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.forgotPassword(req.body.email);
      return ApiResponse.ok(res, 'Password reset email sent');
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.resetPassword(req.params.token as string, req.body.password);
      return ApiResponse.ok(res, 'Password reset successful');
    } catch (error) {
      next(error);
    }
  }

  static async me(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return ApiResponse.ok(res, 'No active session', null);
      }
      const user = await AuthService.getMe(req.user.id);
      return ApiResponse.ok(res, 'User profile fetched', user);
    } catch (error) {
      next(error);
    }
  }

  static async googleLogin(req: Request, res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (!clientId || !clientSecret) {
      const errorMsg = 'Google OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the backend env file.';
      return res.redirect(`${frontendUrl}/callback?error=${encodeURIComponent(errorMsg)}`);
    }

    const url = AuthService.getGoogleAuthUrl();
    res.redirect(url);
  }

  static async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.query;
      if (!code) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=Google authentication failed`);
      }

      const { user, accessToken, refreshToken } = await AuthService.handleGoogleCallback(code as string);

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', refreshToken, sessionCookieOptions);

      // SECURITY (#7): deliver the access token in the URL *fragment*, not the
      // query string. Fragments are never sent to servers, so the token stays
      // out of access logs, Referer headers and proxy/CDN logs. The frontend
      // reads it from window.location.hash and clears it immediately.
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      console.log('[Auth] Redirecting to frontend callback');
      res.redirect(`${frontendUrl}/callback#token=${encodeURIComponent(accessToken)}`);
    } catch (error: any) {
      console.error('Google callback error:', error);
      const errorMessage = error.message || 'Google authentication failed';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(errorMessage)}`);
    }
  }
}
