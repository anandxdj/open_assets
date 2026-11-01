import Redis from 'ioredis';
import { storage } from '../../lib/storage';
import { mapLimit } from '../../common/utils/mapLimit';
import { jobKey, userJobsKey } from '../jobs/job.keys';
import { aiEnhanceKey } from '../enhance/aiEnhance.store';

/** How many storage deletes run at once. */
const STORAGE_DELETE_CONCURRENCY = 8;
const SCAN_BATCH = 200;

export interface PurgeResult {
  /** Extraction jobs removed (the history index entries that were the user's own). */
  jobs: number;
  /** AI enhance jobs removed. */
  enhanceJobs: number;
  filesDeleted: number;
  filesFailed: number;
}

export interface PurgeDeps {
  /** Redis client to use. Default: a short-lived one that gives up at once when Redis is down. */
  client?: Redis;
  /** Deletes one stored file. Default: the storage adapter. */
  deleteFile?: (publicId: string) => Promise<void>;
}

function openClient(): Redis {
  const client = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    // Best effort: no reconnect loop, so an unreachable Redis fails fast and
    // leaves nothing running afterwards.
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  return client;
}

function parseAssetIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const assets = JSON.parse(raw) as Array<{ public_id?: string }>;
    return assets.map((a) => a.public_id ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Removes what a user's extraction history and AI enhance jobs hold in Redis,
 * and the stored image files behind them: the `user:<id>:jobs` index, each of
 * the user's `job:<id>` hashes (original upload and cropped assets, including
 * jobs they already removed from their history), and every `enhance:ai:<id>`
 * hash they own (its source image).
 *
 * Best effort, like the rest of account deletion: a Redis or storage failure is
 * logged and counted, never thrown. Only entries whose stored `userId` is the
 * user's are touched, so a stale index entry cannot remove someone else's job.
 */
export async function purgeUserRedisData(userId: string, deps: PurgeDeps = {}): Promise<PurgeResult> {
  const result: PurgeResult = { jobs: 0, enhanceJobs: 0, filesDeleted: 0, filesFailed: 0 };
  const client = deps.client ?? openClient();
  const deleteFile = deps.deleteFile ?? ((publicId: string) => storage.delete(publicId, 'image'));
  const publicIds = new Set<string>();

  try {
    // Extraction jobs, through the history index.
    const jobIds = await client.zrange(userJobsKey(userId), 0, -1);
    if (jobIds.length > 0) {
      const pipeline = client.pipeline();
      for (const id of jobIds) pipeline.hmget(jobKey(id), 'userId', 'publicId', 'assets', 'workingPublicId');
      const rows = (await pipeline.exec()) ?? [];
      const owned: string[] = [];
      rows.forEach(([err, values], i) => {
        const [owner, publicId, assets, workingPublicId] = (values ?? []) as (string | null)[];
        if (err || owner !== userId) return;
        owned.push(jobKey(jobIds[i] as string));
        if (publicId) publicIds.add(publicId);
        if (workingPublicId) publicIds.add(workingPublicId);
        for (const id of parseAssetIds(assets ?? null)) publicIds.add(id);
      });
      if (owned.length > 0) await client.del(...owned);
      result.jobs = owned.length;
    }
    await client.del(userJobsKey(userId));

    // Jobs the user removed from their history, or cleared, are no longer in the index but still hold
    // their original upload and crops (a job lives on for 24 hours). Find them by scanning, like the
    // enhance jobs below, so deleting the account leaves none of their files behind.
    let jobCursor = '0';
    do {
      const [next, keys] = await client.scan(jobCursor, 'MATCH', jobKey('*'), 'COUNT', SCAN_BATCH);
      jobCursor = next;
      if (keys.length === 0) continue;
      const pipeline = client.pipeline();
      for (const k of keys) pipeline.hmget(k, 'userId', 'publicId', 'assets', 'workingPublicId');
      const rows = (await pipeline.exec()) ?? [];
      const owned: string[] = [];
      rows.forEach(([err, values], i) => {
        const [owner, publicId, assets, workingPublicId] = (values ?? []) as (string | null)[];
        if (err || owner !== userId) return;
        owned.push(keys[i] as string);
        if (publicId) publicIds.add(publicId);
        if (workingPublicId) publicIds.add(workingPublicId);
        for (const id of parseAssetIds(assets ?? null)) publicIds.add(id);
      });
      if (owned.length > 0) await client.del(...owned);
      result.jobs += owned.length;
    } while (jobCursor !== '0');

    // AI enhance jobs have no per-user index: scan for them. They expire after
    // 24 hours, so the keyspace this walks is small.
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', aiEnhanceKey('*'), 'COUNT', SCAN_BATCH);
      cursor = next;
      if (keys.length === 0) continue;
      const pipeline = client.pipeline();
      for (const k of keys) pipeline.hmget(k, 'userId', 'sourcePublicId');
      const rows = (await pipeline.exec()) ?? [];
      const owned: string[] = [];
      rows.forEach(([err, values], i) => {
        const [owner, sourcePublicId] = (values ?? []) as (string | null)[];
        if (err || owner !== userId) return;
        owned.push(keys[i] as string);
        if (sourcePublicId) publicIds.add(sourcePublicId);
      });
      if (owned.length > 0) await client.del(...owned);
      result.enhanceJobs += owned.length;
    } while (cursor !== '0');
  } catch (err) {
    console.error('[account] redis cleanup failed (ignored):', err instanceof Error ? err.message : err);
  } finally {
    if (!deps.client) client.disconnect();
  }

  const outcomes = await mapLimit([...publicIds], STORAGE_DELETE_CONCURRENCY, async (publicId) => {
    try {
      await deleteFile(publicId);
      return true;
    } catch (err) {
      console.error('[account] storage delete failed (ignored):', publicId, err instanceof Error ? err.message : err);
      return false;
    }
  });
  result.filesDeleted = outcomes.filter(Boolean).length;
  result.filesFailed = outcomes.length - result.filesDeleted;
  return result;
}
