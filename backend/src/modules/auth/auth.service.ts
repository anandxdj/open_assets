import axios from 'axios';
import { UserModel } from './auth.model';
import type { IUser } from './auth.model';
import { ApiError } from '../../common/utils/ApiError';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateResetToken,
  hashToken,
} from '../../common/utils/jwt.utils';

import { sendVerificationEmail, sendResetPasswordEmail } from '../../common/config/email';

export class AuthService {
  static async register(userData: Partial<IUser>) {
    const { email, name, password } = userData;

    if (!email || !name || !password) {
      throw ApiError.badRequest('Email, name, and password are required');
    }

    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      throw ApiError.conflict('Email already registered');
    }

    const { rawToken, hashedToken } = generateResetToken();

    const user = await UserModel.create({
      email,
      name,
      password,
      // SECURITY (#1): role is always 'user' at signup — never taken from client input.
      role: 'user',
      verificationToken: hashedToken,
      isVerified: false,
    });

    try {
      await sendVerificationEmail(email, rawToken);
    } catch (error: any) {
      console.error('Failed to send verification email:', error.message);
    }

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.verificationToken;
    return userObj;
  }

  static async login(credentials: { email?: string; password?: string }) {
    const { email, password } = credentials;

    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required');
    }

    const user = await UserModel.findOne({ email }).select('+password');
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isVerified) {
      throw ApiError.forbidden('Please verify your email before logging in');
    }

    const accessToken = generateAccessToken({ 
      id: user._id, 
      email: user.email, 
      name: user.name, 
      role: user.role 
    });
    const refreshToken = generateRefreshToken({ id: user._id });

    // Store hashed refresh token in DB
    user.refreshToken = hashToken(refreshToken);
    user.lastLogin = new Date();
    await user.save();

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    return { user: userObj, accessToken, refreshToken };
  }

  static async refresh(token?: string) {
    if (!token) {
      throw ApiError.unauthorized('Refresh token missing');
    }

    try {
      const decoded = verifyRefreshToken(token) as any;
      const user = await UserModel.findById(decoded.id).select('+refreshToken');

      if (!user || user.refreshToken !== hashToken(token)) {
        throw ApiError.unauthorized('Invalid refresh token — please log in again');
      }

      const accessToken = generateAccessToken({ 
        id: user._id, 
        email: user.email, 
        name: user.name, 
        role: user.role 
      });
      return { accessToken };
    } catch (error) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }
  }

  static async logout(userId: string) {
    await UserModel.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
  }

  static async logoutByToken(token: string) {
    const hashedToken = hashToken(token);
    await UserModel.findOneAndUpdate({ refreshToken: hashedToken }, { $unset: { refreshToken: 1 } });
  }

  static async resendVerification(email: string) {
    const user = await UserModel.findOne({ email }).select('+isVerified');
    if (!user) {
      throw ApiError.notFound('No account with that email');
    }

    if (user.isVerified) {
      throw ApiError.badRequest('Email is already verified');
    }

    const { rawToken, hashedToken } = generateResetToken();
    user.verificationToken = hashedToken;
    await user.save();

    try {
      await sendVerificationEmail(email, rawToken);
    } catch (error: any) {
      console.error('Failed to resend verification email:', error.message);
    }
  }

  static async verifyEmail(token: string) {
    const trimmedToken = String(token).trim();
    if (!trimmedToken) {
      throw ApiError.badRequest('Invalid or expired verification token');
    }

    const hashedInput = hashToken(trimmedToken);

    // SECURITY (#12): match the hashed token only. The previous raw-token
    // fallback defeated storing only the hash — anyone who could read the DB
    // could verify accounts directly.
    const user = await UserModel.findOne({ verificationToken: hashedInput }).select('+verificationToken');

    if (!user) {
      throw ApiError.badRequest('Invalid or expired verification token');
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    return user;
  }

  static async forgotPassword(email: string) {
    const user = await UserModel.findOne({ email });
    if (!user) {
      throw ApiError.notFound('No account with that email');
    }

    const { rawToken, hashedToken } = generateResetToken();

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await user.save();

    try {
      await sendResetPasswordEmail(email, rawToken);
    } catch (error: any) {
      console.error('Failed to send reset email:', error.message);
    }
  }

  static async resetPassword(token: string, newPassword: string) {
    const hashedToken = hashToken(token);

    const user = await UserModel.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw ApiError.badRequest('Invalid or expired reset token');
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
  }

  static async getMe(userId: string) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    return user;
  }

  static getGoogleAuthUrl() {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CALLBACK_URL || '',
      client_id: process.env.GOOGLE_CLIENT_ID!,
      access_type: 'offline',
      response_type: 'code',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' '),
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
  }

  static async handleGoogleCallback(code: string) {
    const url = 'https://oauth2.googleapis.com/token';
    const values = {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CALLBACK_URL || '',
      grant_type: 'authorization_code',
    };

    try {
      const res = await axios.post(url, new URLSearchParams(values), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token } = res.data;

      // Fetch user info from Google
      const googleUserRes = await axios.get(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      );

      const googleUser = googleUserRes.data;

      if (!googleUser.email_verified && !googleUser.verified_email) {
        throw ApiError.forbidden('Google account is not verified');
      }

      let user = await UserModel.findOne({ email: googleUser.email });

      if (!user) {
        user = await UserModel.create({
          email: googleUser.email,
          name: googleUser.name || googleUser.given_name,
          picture: googleUser.picture,
          isVerified: true,
          role: 'user',
          sub: googleUser.sub,
        });
      } else {
        user.name = googleUser.name || googleUser.given_name;
        user.picture = googleUser.picture;
        user.isVerified = true;
        user.lastLogin = new Date();
        user.sub = googleUser.sub;
        await user.save();
      }

      const accessToken = generateAccessToken({ 
        id: user._id, 
        email: user.email, 
        name: user.name, 
        role: user.role 
      });
      const refreshToken = generateRefreshToken({ id: user._id });

      user.refreshToken = hashToken(refreshToken);
      await user.save();

      return { user, accessToken, refreshToken };
    } catch (error: any) {
      // SECURITY (#11): log the provider detail server-side only; never echo it
      // to the client (it can carry tokens/internal error strings).
      const detail = error.response?.data?.error_description || error.response?.data?.error || error.message;
      console.error('[auth] Google OAuth error (server-only detail):', detail);
      throw ApiError.unauthorized('Google authentication failed');
    }
  }
}
