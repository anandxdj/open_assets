import { authedFetch, requireAccount } from './auth';
import { failureFromResponse } from './errors';
import { applyJobCheck, isInProgress, type JobCheck } from './sent';
import { getAuth, getSnapshot, updateSent } from './storage';

function httpUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined;
}

/** Asks the API about one job (the same call the editor polls). A 404 or 403 means it is gone or not this account's. */
async function checkJob(jobId: string): Promise<JobCheck> {
  const response = await authedFetch(`/api/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404 || response.status === 403) return { kind: 'gone' };
  const payload = await response.json().catch(() => null) as { data?: { status?: unknown; cloudinaryUrl?: unknown; error?: unknown } } | null;
  if (!response.ok) throw failureFromResponse(response.status, payload, 'OpenAssets could not update the status.');
  const data = payload?.data;
  if (typeof data?.status !== 'string') throw new Error('OpenAssets could not update the status.');
  return { kind: 'job', status: data.status, thumbnailUrl: httpUrl(data.cloudinaryUrl), error: typeof data.error === 'string' && data.error ? data.error : undefined };
}

/**
 * Updates the rows of "Sent from this browser" that can still change (Queued,
 * Detecting). Rows that settled cost nothing. Throws when none of the checks
 * could be made (offline, signed out) so the panel can say so; the saved
 * statuses stay as they were.
 */
export async function refreshSent(): Promise<void> {
  const { account } = await getAuth();
  if (!account) return;
  const pending = (await getSnapshot()).sent.filter(isInProgress);
  if (pending.length === 0) return;
  await requireAccount();
  const settled = await Promise.allSettled(pending.map((item) => checkJob(item.jobId)));
  const checks = new Map<string, JobCheck>();
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') checks.set(pending[index]!.jobId, result.value);
  });
  if (checks.size === 0) {
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw failed?.reason instanceof Error ? failed.reason : new Error('OpenAssets could not update the status.');
  }
  const now = new Date();
  await updateSent((items) => items.map((item) => {
    const check = checks.get(item.jobId);
    return check && isInProgress(item) ? applyJobCheck(item, check, now) : item;
  }));
}
