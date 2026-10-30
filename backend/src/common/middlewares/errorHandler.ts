import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * Last middleware in the chain. Every failure is answered with
 * `{ success: false, message }`, plus `code` and `details` when the error carries them.
 *
 * Rules:
 * - The full error (with stack) is logged on the server, never sent in production.
 * - An ApiError is deliberate: its status, message and optional machine-readable `code`
 *   (for example 503 STORAGE_NOT_CONFIGURED) reach the client unchanged. The one
 *   exception is a plain 500 (`ApiError.internal`), whose message is written for logs,
 *   not users, so it is replaced by a fixed one.
 * - Errors from libraries we recognise (body-parser, multer, Mongoose) become 4xx with
 *   a short fixed message.
 * - Anything else is a 500 with a fixed message.
 * - Outside production, a 500 adds the stack to speed up debugging.
 */

const GENERIC: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable entity',
  429: 'Too many requests',
};

const INTERNAL = 'Internal Server Error';

interface Classified {
  status: number;
  message: string;
  code?: string;
  /** Structured context a deliberate ApiError carries (for example a plan limit and its reset date). */
  details?: Record<string, unknown>;
}

/** Narrow an unknown thrown value to something we can read fields from. */
function asRecord(err: unknown): Record<string, unknown> {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
}

function classify(err: unknown): Classified {
  if (err instanceof ApiError) {
    if (err.statusCode === 500) return { status: 500, message: INTERNAL };
    return {
      status: err.statusCode,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    };
  }

  const e = asRecord(err);
  const name = typeof e['name'] === 'string' ? e['name'] : '';
  const code = e['code'];

  // multer
  if (name === 'MulterError') {
    if (code === 'LIMIT_FILE_SIZE') return { status: 413, message: 'File is too large' };
    return { status: 400, message: typeof e['message'] === 'string' ? e['message'] : 'Invalid upload' };
  }

  // body-parser (express.json)
  if (e['type'] === 'entity.too.large') return { status: 413, message: 'Request body is too large' };
  if (e['type'] === 'entity.parse.failed') return { status: 400, message: 'Request body is not valid JSON' };

  // Mongoose
  if (name === 'CastError') return { status: 400, message: 'Invalid identifier' };
  if (name === 'ValidationError') return { status: 400, message: 'Validation failed' };
  if (code === 11000) return { status: 409, message: 'Already exists' };

  // http-errors style (anything else that carries a client status and is safe to expose)
  const status = Number(e['statusCode'] ?? e['status']);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return { status, message: GENERIC[status] ?? 'Bad request' };
  }

  return { status: 500, message: INTERNAL };
}

export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {
  // Headers already sent: Express must close the connection itself.
  if (res.headersSent) {
    next(err);
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const { status, message, code, details } = classify(err);

  // Deliberate 502/503 ApiErrors are expected conditions the thrower already handled;
  // everything else that ends in a 500 is a bug or an outage worth a log line.
  if (status === 500) {
    console.error(`[Unhandled Error] ${req.method} ${req.originalUrl.split('?')[0]}`, err);
  }

  const body: { success: false; message: string; code?: string; details?: Record<string, unknown>; stack?: string } = {
    success: false,
    message,
  };
  if (code) body.code = code;
  if (details) body.details = details;
  if (status === 500 && !isProduction && err instanceof Error && err.stack) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
};
