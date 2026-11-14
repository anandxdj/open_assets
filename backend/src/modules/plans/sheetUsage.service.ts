import { ApiError } from '../../common/utils/ApiError';
import { PLAN_ERROR } from './entitlements';
import { SheetUsageModel } from './sheetUsage.model';

/** `YYYY-MM` in UTC. Months, limits and reset dates are all UTC. */
export function periodKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First instant of the next UTC month: when the allowance resets. */
export function nextResetDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface SheetReservation {
  userId: string;
  period: string;
  /** Sheets used this month, including this one. */
  used: number;
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function getSheetsUsed(userId: string, now: Date = new Date()): Promise<number> {
  const row = await SheetUsageModel.findOne({ userId, period: periodKey(now) }).select('count').lean();
  return row?.count ?? 0;
}

/**
 * Atomically takes one sheet from this month's allowance.
 *
 * The check and the increment are one findOneAndUpdate whose filter only
 * matches while `count < limit`, so N parallel uploads against a limit of L
 * produce exactly L successes. The first upload of a month upserts the row;
 * when two of those race, the unique index rejects the loser with E11000, and
 * the loser retries as a plain (non-upsert) conditional increment against the
 * row that now exists.
 *
 * `limit === null` means unlimited: usage is still counted.
 * Returns null when the limit is reached; the caller turns that into
 * SHEET_LIMIT. Pair every success with releaseSheet() if the upload fails.
 */
export async function tryReserveSheet(
  userId: string,
  limit: number | null,
  now: Date = new Date(),
): Promise<SheetReservation | null> {
  const period = periodKey(now);
  const filter = limit === null ? { userId, period } : { userId, period, count: { $lt: limit } };
  const update = { $inc: { count: 1 } };

  let row;
  try {
    row = await SheetUsageModel.findOneAndUpdate(filter, update, { upsert: true, new: true });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Lost the create race, or the row is already at the limit (the upsert then
    // tried to insert a duplicate). Either way the row exists: one more
    // conditional increment decides.
    row = await SheetUsageModel.findOneAndUpdate(filter, update, { new: true });
  }
  if (!row) return null;
  return { userId, period, used: row.count };
}

/** Throws 403 SHEET_LIMIT (with the reset date) when the allowance is used up. */
export async function reserveSheet(
  userId: string,
  limit: number | null,
  now: Date = new Date(),
): Promise<SheetReservation> {
  const reservation = await tryReserveSheet(userId, limit, now);
  if (reservation) return reservation;
  throw sheetLimitError(limit ?? 0, await getSheetsUsed(userId, now), now);
}

export function sheetLimitError(limit: number, used: number, now: Date = new Date()): ApiError {
  const resetAt = nextResetDate(now);
  return new ApiError(
    403,
    `You have used all ${limit} sheets this month. Your allowance resets on ${resetAt.toISOString().slice(0, 10)}. Pro has no sheet limit.`,
    PLAN_ERROR.SHEET_LIMIT,
    { entitlement: 'sheetsPerMonth', limit, used, resetAt: resetAt.toISOString(), requiredPlan: 'pro' },
  );
}

/** Gives a reserved sheet back (upload failed before a job existed). Never goes below zero. */
export async function releaseSheet(reservation: Pick<SheetReservation, 'userId' | 'period'>): Promise<void> {
  await SheetUsageModel.updateOne(
    { userId: reservation.userId, period: reservation.period, count: { $gt: 0 } },
    { $inc: { count: -1 } },
  );
}
