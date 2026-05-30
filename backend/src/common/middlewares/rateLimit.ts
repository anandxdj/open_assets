import rateLimit from 'express-rate-limit';

/**
 * Rate limiting (SECURITY #5). `app.set('trust proxy', 1)` is set in app.ts,
 * so the client IP resolves correctly behind a single proxy.
 */

const FIFTEEN_MIN = 15 * 60 * 1000;

/**
 * Loose backstop across the whole `/api` surface. Kept generous on purpose:
 * the editor polls `GET /jobs/:id` every ~1.5s, so a tight cap would throttle
 * legitimate polling. Real protection lives in the stricter limiters below.
 */
export const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

/**
 * Strict limiter for brute-forceable auth + token-guessing endpoints
 * (login, register, forgot/reset password, verify/resend email).
 */
export const authLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again in 15 minutes.' },
});

/**
 * Cap upload-driven cost abuse (each upload fans out to Cloudinary + Gemini).
 */
export const uploadLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Upload limit reached, please try again later.' },
});
