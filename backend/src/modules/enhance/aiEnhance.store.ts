import type { Redis } from 'ioredis';
import type {
  AiEnhanceImageFormat,
  AiEnhanceJobRecord,
  AiEnhanceScale,
  EnhanceJobStatus,
} from './enhance.types';
import type { StorageProviderName } from '../../lib/storage/status';

const JOB_TTL_SECONDS = 24 * 60 * 60;

/** Where AI enhance jobs live. Redis in the app, an in-memory map in tests. */
export interface AiEnhanceJobStore {
  create(record: AiEnhanceJobRecord): Promise<void>;
  get(jobId: string): Promise<AiEnhanceJobRecord | null>;
  update(jobId: string, patch: Partial<Pick<AiEnhanceJobRecord, 'status' | 'resultUrl' | 'error' | 'errorCode'>>): Promise<void>;
}

/** Redis key of one AI enhance job hash. */
export function aiEnhanceKey(jobId: string): string {
  return `enhance:ai:${jobId}`;
}

const key = aiEnhanceKey;

function serialize(record: AiEnhanceJobRecord): Record<string, string> {
  return {
    id: record.id,
    userId: record.userId,
    status: record.status,
    provider: record.provider,
    scale: String(record.options.scale ?? 0),
    removeBackground: String(record.options.removeBackground),
    sourceWidth: String(record.source.width),
    sourceHeight: String(record.source.height),
    sourceBytes: String(record.source.bytes),
    sourceFormat: record.source.format,
    sourceUrl: record.sourceUrl,
    sourcePublicId: record.sourcePublicId,
    resultUrl: record.resultUrl,
    error: record.error,
    errorCode: record.errorCode,
    createdAt: record.createdAt,
  };
}

function deserialize(hash: Record<string, string>): AiEnhanceJobRecord {
  const scale = Number(hash['scale']);
  return {
    id: hash['id'] ?? '',
    userId: hash['userId'] ?? '',
    status: (hash['status'] ?? 'failed') as EnhanceJobStatus,
    provider: (hash['provider'] ?? 'cloudinary') as StorageProviderName,
    options: {
      scale: scale === 2 || scale === 4 ? (scale as AiEnhanceScale) : null,
      removeBackground: hash['removeBackground'] === 'true',
    },
    source: {
      width: Number(hash['sourceWidth']) || 0,
      height: Number(hash['sourceHeight']) || 0,
      bytes: Number(hash['sourceBytes']) || 0,
      format: (hash['sourceFormat'] ?? 'png') as AiEnhanceImageFormat,
    },
    sourceUrl: hash['sourceUrl'] ?? '',
    sourcePublicId: hash['sourcePublicId'] ?? '',
    resultUrl: hash['resultUrl'] ?? '',
    error: hash['error'] ?? '',
    errorCode: hash['errorCode'] ?? '',
    createdAt: hash['createdAt'] ?? '',
  };
}

export function createRedisAiEnhanceStore(redis: Redis): AiEnhanceJobStore {
  return {
    async create(record) {
      await redis.hset(key(record.id), serialize(record));
      await redis.expire(key(record.id), JOB_TTL_SECONDS);
    },
    async get(jobId) {
      const hash = await redis.hgetall(key(jobId));
      if (!hash || Object.keys(hash).length === 0) return null;
      return deserialize(hash);
    },
    async update(jobId, patch) {
      const fields: Record<string, string> = {};
      for (const [field, value] of Object.entries(patch)) {
        if (value !== undefined) fields[field] = value;
      }
      if (Object.keys(fields).length === 0) return;
      await redis.hset(key(jobId), fields);
      await redis.expire(key(jobId), JOB_TTL_SECONDS);
    },
  };
}
