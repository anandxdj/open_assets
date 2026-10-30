import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../../common/utils/ApiError';

/**
 * The machine-readable `code` every non-5xx error from `/api/v1` carries.
 * The web app's errors only have a code where the client needs to branch on
 * it; here a code is part of the contract, so the ones the existing services
 * leave out are filled in by status (see DEFAULT_CODE_BY_STATUS).
 *
 * 5xx answers keep the shared `{ success: false, message }` body with no code:
 * they are never something a client can act on except by retrying.
 */
export const V1_ERROR_CODES = [
  'API_KEY_MISSING', // 401  no `Authorization: Bearer` header
  'API_KEY_INVALID', // 401  not a key we issued (a session token is not one)
  'API_KEY_REVOKED', // 401  revoked in Settings
  'PLAN_REQUIRED', //   403  the account's Pro plan lapsed, or a Pro-only option was used
  'PLAN_LIMIT', //      403  a plan limit would be exceeded (scale above maxUpscale)
  'SHEET_LIMIT', //     403  the monthly sheet allowance is used up
  'FORBIDDEN', //       403
  'JOB_NOT_FOUND', //   404  unknown job, or one that belongs to someone else
  'NOT_FOUND', //       404  unknown route
  'INVALID_JOB_STATE', // 409 the job is not in the state this call needs
  'JOB_NOT_READY', //   409  download asked for before the export finished
  'VALIDATION_ERROR', // 400 request body or parameters failed validation
  'IMAGE_REQUIRED', //  400  no `image` file in the upload
  'INVALID_IMAGE', //   400  wrong format or size
  'INVALID_PATTERN', // 400  the naming pattern is not valid
  'INVALID_JSON', //    400  body is not valid JSON
  'INVALID_UPLOAD', //  400  malformed multipart request
  'BAD_REQUEST', //     400  anything else
  'FILE_TOO_LARGE', //  413  image over 20 MB
  'PAYLOAD_TOO_LARGE', // 413 JSON body over 100 KB
  'UNSUPPORTED_FILE_TYPE', // 415 not an image
  'RATE_LIMITED', //    429  too many requests for this key
  'EXPORT_FETCH_FAILED', // 502 the stored assets could not be fetched to build the ZIP
] as const;

export type V1ErrorCode = (typeof V1_ERROR_CODES)[number];

const DEFAULT_CODE_BY_STATUS: Record<number, V1ErrorCode> = {
  400: 'BAD_REQUEST',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_JOB_STATE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_FILE_TYPE',
  429: 'RATE_LIMITED',
};

/** A coded v1 error. Prefer this over the generic ApiError helpers inside the v1 module. */
export function v1Error(
  status: number,
  code: V1ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(status, message, code, details);
}

function asRecord(err: unknown): Record<string, unknown> {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
}

/** Gives an error a v1 code: keeps one it already has, maps library errors, else falls back to its status. */
export function withV1Code(err: unknown): unknown {
  if (err instanceof ApiError) {
    if (!err.code) {
      const code = DEFAULT_CODE_BY_STATUS[err.statusCode];
      if (code) err.code = code;
    }
    return err;
  }

  const e = asRecord(err);
  if (e['name'] === 'MulterError') {
    return e['code'] === 'LIMIT_FILE_SIZE'
      ? v1Error(413, 'FILE_TOO_LARGE', 'The image is larger than 20 MB.')
      : v1Error(400, 'INVALID_UPLOAD', 'Send the sheet as multipart/form-data with one file in the "image" field.');
  }
  if (e['type'] === 'entity.too.large') return v1Error(413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than 100 KB.');
  if (e['type'] === 'entity.parse.failed') return v1Error(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  return err;
}

/**
 * Error middleware for `/api/v1`, mounted at app level right after the router
 * so it also sees what the body parser throws before the router runs. It only
 * adds the code; the shared errorHandler still writes the response.
 */
export const v1ErrorCodes: ErrorRequestHandler = (err, _req, _res, next) => {
  next(withV1Code(err));
};
