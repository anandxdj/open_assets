import { redis } from '../../common/config/redis';
import { enhanceQueue } from '../../common/config/bullmq';
import { getStorageStatus, storage } from '../../lib/storage';
import { createRedisAiEnhanceStore } from './aiEnhance.store';
import type { AiEnhanceDeps } from './aiEnhance.service';

/**
 * The real storage adapter, Redis job store and BullMQ queue. Kept in its own
 * module so tests can build the router without opening a Redis connection.
 */
export const defaultAiEnhanceDeps: AiEnhanceDeps = {
  storage,
  store: createRedisAiEnhanceStore(redis),
  async enqueue(jobId) {
    // One attempt: a retried transform would be billed twice by the provider.
    await enhanceQueue.add('ai', { jobId }, { attempts: 1, removeOnComplete: true, removeOnFail: 200 });
  },
  getStorageStatus: () => getStorageStatus(),
};
