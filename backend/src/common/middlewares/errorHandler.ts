import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * Last middleware in the chain. Every failure is answered with
 * `{ success: false, message }`.
 *
 * Rules:
 * - The full error (with stack) is logged on the server, never sent in production.
 * - 4xx errors we recognise (our own ApiError, body-parser, multer, Mongoose
 *   validation) keep a short, safe message so clients can show it.
 * - Anything else is a 500 with a fixed message. A 5xx ApiError is masked in
 *   production too, because its message is written for logs, not users.
 * - Outside production, 5xx responses add the stack to speed up debugging.
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

interface Classified {
  status: number;
  message: string;
}

/** Narrow an unknown thrown value to something we can read fields from. */
function asRecord(err: unknown): Record<string, unknown> {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
}

function classify(err: unknown): Classified {
  if (err instanceof ApiError) {
    return { status: err.statusCode, message: err.message };
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

  return { status: 500, message: 'Internal Server Error' };
}

export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {
  // Headers already sent: Express must close the connection itself.
  if (res.headersSent) {
    next(err);
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const { status, message } = classify(err);

  if (status >= 500) {
    console.error(`[Unhandled Error] ${req.method} ${req.originalUrl.split('?')[0]}`, err);
  }

  const body: { success: false; message: string; stack?: string } = {
    success: false,
    message: status >= 500 ? 'Internal Server Error' : message,
  };
  if (status >= 500 && !isProduction && err instanceof Error && err.stack) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
};
