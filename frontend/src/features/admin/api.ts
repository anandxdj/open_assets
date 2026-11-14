import { apiClient } from "@/lib/api-client";
import type { EffectivePlan, PlanSource, PlanStatus, StoredPlan } from "@/lib/plans";

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/** Row of GET /api/admin/users (admin only). */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  isVerified: boolean;
  createdAt: string | null;
  plan: StoredPlan;
  effectivePlan: EffectivePlan;
  planSource: PlanSource | null;
  proEndsAt: string | null;
  trialUsed: boolean;
  sheetsThisMonth: number;
}

export async function searchUsers(q: string): Promise<AdminUserRow[]> {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  const envelope = await apiClient.get<ApiEnvelope<{ users: AdminUserRow[] }>>(`/api/admin/users${query}`);
  return envelope.data.users;
}

/** `days` = days of Pro from now; omit or null for Pro with no end date. */
export async function setUserPlan(userId: string, plan: "free" | "pro", days?: number | null): Promise<PlanStatus> {
  const envelope = await apiClient.put<ApiEnvelope<PlanStatus>>(`/api/admin/users/${userId}/plan`, {
    plan,
    ...(days ? { days } : {}),
  });
  return envelope.data;
}
