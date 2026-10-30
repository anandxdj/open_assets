import { apiClient } from "@/lib/api-client";
import type { BoundingBox } from "@/types";

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export async function startExport(
  jobId: string,
  boxes: BoundingBox[],
  isRaw?: boolean,
): Promise<{ jobId: string }> {
  const envelope = await apiClient.post<ApiEnvelope<{ jobId: string }>>("/api/crop", {
    jobId,
    boxes,
    isRaw,
  });
  return envelope.data;
}

export async function startFinalize(
  jobId: string,
  selectedIds: string[],
  updatedNames?: Record<string, string>,
  skipUpscale?: boolean,
  /** Upscale factor, 2 or 4. 4 needs Pro; the server answers 403 PLAN_LIMIT otherwise. */
  scale: 2 | 4 = 2,
  /** Naming pattern for the file names. A custom one needs Pro (403 PLAN_REQUIRED); omit for the account's default. */
  namingPattern?: string,
): Promise<{ jobId: string }> {
  const envelope = await apiClient.post<ApiEnvelope<{ jobId: string }>>("/api/finalize", {
    jobId,
    selectedIds,
    updatedNames,
    skipUpscale: skipUpscale ?? false,
    scale,
    namingPattern,
  });
  return envelope.data;
}
