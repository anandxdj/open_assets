import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { isAccessTokenRevoked, verifyAccessToken } from '../../common/utils/jwt.utils';
import { UserModel } from './auth.model';
import type { IUser } from './auth.model';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    /** Plan fields, so entitlement checks need no second lookup. Use modules/plans. */
    plan?: IUser['plan'];
    trialEndsAt?: Date;
  };
}

export const authenticate = (optional = false) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      if (optional) return next();
      throw ApiError.unauthorized('Not authenticated');
    }

    const decoded = verifyAccessToken(token) as any;
    const user = await UserModel.findById(decoded.id);

    if (!user) {
      if (optional) return next();
      throw ApiError.unauthorized('User no longer exists');
    }

    // Signed out everywhere / password changed since this token was issued.
    if (isAccessTokenRevoked(decoded, user.tokensValidAfter)) {
      throw ApiError.unauthorized('Session was revoked');
    }

    req.user = {
      id: (user._id as any).toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
      trialEndsAt: user.trialEndsAt,
    };

    next();
  } catch (error) {
    if (optional) return next();
    next(ApiError.unauthorized('Invalid or expired token'));
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
};
