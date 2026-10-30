import { refreshAccessToken } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import type { JobResponse } from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type JobLookup =
  | { kind: "found"; job: JobResponse }
  /** The server forgot the job: jobs expire 24 hours after their last update. */
  | { kind: "expired" };

export class JobLookupError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "JobLookupError";
  }
}

function send(path: string, signal?: AbortSignal) {
  const token = tokenStore.get();
  return fetch(`${BASE_URL}${path}`, {
    method: "GET",
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal,
  });
}

/**
 * GET /api/jobs/:jobId, keeping the HTTP status so a 404 can be told apart
 * from other failures (the shared api client only surfaces a message).
 */
export async function lookupJob(jobId: string, signal?: AbortSignal): Promise<JobLookup> {
  const path = `/api/jobs/${encodeURIComponent(jobId)}`;
  let res = await send(path, signal);

  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (token) res = await send(path, signal);
  }

  if (res.status === 404) return { kind: "expired" };

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new JobLookupError(body?.message ?? `HTTP ${res.status}`, res.status);
  }

  const body = (await res.json()) as { data: JobResponse };
  return { kind: "found", job: body.data };
}
