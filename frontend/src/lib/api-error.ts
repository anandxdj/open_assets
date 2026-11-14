/**
 * An API failure that keeps what the server said. `message` is the human text;
 * `code` is the machine code (for example PLAN_REQUIRED or SHEET_LIMIT) and
 * `details` carries structured context (limit, resetAt, ...). It extends Error,
 * so callers that only read `.message` keep working.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ErrorBody = { message?: string; code?: string; details?: Record<string, unknown> } | null | undefined;

export function apiErrorFrom(status: number, body: unknown): ApiRequestError {
  const b = (body ?? {}) as NonNullable<ErrorBody>;
  return new ApiRequestError(b.message ?? `HTTP ${status}`, status, b.code, b.details);
}
