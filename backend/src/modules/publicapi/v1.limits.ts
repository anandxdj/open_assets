import rateLimit from 'express-rate-limit';
import type { Options, RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { v1Error } from './v1.errors';
import type { ApiKeyRequest } from './v1.auth';

/**
 * Public API rate limits. Every limit is per API key, not per IP: a customer's
 * servers share addresses, and two keys of one account are limited separately.
 * Counters live in this process's memory, like the rest of the API's limiters,
 * so with several API instances the effective limit is per instance.
 */
export const V1_LIMITS = {
  /** Every request, on every route. Polling a job every 2 s is 30 a minute. */
  requestsPerMinute: 120,
  /** Requests that start work: upload a sheet, crop, export. Each one costs storage and AI calls. */
  startsPer15Minutes: 60,
  /** Failed key attempts (401) per IP. Keys carry 192 bits, so this is about noise, not about guessing. */
  failedAuthPer15Minutes: 100,
} as const;

const MINUTE = 60 * 1000;
const FIFTEEN_MINUTES = 15 * MINUTE;

function limited(message: string): Options['handler'] {
  return (req: Request, res: Response, next) => {
    const resetTime = (req as Request & { rateLimit?: { resetTime?: Date; limit?: number } }).rateLimit?.resetTime;
    const retryAfter = Math.max(1, Math.ceil(((resetTime?.getTime() ?? Date.now() + MINUTE) - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    next(v1Error(429, 'RATE_LIMITED', message, { retryAfterSeconds: retryAfter }));
  };
}

/**
 * Runs first, before the key is even looked up: counts requests from one IP
 * that were answered 401. Requests that authenticate are not counted.
 */
export const failedAuthLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: V1_LIMITS.failedAuthPer15Minutes,
  standardHeaders: false,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  handler: limited('Too many failed attempts with an invalid API key. Try again in a few minutes.'),
});

const keyId = (req: Request) => (req as ApiKeyRequest).apiKey?.id ?? req.ip ?? 'unknown';

/** All routes, after authentication. Sends `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. */
export const requestLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: MINUTE,
  limit: V1_LIMITS.requestsPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyId,
  handler: limited(`Rate limit reached: ${V1_LIMITS.requestsPerMinute} requests a minute per API key. Retry after the time in Retry-After.`),
});

/** Routes that start work, on top of requestLimiter. */
export const startLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: V1_LIMITS.startsPer15Minutes,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: keyId,
  handler: limited(
    `Rate limit reached: ${V1_LIMITS.startsPer15Minutes} uploads, crops and exports per 15 minutes per API key. Retry after the time in Retry-After.`,
  ),
});
