import { redis } from '../../common/config/redis';
import type { JobHash, JobStatus, BoundingBox, Asset } from './job.types';

const JOB_TTL = 86400; // 24 hours

function jobKey(jobId: string) {
  return `job:${jobId}`;
}

export async function createJob(
  jobId: string,
  data: Pick<JobHash, 'cloudinaryUrl' | 'publicId' | 'userId'>,
): Promise<void> {
  const key = jobKey(jobId);
  await redis.hset(key, {
    status: 'uploaded' satisfies JobStatus,
    cloudinaryUrl: data.cloudinaryUrl,
    publicId: data.publicId,
    workingUrl: '',
    isTransparent: '',
    imageWidth: '',
    imageHeight: '',
    detectionMode: '',
    detectionConfidence: '',
    detectionWarning: '',
    boxes: '[]',
    nameMap: '{}',
    assets: '[]',
    selectedIds: '[]',
    downloadUrl: '',
    error: '',
    userId: data.userId,
    createdAt: new Date().toISOString(),
  });
  await redis.expire(key, JOB_TTL);
}

export async function updateJob(
  jobId: string,
  patch: Partial<Omit<JobHash, 'createdAt'>>,
): Promise<void> {
  const key = jobKey(jobId);
  await redis.hset(key, patch as Record<string, string>);
  await redis.expire(key, JOB_TTL);
}

export async function getJob(jobId: string): Promise<(JobHash & { id: string }) | null> {
  const key = jobKey(jobId);
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  return { id: jobId, ...data } as JobHash & { id: string };
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
