import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

const isProduction = process.env.NODE_ENV === 'production';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || (isProduction ? '' : 'access-secret');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (isProduction ? '' : 'refresh-secret');

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  if (isProduction) {
    throw new Error('JWT secrets must be set in production!');
  }
}

const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export const generateAccessToken = (payload: object) => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN as any,
  });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, JWT_ACCESS_SECRET) as any;
};

export const generateRefreshToken = (payload: object) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN as any,
  });
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as any;
};

export const generateResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  return { rawToken, hashedToken };
};

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
