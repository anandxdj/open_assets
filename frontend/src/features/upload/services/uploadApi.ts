import { apiClient, refreshAccessToken } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import type { JobResponse, UploadResponse } from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

type XhrResult = { status: number; body: unknown };

function sendWithProgress(
  file: File,
  token: string | null,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/api/upload`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response });
    xhr.onerror = () => reject(new Error("Network error. Check your connection and try again."));
    xhr.onabort = () => reject(new UploadAbortedError());

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", onAbort);

    const form = new FormData();
    form.append("image", file);
    xhr.send(form);
  });
}

/**
 * POST /api/upload with real byte progress (fetch cannot report upload
 * progress, so this uses XMLHttpRequest). Mirrors the api client: bearer token,
 * cookie credentials and one refresh-and-retry on 401.
 */
export async function uploadImageWithProgress(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<UploadResponse> {
  let res = await sendWithProgress(file, tokenStore.get(), onProgress, signal);

  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (token) {
      onProgress(0);
      res = await sendWithProgress(file, token, onProgress, signal);
    }
  }

  if (res.status < 200 || res.status >= 300) {
    const message = (res.body as { message?: string } | null)?.message;
    // 5xx bodies carry generic text ("Internal Server Error"); say what to do instead.
    if (res.status >= 500 || !message) {
      throw new Error("We couldn't store your image. Try again in a moment.");
    }
    throw new Error(message);
  }

  const envelope = res.body as ApiEnvelope<UploadResponse> | null;
  if (!envelope?.data?.jobId) throw new Error("The server did not return a job.");
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
