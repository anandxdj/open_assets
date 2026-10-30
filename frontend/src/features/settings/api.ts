import { apiClient } from "@/lib/api-client";
import type {
  Account,
  ApiEnvelope,
  DeleteAccountResult,
  ExtensionSession,
  PasswordChangeResult,
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

export function deleteAccount(confirmation: string) {
  return apiClient.del<ApiEnvelope<DeleteAccountResult>>("/api/account", { confirmation });
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}
