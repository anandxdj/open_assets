import { redis } from '../../common/config/redis';
import type { JobHash, JobStatus, BoundingBox, Asset } from './job.types';
import { JobArchiveModel } from './job-archive.model';

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
  await JobArchiveModel.updateOne({ jobId }, { $set: patch }).catch(() => undefined);
}

export async function getJob(jobId: string): Promise<(JobHash & { id: string }) | null> {
  const key = jobKey(jobId);
  const data = await redis.hgetall(key);
  if (data && Object.keys(data).length > 0) return { id: jobId, ...data } as JobHash & { id: string };
  const archived = await JobArchiveModel.findOne({ jobId }).lean();
  if (!archived) return null;
  const restored = { ...archived } as unknown as JobHash;
  delete (restored as unknown as Record<string, unknown>)['_id'];
  delete (restored as unknown as Record<string, unknown>)['__v'];
  delete (restored as unknown as Record<string, unknown>)['updatedAt'];
  await redis.hset(key, restored as unknown as Record<string, string>);
  await redis.expire(key, JOB_TTL);
  return { id: jobId, ...restored };
}

export async function archiveJob(jobId: string, projectId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const { id: _id, ...data } = job;
  await JobArchiveModel.updateOne(
    { jobId },
    { $set: { ...data, projectId } },
    { upsert: true },
  );
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
