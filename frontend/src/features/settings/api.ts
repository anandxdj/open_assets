import { apiClient } from "@/lib/api-client";
import type {
  Account,
  ApiEnvelope,
  ApiKey,
  CreatedApiKey,
  DeleteAccountResult,
  ExtensionSession,
  PasswordChangeResult,
  RevokedApiKey,
  SignOutEverywhereResult,
  UpdatedProfile,
  Usage,
  UsageEventPage,
} from "@/types/account";

export function getAccount() {
  return apiClient.get<ApiEnvelope<Account>>("/api/account");
}

export function updateProfile(name: string) {
  return apiClient.put<ApiEnvelope<UpdatedProfile>>("/api/account/profile", { name });
}

/** Re-sends the verification link. Unauthenticated on the backend, keyed by email. */
export function resendVerification(email: string) {
  return apiClient.post<ApiEnvelope<null>>("/api/auth/resend-verification", { email });
}

/** `currentPassword` is omitted for a Google-only account setting its first password. */
export function changePassword(input: { currentPassword?: string; newPassword: string }) {
  return apiClient.put<ApiEnvelope<PasswordChangeResult>>("/api/account/password", input);
}

export function signOutEverywhere() {
  return apiClient.post<ApiEnvelope<SignOutEverywhereResult>>("/api/account/logout-all");
}

export function listExtensionSessions() {
  return apiClient.get<ApiEnvelope<ExtensionSession[]>>("/api/account/extension-sessions");
}

export function revokeExtensionSession(id: string) {
  return apiClient.del<ApiEnvelope<null>>(`/api/account/extension-sessions/${id}`);
}

export function getUsage() {
  return apiClient.get<ApiEnvelope<Usage>>("/api/usage/me");
}

export function listUsageEvents(page: number, limit: number) {
  return apiClient.get<ApiEnvelope<UsageEventPage>>(`/api/usage/events?page=${page}&limit=${limit}`);
}

/** Active API keys. Allowed on any plan, so a lapsed account can still see and revoke its keys. */
export function listApiKeys() {
  return apiClient.get<ApiEnvelope<ApiKey[]>>("/api/api-keys");
}

/** Pro only (403 PLAN_REQUIRED / PLAN_LIMIT). The response carries the full key exactly once. */
export function createApiKey(name: string) {
  return apiClient.post<ApiEnvelope<CreatedApiKey>>("/api/api-keys", { name });
}

export function revokeApiKey(id: string) {
  return apiClient.del<ApiEnvelope<RevokedApiKey>>(`/api/api-keys/${id}`);
}

export function deleteAccount(confirmation: string) {
  return apiClient.del<ApiEnvelope<DeleteAccountResult>>("/api/account", { confirmation });
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}
