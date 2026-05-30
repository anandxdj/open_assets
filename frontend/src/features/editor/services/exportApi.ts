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
): Promise<{ jobId: string }> {
  const envelope = await apiClient.post<ApiEnvelope<{ jobId: string }>>("/api/finalize", {
    jobId,
    selectedIds,
    updatedNames,
    skipUpscale: skipUpscale ?? false,
  });
  return envelope.data;
}
