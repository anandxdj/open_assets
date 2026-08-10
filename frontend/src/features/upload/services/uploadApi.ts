import { apiClient } from "@/lib/api-client";
import type { JobResponse, UploadResponse } from "@/types";

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("image", file);
  const envelope = await apiClient.postForm<ApiEnvelope<UploadResponse>>("/api/upload", form);
  return envelope.data;
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const envelope = await apiClient.get<ApiEnvelope<JobResponse>>(`/api/jobs/${jobId}`);
  return envelope.data;
}

export type DetectionMode = "auto" | "light" | "dark" | "sampled";

export interface RedetectResponse {
  boxes: JobResponse["boxes"];
  detectionMode: string;
  detectionConfidence: number;
  detectionWarning?: string;
}

export async function redetectJob(
  jobId: string,
  options: { mode: DetectionMode; backgroundColor?: string },
): Promise<RedetectResponse> {
  const envelope = await apiClient.post<ApiEnvelope<RedetectResponse>>(
    `/api/jobs/${jobId}/redetect`,
    options,
  );
  return envelope.data;
}
