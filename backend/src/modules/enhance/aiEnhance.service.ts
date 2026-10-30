import { v4 as uuidv4 } from 'uuid';
import { ApiError } from '../../common/utils/ApiError';
import type { StorageAdapter } from '../../lib/storage/interface';
import type { StorageStatus } from '../../lib/storage/status';
import { getAiEnhanceLimits, outputSize, providerLabel, validateAiEnhance } from './aiEnhance.limits';
import type { AiEnhanceJobStore } from './aiEnhance.store';
import type {
  AiEnhanceJobRecord,
  AiEnhanceJobResponse,
  AiEnhanceOperation,
  AiEnhanceOptions,
  AiEnhanceRecipe,
} from './enhance.types';
import type { ImageProbe } from './imageProbe';

/** Everything the AI enhance flow touches outside this module. */
export interface AiEnhanceDeps {
  storage: StorageAdapter;
  store: AiEnhanceJobStore;
  /** Hand a stored job to a worker. */
  enqueue(jobId: string): Promise<void>;
  /** Credentials check for the active provider. */
  getStorageStatus(): StorageStatus;
}

export const STORAGE_NOT_CONFIGURED = 'STORAGE_NOT_CONFIGURED';

export function storageNotConfiguredMessage(status: StorageStatus): string {
  return `AI enhance needs ${providerLabel(status.provider)} for storage, and it isn't configured on this server.`;
}

export function requireStorage(deps: Pick<AiEnhanceDeps, 'getStorageStatus'>): void {
  const status = deps.getStorageStatus();
  if (!status.configured) {
    throw ApiError.serviceUnavailable(storageNotConfiguredMessage(status), STORAGE_NOT_CONFIGURED);
  }
}

export function buildRecipe(record: AiEnhanceJobRecord): AiEnhanceRecipe {
  const operations: AiEnhanceOperation[] = [];
  if (record.options.scale !== null) operations.push({ op: 'upscale', scale: record.options.scale });
  if (record.options.removeBackground) operations.push({ op: 'background_removal' });
  return {
    tool: 'ai',
    provider: record.provider,
    operations,
    source: { width: record.source.width, height: record.source.height },
    output: outputSize(record.source, record.options.scale),
  };
}

export function toJobResponse(record: AiEnhanceJobRecord): AiEnhanceJobResponse {
  return {
    jobId: record.id,
    kind: 'ai',
    status: record.status,
    recipe: buildRecipe(record),
    resultUrl: record.status === 'ready' && record.resultUrl ? record.resultUrl : undefined,
    error: record.error || undefined,
    errorCode: record.errorCode || undefined,
  };
}

export interface SubmitInput {
  userId: string;
  buffer: Buffer;
  probe: ImageProbe;
  options: AiEnhanceOptions;
}

/**
 * Validate against the provider's limits, store the source, and queue the
 * transform. The slow part (the provider generating the result) happens in the
 * worker, so the caller gets a job to poll.
 */
export async function submitAiEnhance(deps: AiEnhanceDeps, input: SubmitInput): Promise<AiEnhanceJobRecord> {
  const status = deps.getStorageStatus();
  if (!status.configured) {
    throw ApiError.serviceUnavailable(storageNotConfiguredMessage(status), STORAGE_NOT_CONFIGURED);
  }
  const limits = getAiEnhanceLimits(status.provider);
  const bytes = input.buffer.length;
  validateAiEnhance({ ...input.probe, bytes }, input.options, limits);

  const jobId = uuidv4();
  const stored = await deps.storage.upload(input.buffer, {
    folder: 'enhance',
    publicId: jobId,
    resourceType: 'image',
  });

  // The provider's own reading of the image is authoritative. If it disagrees
  // with our header probe, validate again with its numbers.
  const width = stored.width ?? input.probe.width;
  const height = stored.height ?? input.probe.height;
  if (width !== input.probe.width || height !== input.probe.height) {
    try {
      validateAiEnhance({ width, height, animated: input.probe.animated, bytes }, input.options, limits);
    } catch (error) {
      await deps.storage.delete(stored.publicId).catch(() => undefined);
      throw error;
    }
  }

  const record: AiEnhanceJobRecord = {
    id: jobId,
    userId: input.userId,
    status: 'queued',
    provider: status.provider,
    options: input.options,
    source: { width, height, bytes, format: input.probe.format },
    sourceUrl: stored.url,
    sourcePublicId: stored.publicId,
    resultUrl: '',
    error: '',
    errorCode: '',
    createdAt: new Date().toISOString(),
  };

  try {
    await deps.store.create(record);
    await deps.enqueue(jobId);
  } catch (error) {
    // Nothing will ever process this source, so don't leave it in storage.
    await deps.storage.delete(stored.publicId).catch(() => undefined);
    throw error;
  }
  return record;
}

/** Turn a provider failure into a message the user can act on. */
export function describeProviderFailure(error: unknown): { message: string; code: string } {
  const text = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(text)) {
    return {
      message: 'The provider took too long to finish this image. Try a smaller image or a lower scale.',
      code: 'PROVIDER_TIMEOUT',
    };
  }
  const status = /HTTP (\d{3})/.exec(text)?.[1];
  if (status === '401' || status === '403' || status === '404') {
    return {
      message: "The storage provider refused this transform. Check that its AI add-ons are enabled for the account.",
      code: 'PROVIDER_REJECTED',
    };
  }
  if (status !== undefined) {
    return {
      message: `The storage provider couldn't enhance this image (HTTP ${status}). Try again, or try a smaller image.`,
      code: 'PROVIDER_FAILED',
    };
  }
  return { message: "The image couldn't be enhanced. Try again in a moment.", code: 'ENHANCE_FAILED' };
}

/**
 * Worker body: run the provider transform for a queued job and record the
 * outcome. Never throws for provider failures; they become a `failed` job.
 * Safe to run twice (a stalled job is retried by the queue).
 */
export async function runAiEnhanceJob(
  deps: Pick<AiEnhanceDeps, 'storage' | 'store'>,
  jobId: string,
): Promise<void> {
  const job = await deps.store.get(jobId);
  if (!job) return;
  if (job.status === 'ready' || job.status === 'failed') return;

  await deps.store.update(jobId, { status: 'processing' });
  try {
    const resultUrl = await deps.storage.applyEnhance(job.sourcePublicId, {
      upscale: job.options.scale !== null ? { scale: job.options.scale, sourceWidth: job.source.width } : undefined,
      removeBackground: job.options.removeBackground,
    });
    // The result is a derived URL of the stored source, so the source has to
    // stay in storage. TODO: expire `enhance/` sources once jobs age out.
    await deps.store.update(jobId, { status: 'ready', resultUrl, error: '', errorCode: '' });
  } catch (error) {
    console.error(`[enhance.worker] AI enhance job ${jobId} failed:`, error);
    const { message, code } = describeProviderFailure(error);
    await deps.store.update(jobId, { status: 'failed', error: message, errorCode: code });
    // A failed job has no result, so its stored source is just clutter.
    await deps.storage.delete(job.sourcePublicId).catch(() => undefined);
  }
}
