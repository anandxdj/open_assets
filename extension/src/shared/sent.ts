import type { SentItem, SentStatus } from './contracts';

/**
 * "Sent from this browser": the pure rules for the local list of images this
 * browser sent to OpenAssets. No browser APIs here, so every rule is tested
 * in Node (sent.test.ts). Storage and the API calls live in storage.ts and
 * entrypoints/background.ts.
 */

/** A job and its original expire after 24 hours on the server, so older rows would link to nothing. */
export const SENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Enough to scan at a glance; each row costs one small status request while it is in progress. */
export const SENT_MAX = 20;

/** The API's job statuses (`JobStatus` in backend/src/modules/jobs/job.types.ts) mapped to what the list shows. */
const FROM_JOB_STATUS: Record<string, SentStatus> = {
  uploaded: 'queued',
  queued: 'queued',
  detecting: 'detecting',
  removing_bg: 'detecting',
  detected: 'ready',
  naming: 'ready',
  cropping: 'ready',
  cropped: 'ready',
  finalizing: 'ready',
  ready: 'ready',
  failed: 'failed',
};

/** Unknown future statuses count as in progress: the row keeps being checked, never mislabelled Ready. */
export function sentStatusFromJob(jobStatus: string): SentStatus {
  return FROM_JOB_STATUS[jobStatus] ?? 'detecting';
}

export const sentStatusLabels: Record<SentStatus, string> = {
  queued: 'Queued',
  detecting: 'Detecting',
  ready: 'Ready',
  failed: 'Failed',
  expired: 'Expired',
};

/** Rows whose status can still change on the server. */
export function isInProgress(item: Pick<SentItem, 'status'>): boolean {
  return item.status === 'queued' || item.status === 'detecting';
}

const ageMs = (item: SentItem, now: Date) => now.getTime() - new Date(item.sentAt).getTime();

/** Newest first, at most SENT_MAX rows, nothing older than SENT_TTL_MS or with an unreadable date. */
export function pruneSent(items: readonly SentItem[], now: Date = new Date()): SentItem[] {
  return items
    .filter((item) => {
      const age = ageMs(item, now);
      return Number.isFinite(age) && age < SENT_TTL_MS;
    })
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    .slice(0, SENT_MAX);
}

/** Adds a row (replacing one with the same job id) and prunes. */
export function addSent(items: readonly SentItem[], entry: SentItem, now: Date = new Date()): SentItem[] {
  return pruneSent([entry, ...items.filter((item) => item.jobId !== entry.jobId)], now);
}

/** The outcome of asking the API about one job. `gone` is a 404 (the job expired) or a 403 (not this account's job). */
export type JobCheck =
  | { kind: 'job'; status: string; thumbnailUrl?: string | undefined; error?: string | undefined }
  | { kind: 'gone' };

export function applyJobCheck(item: SentItem, check: JobCheck, now: Date = new Date()): SentItem {
  const checkedAt = now.toISOString();
  if (check.kind === 'gone') {
    const { thumbnailUrl: _thumbnail, error: _error, ...rest } = item;
    return { ...rest, status: 'expired', checkedAt };
  }
  const status = sentStatusFromJob(check.status);
  const next: SentItem = { ...item, status, checkedAt };
  if (check.thumbnailUrl) next.thumbnailUrl = check.thumbnailUrl;
  if (status === 'failed' && check.error) next.error = check.error;
  else delete next.error;
  return next;
}

/**
 * The saved list only belongs to the account that sent the images. When
 * another account is signed in on the same browser, or nobody is, it is empty.
 */
export function sentForAccount(stored: { accountId?: string; items?: readonly SentItem[] } | undefined, accountId: string | null | undefined, now: Date = new Date()): SentItem[] {
  if (!stored || !accountId || stored.accountId !== accountId) return [];
  return pruneSent(stored.items ?? [], now);
}

/** Backoff for the status polling while the panel is open: 3 s, 5 s, 8 s, 13 s, then every 30 s. */
const POLL_STEPS_MS = [3_000, 5_000, 8_000, 13_000];
export const POLL_MAX_MS = 30_000;

export function nextPollDelay(attempt: number): number {
  const index = Math.max(0, Math.floor(attempt));
  return POLL_STEPS_MS[index] ?? POLL_MAX_MS;
}

const IMAGE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _().\-]{0,78}\.(?:png|jpe?g|webp|gif|avif|bmp)$/iu;
const OPAQUE_STEM = /^(?:[a-f0-9]{20,}|[A-Za-z0-9_-]{32,})$/;

/**
 * A file name for an image sent from a page: the last segment of its URL path
 * when that reads as a file name (what the web app would send if the user
 * dragged that file in), otherwise `openassets-<time>.<ext>`. The query and
 * hash are never used, and prompts are never used as names.
 */
export function fileNameForImage(imageUrl: string, mimeType: string, now: number = Date.now()): string {
  const subtype = (mimeType.split('/')[1] ?? '').split('+')[0]?.replace(/[^a-z0-9]/gi, '') || 'png';
  const fallback = `openassets-${now}.${subtype}`;
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return fallback;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
  let segment = url.pathname.split('/').pop() ?? '';
  try {
    segment = decodeURIComponent(segment);
  } catch {
    return fallback;
  }
  if (!IMAGE_NAME.test(segment)) return fallback;
  const stem = segment.slice(0, segment.lastIndexOf('.'));
  return OPAQUE_STEM.test(stem) ? fallback : segment;
}

/** One polite sentence about what changed between two lists, or '' when nothing did. */
export function describeSentChanges(before: readonly SentItem[], after: readonly SentItem[]): string {
  const previous = new Map(before.map((item) => [item.jobId, item.status]));
  const parts: string[] = [];
  for (const item of after) {
    const was = previous.get(item.jobId);
    if (was === undefined || was === item.status) continue;
    if (item.status === 'ready') parts.push(`${item.fileName} is ready`);
    else if (item.status === 'failed') parts.push(`${item.fileName} failed`);
    else if (item.status === 'expired') parts.push(`${item.fileName} expired`);
    else if (item.status === 'detecting') parts.push(`${item.fileName} is being detected`);
  }
  return parts.join('. ');
}

/** "Just now", "5 min ago", "3 h ago": how long ago a row was sent. */
export function formatAge(sentAt: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(sentAt).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}
