import { apiClient, refreshAccessToken } from "@/lib/api-client";
import { apiErrorFrom, ApiRequestError } from "@/lib/api-error";
import { tokenStore } from "@/lib/token-store";
import type { JobResponse, UploadResponse } from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
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
      throw new ApiRequestError("We couldn't store your image. Try again in a moment.", res.status);
    }
    // Keeps the machine code and details (for example SHEET_LIMIT and resetAt).
    throw apiErrorFrom(res.status, res.body);
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
  options: {
    mode: DetectionMode;
    backgroundColor?: string;
    /** Pro: 1 to 100, 50 = default. The server answers 403 PLAN_REQUIRED for free accounts. */
    threshold?: number;
    /** Pro: 0 to 64 px added around every box. */
    padding?: number;
  },
): Promise<RedetectResponse> {
  const envelope = await apiClient.post<ApiEnvelope<RedetectResponse>>(
    `/api/jobs/${jobId}/redetect`,
    options,
  );
  return envelope.data;
}
