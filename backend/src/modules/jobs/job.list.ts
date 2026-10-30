import { ApiError } from '../../common/utils/ApiError';

/*
 * Pure helpers for GET /jobs: the page size and the paging cursor. Kept apart
 * from job.store.ts so they can be used (and tested) without a Redis client.
 */

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 100;

/**
 * Where a page ended: the creation time (ms) and id of its last job. Jobs sort
 * newest first by (createdAt, id) descending, so the next page is everything
 * strictly after this position. A position, unlike an offset, stays correct
 * when jobs are added, removed or expire between two page requests.
 */
export interface JobCursor {
  score: number;
  id: string;
}

const CURSOR_BODY = /^(\d{1,16})\|([A-Za-z0-9_-]{1,64})$/;

export function encodeCursor(cursor: JobCursor): string {
  return Buffer.from(`${cursor.score}|${cursor.id}`, 'utf8').toString('base64url');
}

/** Returns null for anything encodeCursor() could not have produced. */
export function decodeCursor(raw: string): JobCursor | null {
  if (raw.length > 120) return null;
  const match = CURSOR_BODY.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!match) return null;
  const score = Number(match[1]);
  const id = match[2] as string;
  return Number.isSafeInteger(score) && encodeCursor({ score, id }) === raw ? { score, id } : null;
}

/** True when `entry` comes after `cursor` in newest-first order. */
export function isAfterCursor(entry: JobCursor, cursor: JobCursor): boolean {
  return entry.score < cursor.score || (entry.score === cursor.score && entry.id < cursor.id);
}

export interface ListQuery {
  limit: number;
  cursor?: JobCursor;
}

/** Validates ?limit and ?cursor. Throws a 400 ApiError for a bad value. */
export function parseListQuery(query: Record<string, unknown>): ListQuery {
  const rawLimit = query['limit'];
  let limit = LIST_DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = typeof rawLimit === 'string' && /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > LIST_MAX_LIMIT) {
      throw ApiError.badRequest(`limit must be an integer from 1 to ${LIST_MAX_LIMIT}`);
    }
    limit = parsed;
  }

  const rawCursor = query['cursor'];
  if (rawCursor === undefined) return { limit };
  const cursor = typeof rawCursor === 'string' ? decodeCursor(rawCursor) : null;
  if (!cursor) throw ApiError.badRequest('cursor is not valid');
  return { limit, cursor };
}
