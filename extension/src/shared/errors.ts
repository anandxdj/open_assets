/**
 * API failures as the extension sees them. The API answers every error with
 * `{ success: false, message, code?, details? }` (backend errorHandler); the
 * worker keeps the `code` so the panel can tell a plan limit from any other
 * failure instead of parsing the message.
 */

/** Plan-limit codes of the backend (`PLAN_ERROR` in backend/src/modules/plans/entitlements.ts). */
export const PLAN_LIMIT_CODES = ['SHEET_LIMIT', 'PLAN_LIMIT', 'PLAN_REQUIRED'] as const;
export type PlanLimitCode = (typeof PLAN_LIMIT_CODES)[number];

export function isPlanLimitCode(code: unknown): code is PlanLimitCode {
  return typeof code === 'string' && (PLAN_LIMIT_CODES as readonly string[]).includes(code);
}

/** An error answered by the API, with its HTTP status and machine-readable code. */
export class ApiFailure extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Builds the failure for a non-2xx response body; `fallback` is used when the body has no message. */
export function failureFromResponse(status: number, payload: unknown, fallback: string): ApiFailure {
  const body = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  return new ApiFailure(readString(body.message) ?? fallback, status, readString(body.code));
}

/** What the worker answers when a request fails. `code` is present only for API failures that carry one. */
export interface WorkerFailure {
  ok: false;
  error: string;
  code?: string;
}

export function toWorkerError(error: unknown): WorkerFailure {
  if (error instanceof ApiFailure) {
    return error.code ? { ok: false, error: error.message, code: error.code } : { ok: false, error: error.message };
  }
  return { ok: false, error: error instanceof Error ? error.message : 'Unexpected extension error.' };
}

/** The web app's plans page. */
export function pricingUrl(frontendUrl: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/pricing`;
}
