import { apiClient } from "@/lib/api-client";
import type { JobListPage } from "@/types";

interface ApiWrap<T> {
  success: boolean;
  message: string;
  data: T;
}

/** The most rows one GET /api/jobs request returns. */
export const JOB_LIST_MAX = 100;

/** GET /api/jobs: the signed-in user's jobs, newest first, one page at a time. */
export async function listJobs({ limit, cursor }: { limit: number; cursor?: string | null }): Promise<JobListPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  const res = await apiClient.get<ApiWrap<JobListPage>>(`/api/jobs?${query}`);
  return res.data;
}

/** DELETE /api/jobs/:jobId/history: drops one job from the list. The job itself stays until it expires. */
export async function removeJobFromHistory(jobId: string): Promise<void> {
  await apiClient.del(`/api/jobs/${encodeURIComponent(jobId)}/history`);
}

/** DELETE /api/jobs/history: empties the list. The jobs themselves stay until they expire. */
export async function clearJobHistory(): Promise<void> {
  await apiClient.del("/api/jobs/history");
}
