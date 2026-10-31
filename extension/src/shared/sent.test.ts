import { describe, expect, it } from 'vitest';
import type { SentItem } from './contracts';
import {
  POLL_MAX_MS,
  SENT_MAX,
  SENT_TTL_MS,
  addSent,
  applyJobCheck,
  describeSentChanges,
  formatAge,
  fileNameForImage,
  isInProgress,
  nextPollDelay,
  pruneSent,
  sentForAccount,
  sentStatusFromJob,
} from './sent';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const row = (jobId: string, extra: Partial<SentItem> = {}): SentItem => ({ jobId, fileName: `${jobId}.png`, sentAt: ago(60_000), via: 'page', status: 'queued', ...extra });

describe('sentStatusFromJob', () => {
  it.each([
    ['uploaded', 'queued'],
    ['queued', 'queued'],
    ['detecting', 'detecting'],
    ['removing_bg', 'detecting'],
    ['detected', 'ready'],
    ['naming', 'ready'],
    ['cropping', 'ready'],
    ['cropped', 'ready'],
    ['finalizing', 'ready'],
    ['ready', 'ready'],
    ['failed', 'failed'],
  ] as const)('maps the API status %s to %s', (job, expected) => {
    expect(sentStatusFromJob(job)).toBe(expected);
  });

  it('treats an unknown status as in progress, never as Ready', () => {
    expect(sentStatusFromJob('something_new')).toBe('detecting');
  });
});

describe('isInProgress', () => {
  it('is true only while the server can still change the status', () => {
    expect(isInProgress({ status: 'queued' })).toBe(true);
    expect(isInProgress({ status: 'detecting' })).toBe(true);
    expect(isInProgress({ status: 'ready' })).toBe(false);
    expect(isInProgress({ status: 'failed' })).toBe(false);
    expect(isInProgress({ status: 'expired' })).toBe(false);
  });
});

describe('pruneSent', () => {
  it('drops rows older than 24 hours and keeps the rest newest first', () => {
    const items = [row('old', { sentAt: ago(SENT_TTL_MS + 1) }), row('a', { sentAt: ago(10 * 60_000) }), row('b', { sentAt: ago(5 * 60_000) })];
    expect(pruneSent(items, NOW).map((item) => item.jobId)).toEqual(['b', 'a']);
  });

  it('keeps a row that is just under 24 hours old and drops one at exactly 24 hours', () => {
    expect(pruneSent([row('edge', { sentAt: ago(SENT_TTL_MS - 1) })], NOW)).toHaveLength(1);
    expect(pruneSent([row('edge', { sentAt: ago(SENT_TTL_MS) })], NOW)).toHaveLength(0);
  });

  it('caps the list and keeps the newest rows', () => {
    const items = Array.from({ length: SENT_MAX + 5 }, (_, index) => row(`j${index}`, { sentAt: ago((index + 1) * 1000) }));
    const pruned = pruneSent(items, NOW);
    expect(pruned).toHaveLength(SENT_MAX);
    expect(pruned[0]?.jobId).toBe('j0');
    expect(pruned.at(-1)?.jobId).toBe(`j${SENT_MAX - 1}`);
  });

  it('drops a row whose date cannot be read', () => {
    expect(pruneSent([row('bad', { sentAt: 'not a date' })], NOW)).toEqual([]);
  });
});

describe('addSent', () => {
  it('puts the new row first', () => {
    const next = addSent([row('a', { sentAt: ago(120_000) })], row('b', { sentAt: ago(1000) }), NOW);
    expect(next.map((item) => item.jobId)).toEqual(['b', 'a']);
  });

  it('replaces a row with the same job id instead of listing it twice', () => {
    const next = addSent([row('a', { status: 'queued' })], row('a', { status: 'ready' }), NOW);
    expect(next).toHaveLength(1);
    expect(next[0]?.status).toBe('ready');
  });

  it('keeps the cap', () => {
    const full = Array.from({ length: SENT_MAX }, (_, index) => row(`j${index}`, { sentAt: ago((index + 2) * 1000) }));
    const next = addSent(full, row('fresh', { sentAt: ago(500) }), NOW);
    expect(next).toHaveLength(SENT_MAX);
    expect(next[0]?.jobId).toBe('fresh');
    expect(next.some((item) => item.jobId === `j${SENT_MAX - 1}`)).toBe(false);
  });
});

describe('applyJobCheck', () => {
  it('moves a row to ready and remembers the thumbnail', () => {
    const next = applyJobCheck(row('a'), { kind: 'job', status: 'detected', thumbnailUrl: 'https://files.test/a.png' }, NOW);
    expect(next).toMatchObject({ status: 'ready', thumbnailUrl: 'https://files.test/a.png', checkedAt: NOW.toISOString() });
  });

  it('keeps the thumbnail it already has when a later check carries none', () => {
    const next = applyJobCheck(row('a', { thumbnailUrl: 'https://files.test/a.png' }), { kind: 'job', status: 'detecting' }, NOW);
    expect(next.thumbnailUrl).toBe('https://files.test/a.png');
    expect(next.status).toBe('detecting');
  });

  it('stores the error of a failed job and clears it once the job is not failed', () => {
    const failed = applyJobCheck(row('a'), { kind: 'job', status: 'failed', error: 'Detection failed' }, NOW);
    expect(failed).toMatchObject({ status: 'failed', error: 'Detection failed' });
    const retried = applyJobCheck(failed, { kind: 'job', status: 'detecting', error: 'stale' }, NOW);
    expect(retried.error).toBeUndefined();
    expect('error' in retried).toBe(false);
  });

  it('marks a job the API no longer has as expired and drops its thumbnail', () => {
    const next = applyJobCheck(row('a', { thumbnailUrl: 'https://files.test/a.png', status: 'ready' }), { kind: 'gone' }, NOW);
    expect(next.status).toBe('expired');
    expect('thumbnailUrl' in next).toBe(false);
    expect(next.checkedAt).toBe(NOW.toISOString());
  });

  it('does not change the row it was given', () => {
    const original = row('a');
    applyJobCheck(original, { kind: 'job', status: 'ready' }, NOW);
    expect(original.status).toBe('queued');
  });
});

describe('sentForAccount', () => {
  const stored = { accountId: 'u1', items: [row('a')] };

  it('returns the rows for the account that sent them', () => {
    expect(sentForAccount(stored, 'u1', NOW).map((item) => item.jobId)).toEqual(['a']);
  });

  it('is empty for another account, nobody, or nothing stored', () => {
    expect(sentForAccount(stored, 'u2', NOW)).toEqual([]);
    expect(sentForAccount(stored, null, NOW)).toEqual([]);
    expect(sentForAccount(stored, undefined, NOW)).toEqual([]);
    expect(sentForAccount(undefined, 'u1', NOW)).toEqual([]);
  });

  it('prunes expired rows on read', () => {
    expect(sentForAccount({ accountId: 'u1', items: [row('old', { sentAt: ago(SENT_TTL_MS + 5) })] }, 'u1', NOW)).toEqual([]);
  });
});

describe('nextPollDelay', () => {
  it('backs off 3 s, 5 s, 8 s, 13 s and then holds at 30 s', () => {
    expect([0, 1, 2, 3].map(nextPollDelay)).toEqual([3000, 5000, 8000, 13000]);
    expect(nextPollDelay(4)).toBe(POLL_MAX_MS);
    expect(nextPollDelay(50)).toBe(POLL_MAX_MS);
  });

  it('treats a negative or fractional attempt as the first or the floor', () => {
    expect(nextPollDelay(-3)).toBe(3000);
    expect(nextPollDelay(1.9)).toBe(5000);
  });
});

describe('fileNameForImage', () => {
  const now = 1_730_000_000_000;

  it('uses a readable file name from the URL path', () => {
    expect(fileNameForImage('https://cdn.example.com/art/rpg_pack_v1.png', 'image/png', now)).toBe('rpg_pack_v1.png');
    expect(fileNameForImage('https://cdn.example.com/art/Slime%20Sheet.webp', 'image/webp', now)).toBe('Slime Sheet.webp');
    expect(fileNameForImage('https://cdn.example.com/スプライト.png', 'image/png', now)).toBe('スプライト.png');
  });

  it('never uses the query string or hash', () => {
    expect(fileNameForImage('https://cdn.example.com/a/tiles.png?token=SECRET&x=1#frag', 'image/png', now)).toBe('tiles.png');
    expect(fileNameForImage('https://cdn.example.com/image?name=tiles.png&sig=SECRET', 'image/png', now)).toBe(`openassets-${now}.png`);
  });

  it('falls back for opaque hashes, long names, missing extensions and odd URLs', () => {
    const fallback = `openassets-${now}.png`;
    expect(fileNameForImage(`https://cdn.example.com/${'a1b2c3d4'.repeat(8)}.png`, 'image/png', now)).toBe(fallback);
    expect(fileNameForImage(`https://cdn.example.com/${'x'.repeat(90)}.png`, 'image/png', now)).toBe(fallback);
    expect(fileNameForImage('https://cdn.example.com/download', 'image/png', now)).toBe(fallback);
    expect(fileNameForImage('https://cdn.example.com/', 'image/png', now)).toBe(fallback);
    expect(fileNameForImage('https://cdn.example.com/%E0%A4%A.png', 'image/png', now)).toBe(fallback);
    expect(fileNameForImage('data:image/png;base64,AAAA', 'image/png', now)).toBe(fallback);
    expect(fileNameForImage('blob:https://example.com/123', 'image/png', now)).toBe(fallback);
    expect(fileNameForImage('not a url', 'image/png', now)).toBe(fallback);
    expect(fileNameForImage('https://cdn.example.com/script.php', 'image/png', now)).toBe(fallback);
  });

  it('takes the extension of the fallback from the MIME type', () => {
    expect(fileNameForImage('https://cdn.example.com/', 'image/webp', now)).toBe(`openassets-${now}.webp`);
    expect(fileNameForImage('https://cdn.example.com/', 'image/svg+xml', now)).toBe(`openassets-${now}.svg`);
    expect(fileNameForImage('https://cdn.example.com/', '', now)).toBe(`openassets-${now}.png`);
  });
});

describe('describeSentChanges', () => {
  it('names each row whose status changed', () => {
    const before = [row('a', { status: 'detecting' }), row('b', { status: 'queued' }), row('c', { status: 'ready' })];
    const after = [row('a', { status: 'ready' }), row('b', { status: 'detecting' }), row('c', { status: 'ready' })];
    expect(describeSentChanges(before, after)).toBe('a.png is ready. b.png is being detected');
  });

  it('announces failures and expiry', () => {
    expect(describeSentChanges([row('a', { status: 'detecting' })], [row('a', { status: 'failed' })])).toBe('a.png failed');
    expect(describeSentChanges([row('a', { status: 'ready' })], [row('a', { status: 'expired' })])).toBe('a.png expired');
  });

  it('says nothing for a new row, an unchanged list or an empty list', () => {
    expect(describeSentChanges([], [row('a')])).toBe('');
    expect(describeSentChanges([row('a')], [row('a')])).toBe('');
    expect(describeSentChanges([], [])).toBe('');
  });
});

describe('formatAge', () => {
  it('rounds down to minutes and then hours', () => {
    expect(formatAge(ago(5_000), NOW)).toBe('Just now');
    expect(formatAge(ago(59_999), NOW)).toBe('Just now');
    expect(formatAge(ago(60_000), NOW)).toBe('1 min ago');
    expect(formatAge(ago(59 * 60_000), NOW)).toBe('59 min ago');
    expect(formatAge(ago(60 * 60_000), NOW)).toBe('1 h ago');
    expect(formatAge(ago(23 * 3_600_000 + 59 * 60_000), NOW)).toBe('23 h ago');
  });

  it('shows Just now for a clock that is slightly ahead or a date that cannot be read', () => {
    expect(formatAge(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe('Just now');
    expect(formatAge('nope', NOW)).toBe('Just now');
  });
});
