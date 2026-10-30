// Mirrors the backend account + usage modules (backend/src/modules/account,
// backend/src/modules/usage) — keep in sync.

/** Every backend response is wrapped as { success, message, data }. */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export type Plan = "free" | "byok" | "pro";

/** GET /api/account */
export interface Account {
  id: string;
  name: string;
  email: string;
  picture?: string;
  isVerified: boolean;
  /** False for Google-only accounts: they set a first password instead of changing one. */
  hasPassword: boolean;
  hasGoogle: boolean;
  createdAt?: string;
  lastLogin?: string;
}

/** PUT /api/account/profile */
export interface UpdatedProfile {
  id: string;
  name: string;
  email: string;
}

/** PUT /api/account/password — the new access token replaces the one in memory. */
export interface PasswordChangeResult {
  accessToken: string;
  extensionSessionsRevoked: number;
}

/** POST /api/account/logout-all */
export interface SignOutEverywhereResult {
  extensionSessionsRevoked: number;
}

/** GET /api/account/extension-sessions */
export interface ExtensionSession {
  id: string;
  /** Chrome extension id (32 letters a-p). The only device descriptor stored. */
  extensionId: string;
  createdAt?: string;
  lastUsedAt?: string;
  expiresAt: string;
}

/** One row of GET /api/api-keys. The secret is never part of it. */
export interface ApiKey {
  id: string;
  name: string;
  /** `oa_live_` plus the first characters of the secret: enough to tell keys apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** POST /api/api-keys. `key` is the full secret and is only ever returned here. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

/** DELETE /api/api-keys/:id */
export interface RevokedApiKey {
  id: string;
  revokedAt: string;
}

/** DELETE /api/account */
export interface DeleteAccountResult {
  collections: number;
  imagesDeleted: number;
  imagesFailed: number;
  /** The account owned a team, which was dissolved. */
  teamDissolved?: boolean;
  teamMembersRemoved?: number;
}

/** GET /api/usage/me */
export interface Usage {
  credits: number;
  plan: Plan;
  monthlyGrant: number;
  /** ISO timestamp of the next monthly grant. */
  resetAt: string;
}

export type UsageOp =
  | "extend"
  | "generate"
  | "scene-brief"
  | "prop-brief"
  | "tile-review"
  | "sprite-review"
  | "anibuddy-prompt"
  | "anibuddy-rig"
  | "anibuddy-animate";

export type UsageEventStatus = "consumed" | "refunded";

/** One row of GET /api/usage/events */
export interface UsageEvent {
  id: string;
  op: UsageOp;
  modelId: string;
  units: number;
  cost: number;
  status: UsageEventStatus;
  createdAt: string;
}

/** GET /api/usage/events?page=&limit= */
export interface UsageEventPage {
  items: UsageEvent[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
