/**
 * The people, plan states and names the end-to-end suite relies on. Imported by
 * the seed script (backend/scripts/e2e-seed.ts). frontend/e2e/fixtures.ts keeps
 * a copy of the public parts (emails and the password); change both together.
 *
 * Everything here is a test fixture for a throwaway database. The password is
 * not a secret.
 */

export const E2E_PASSWORD = 'E2e-Passw0rd!';

/** The pending invite the /team/invite/<token> screen is shot with. Only its SHA-256 is stored. */
/** Invite tokens are 43 characters (32 random bytes, base64url); anything else is refused before a lookup. */
export const E2E_INVITE_TOKEN = `e2e-invite-token-${'0'.repeat(26)}`;
export const E2E_INVITEE_EMAIL = 'invitee@openassets.test';

export type PersonaKey = 'admin' | 'free' | 'pro' | 'trial' | 'lapsed' | 'member' | 'creator';

export interface PersonaSpec {
  key: PersonaKey;
  /** 1-based; becomes part of the fixed ObjectId. */
  n: number;
  email: string;
  name: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  planSource?: 'admin' | 'trial';
  /** Days from the seed time that a time-limited Pro period ends (negative = already ended). */
  proEndsInDays?: number;
  /** Days before the seed time that the one trial started. */
  trialStartedDaysAgo?: number;
  /** Sheets used this month. */
  sheetsUsed: number;
  /** Fixed account creation time, so the admin list keeps its order. */
  createdAt: string;
}

export const PERSONAS: PersonaSpec[] = [
  { key: 'admin', n: 1, email: 'admin@openassets.test', name: 'Ada Admin', role: 'admin', plan: 'pro', planSource: 'admin', sheetsUsed: 1, createdAt: '2026-01-02T09:00:00.000Z' },
  { key: 'free', n: 2, email: 'free@openassets.test', name: 'Fern Free', role: 'user', plan: 'free', sheetsUsed: 3, createdAt: '2026-01-03T09:00:00.000Z' },
  { key: 'pro', n: 3, email: 'pro@openassets.test', name: 'Priya Pro', role: 'user', plan: 'pro', planSource: 'admin', sheetsUsed: 12, createdAt: '2026-01-04T09:00:00.000Z' },
  { key: 'trial', n: 4, email: 'trial@openassets.test', name: 'Theo Trial', role: 'user', plan: 'pro', planSource: 'trial', proEndsInDays: 9, trialStartedDaysAgo: 5, sheetsUsed: 2, createdAt: '2026-01-05T09:00:00.000Z' },
  { key: 'lapsed', n: 5, email: 'lapsed@openassets.test', name: 'Lena Lapsed', role: 'user', plan: 'pro', planSource: 'trial', proEndsInDays: -16, trialStartedDaysAgo: 30, sheetsUsed: 5, createdAt: '2026-01-06T09:00:00.000Z' },
  { key: 'member', n: 6, email: 'member@openassets.test', name: 'Mina Member', role: 'user', plan: 'free', sheetsUsed: 0, createdAt: '2026-01-07T09:00:00.000Z' },
  { key: 'creator', n: 7, email: 'creator@openassets.test', name: 'Cleo Creator', role: 'user', plan: 'free', sheetsUsed: 0, createdAt: '2026-01-08T09:00:00.000Z' },
];

/** Personas that get their own extraction jobs. */
export const JOB_OWNERS: PersonaKey[] = ['admin', 'free', 'pro', 'trial', 'lapsed', 'member'];

export type JobState = 'ready' | 'cropped' | 'detected';

export function jobId(owner: PersonaKey, state: JobState): string {
  return `e2e-${owner}-${state}`;
}

export const SHEET_KEY = 'originals/e2e-sheet.png';

/**
 * Fixed ObjectId (as 24 hex digits) of the n-th document of a kind. Kinds: 1 user, 2 team, 3 team member,
 * 4 invite, 5 collection, 6 folder, 7 image, 8 like, 9 sheet usage.
 */
export function seededId(kind: number, n: number): string {
  return `65e2e0${kind.toString(16).padStart(2, '0')}${n.toString(16).padStart(16, '0')}`;
}

/** Collection 1: Priya's published "Dungeon starter kit". Collection 6: the lapsed owner's team set, which Mina can only read. */
export const PUBLIC_PACK_ID = seededId(5, 1);
export const TEAM_PACK_ID = seededId(5, 2);
export const READ_ONLY_TEAM_PACK_ID = seededId(5, 6);
