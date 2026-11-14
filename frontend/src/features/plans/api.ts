import { apiClient } from "@/lib/api-client";
import type { PlanStatus } from "@/lib/plans";

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/** GET /api/plans/me */
export async function getMyPlan(): Promise<PlanStatus> {
  const envelope = await apiClient.get<ApiEnvelope<PlanStatus>>("/api/plans/me");
  return envelope.data;
}

/** POST /api/plans/trial. Rejects with code TRIAL_USED or ALREADY_PRO (409). */
export async function startTrialRequest(): Promise<PlanStatus> {
  const envelope = await apiClient.post<ApiEnvelope<PlanStatus>>("/api/plans/trial");
  return envelope.data;
}
