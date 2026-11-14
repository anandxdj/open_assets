import { apiClient } from "@/lib/api-client";
import type { ApiEnvelope } from "@/types/account";

// Mirrors backend/src/modules/teams (team.service.ts). One team per person.

export type TeamRole = "owner" | "member";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  picture?: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  expiresAt: string;
  /** Past its 7 days. Still listed so the owner can resend it. */
  expired: boolean;
  lastSentAt: string;
}

export interface Team {
  id: string;
  name: string;
  role: TeamRole;
  /** The owner's plan lapsed: view and download only, no invites, no editing. */
  readOnly: boolean;
  owner: { id: string; name: string };
  members: TeamMember[];
  /** Only the owner gets invites. */
  invites: TeamInvite[];
  /** `used` is members (owner included) plus invites that have not expired. */
  seats: { used: number; limit: number };
  sharedCollections: number;
}

export interface TeamOverview {
  /** The signed-in account's own plan includes team sharing. */
  entitled: boolean;
  seatLimit: number;
  team: Team | null;
}

export interface InvitePreview {
  teamName: string;
  invitedBy: string;
  /** The address the invite was sent to; the account that accepts must use it. */
  email: string;
  expiresAt: string;
  readOnly: boolean;
}

/** Codes the API puts in `code` on team errors. */
export const TEAM_ERROR_CODES = {
  readOnly: "TEAM_READ_ONLY",
  alreadyInTeam: "TEAM_ALREADY_MEMBER",
  inviteInvalid: "TEAM_INVITE_INVALID",
  inviteExpired: "TEAM_INVITE_EXPIRED",
  emailMismatch: "TEAM_EMAIL_MISMATCH",
} as const;

export function getTeam() {
  return apiClient.get<ApiEnvelope<TeamOverview>>("/api/team");
}

export function createTeam(name: string) {
  return apiClient.post<ApiEnvelope<TeamOverview>>("/api/team", { name });
}

export function renameTeam(name: string) {
  return apiClient.put<ApiEnvelope<TeamOverview>>("/api/team", { name });
}

export function dissolveTeam() {
  return apiClient.del<ApiEnvelope<null>>("/api/team");
}

export function inviteMember(email: string) {
  return apiClient.post<ApiEnvelope<TeamInvite>>("/api/team/invites", { email });
}

export function resendInvite(id: string) {
  return apiClient.post<ApiEnvelope<TeamInvite>>(`/api/team/invites/${id}/resend`);
}

export function revokeInvite(id: string) {
  return apiClient.del<ApiEnvelope<null>>(`/api/team/invites/${id}`);
}

export function removeMember(userId: string) {
  return apiClient.del<ApiEnvelope<null>>(`/api/team/members/${userId}`);
}

export function leaveTeam() {
  return apiClient.post<ApiEnvelope<null>>("/api/team/leave");
}

export function previewInvite(token: string) {
  return apiClient.get<ApiEnvelope<InvitePreview>>(`/api/team/invite/${encodeURIComponent(token)}`);
}

export function acceptInvite(token: string) {
  return apiClient.post<ApiEnvelope<TeamOverview>>(`/api/team/invite/${encodeURIComponent(token)}/accept`);
}
