import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { verifyAccessToken } from '../../common/utils/jwt.utils';
import { UserModel } from './auth.model';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
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

    req.user = {
      id: (user._id as any).toString(),
      email: user.email,
      name: user.name,
      role: user.role,
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
