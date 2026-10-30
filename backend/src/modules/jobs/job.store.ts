import { redis } from '../../common/config/redis';
import type { ChainableCommander } from 'ioredis';
import type { JobHash, JobStatus, BoundingBox, Asset } from './job.types';
import { encodeCursor, isAfterCursor, type JobCursor } from './job.list';

const JOB_TTL = 86400; // 24 hours

/*
 * Per-user job index: a sorted set `user:<id>:jobs`, member = job id, score =
 * creation time in ms. It is what makes "list my jobs" possible, since the job
 * hashes themselves can only be found by id.
 *
 * Redis cannot expire single members, so the index is allowed to point at jobs
 * that are gone. listUserJobs() checks every entry against its job hash and
 * drops the dead ones (expired hashes, or hashes that are not the user's). Two
 * other things bound its size:
 *  - USER_JOBS_MAX: createJob() trims the oldest entries beyond this many.
 *  - USER_JOBS_TTL: the whole key expires if the user stops uploading. It is
 *    longer than JOB_TTL because updateJob() pushes a job's own expiry back on
 *    every change, so a job can outlive the upload that created it.
 */
const USER_JOBS_TTL = 7 * 86400; // 7 days
export const USER_JOBS_MAX = 100;

/** Hash fields a list row needs. Never `boxes` or `assets`: those are large. */
const SUMMARY_FIELDS = [
  'status',
  'cloudinaryUrl',
  'fileName',
  'createdAt',
  'userId',
  'assetCount',
  'boxCount',
  'error',
] as const;

export type JobSummaryRecord = { id: string; score: number; status: JobStatus } &
  Record<Exclude<(typeof SUMMARY_FIELDS)[number], 'status'>, string>;

export interface JobListResult {
  jobs: JobSummaryRecord[];
  nextCursor: string | null;
}

function jobKey(jobId: string) {
  return `job:${jobId}`;
}

function userJobsKey(userId: string) {
  return `user:${userId}:jobs`;
}

/** ioredis reports a failed command inside exec()'s results instead of rejecting. */
async function execOrThrow(tx: ChainableCommander): Promise<unknown[]> {
  const results = (await tx.exec()) ?? [];
  return results.map(([err, value]) => {
    if (err) throw err;
    return value;
  });
}

export async function createJob(
  jobId: string,
  data: Pick<JobHash, 'cloudinaryUrl' | 'publicId' | 'userId' | 'fileName'>,
): Promise<void> {
  const key = jobKey(jobId);
  const createdAt = new Date();
  const tx = redis
    .multi()
    .hset(key, {
      status: 'uploaded' satisfies JobStatus,
      cloudinaryUrl: data.cloudinaryUrl,
      publicId: data.publicId,
      fileName: data.fileName ?? '',
      workingUrl: '',
      isTransparent: '',
      imageWidth: '',
      imageHeight: '',
      detectionMode: '',
      detectionConfidence: '',
      detectionWarning: '',
      boxes: '[]',
      boxCount: '0',
      nameMap: '{}',
      assets: '[]',
      assetCount: '0',
      selectedIds: '[]',
      downloadUrl: '',
      error: '',
      userId: data.userId,
      createdAt: createdAt.toISOString(),
    })
    .expire(key, JOB_TTL);

  // The job and its index entry are written in one transaction, so a reader
  // that sees the entry always finds the hash.
  if (data.userId && data.userId !== 'anonymous') {
    const indexKey = userJobsKey(data.userId);
    tx.zadd(indexKey, createdAt.getTime(), jobId)
      .zremrangebyrank(indexKey, 0, -(USER_JOBS_MAX + 1))
      .expire(indexKey, USER_JOBS_TTL);
  }

  await execOrThrow(tx);
}

export async function updateJob(
  jobId: string,
  patch: Partial<Omit<JobHash, 'createdAt'>>,
): Promise<void> {
  const key = jobKey(jobId);
  const fields: Record<string, string> = { ...(patch as Record<string, string>) };
  // Lists show a count, not the JSON, so keep the counts next to it.
  if (patch.assets !== undefined) fields['assetCount'] = String(parseAssets(patch.assets).length);
  if (patch.boxes !== undefined) fields['boxCount'] = String(parseBoxes(patch.boxes).length);
  await redis.hset(key, fields);
  await redis.expire(key, JOB_TTL);
}

export async function getJob(jobId: string): Promise<(JobHash & { id: string }) | null> {
  const key = jobKey(jobId);
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  return { id: jobId, ...data } as JobHash & { id: string };
}

/**
 * One page of the user's live jobs, newest first. Cost is two round trips for
 * a normal page however many jobs it holds: one for the index (at most
 * USER_JOBS_MAX entries) and one pipelined HMGET for the page. Further trips
 * happen only while dead index entries leave the page short, and the dead
 * entries are removed from the index so that happens once per entry.
 */
export async function listUserJobs(
  userId: string,
  { limit, cursor }: { limit: number; cursor?: JobCursor },
): Promise<JobListResult> {
  const indexKey = userJobsKey(userId);
  const raw = await redis.zrevrange(indexKey, 0, -1, 'WITHSCORES');

  const entries: JobCursor[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    entries.push({ id: raw[i] as string, score: Number(raw[i + 1]) });
  }

  let pos = 0;
  if (cursor) {
    pos = entries.findIndex((entry) => isAfterCursor(entry, cursor));
    if (pos === -1) pos = entries.length;
  }

  // Look for one job more than the page holds: that tells whether a next page
  // exists, so the last page never advertises an empty one.
  const live: JobSummaryRecord[] = [];
  const dead: string[] = [];
  while (live.length <= limit && pos < entries.length) {
    const batch = entries.slice(pos, pos + (limit + 1 - live.length));
    pos += batch.length;

    const pipeline = redis.pipeline();
    for (const entry of batch) pipeline.hmget(jobKey(entry.id), ...SUMMARY_FIELDS);
    const results = (await pipeline.exec()) ?? [];

    results.forEach(([err, values], i) => {
      if (err) throw err;
      const entry = batch[i] as JobCursor;
      const fields = values as (string | null)[];
      const record = Object.fromEntries(
        SUMMARY_FIELDS.map((field, j) => [field, fields[j] ?? '']),
      ) as Omit<JobSummaryRecord, 'id' | 'score'>;
      // Same rule as assertOwner(): a missing or different owner is not the
      // user's job. An empty status means the hash has expired.
      if (!record.status || record.userId !== userId) {
        dead.push(entry.id);
        return;
      }
      live.push({ id: entry.id, score: entry.score, ...record });
    });
  }

  if (dead.length) await redis.zrem(indexKey, ...dead);

  const jobs = live.slice(0, limit);
  const last = jobs[jobs.length - 1];
  const nextCursor = live.length > limit && last ? encodeCursor({ score: last.score, id: last.id }) : null;
  return { jobs, nextCursor };
}

/**
 * Drops one job from the user's list. Returns whether it was listed. The job
 * itself is not touched: workers may still be writing to it, and it expires on
 * its own.
 */
export async function removeUserJob(userId: string, jobId: string): Promise<boolean> {
  return (await redis.zrem(userJobsKey(userId), jobId)) > 0;
}

/**
 * Empties the user's list. Returns how many entries it held (a few may have
 * been expired jobs not pruned yet). Jobs are not touched, see removeUserJob().
 */
export async function clearUserJobs(userId: string): Promise<number> {
  const indexKey = userJobsKey(userId);
  const [count] = await execOrThrow(redis.multi().zcard(indexKey).del(indexKey));
  return Number(count);
}

export function parseBoxes(raw: string): BoundingBox[] {
  try {
    return JSON.parse(raw) as BoundingBox[];
  } catch {
    return [];
  }
}

export function parseAssets(raw: string): Asset[] {
  try {
    return JSON.parse(raw) as Asset[];
  } catch {
    return [];
  }
}
