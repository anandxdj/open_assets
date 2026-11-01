/**
 * Plans and entitlements, mirrored from the backend (backend/src/modules/plans).
 * entitlements.json is byte-identical on both sides (a backend test fails when
 * they drift); everything else here is the typed view of it. Never hard-code a
 * limit in a component: read it from here or from usePlan().
 */
import table from "./entitlements.json";

/** What is stored on the user. `byok` concerns Studio AI keys only. */
export type StoredPlan = "free" | "byok" | "pro";
/** What a user is entitled to right now. `byok` counts as `free`. */
export type EffectivePlan = "free" | "pro";
export type PlanSource = "admin" | "trial" | "billing";

export interface Entitlements {
  /** Sheets per calendar month (UTC). null = unlimited. */
  sheetsPerMonth: number | null;
  /** Highest export upscale factor. */
  maxUpscale: 2 | 4;
  /** Detection threshold and box padding controls in the editor. */
  paddingThresholdControls: boolean;
  customNamingPatterns: boolean;
  /** Most API keys an account may hold. 0 = none. */
  apiKeys: number;
  teamSharing: boolean;
  /** Seats on a team the account owns, the owner included. 0 = no team. */
  teamSeats: number;
}

export type EntitlementKey = keyof Entitlements;

export const ENTITLEMENT_TABLE = table.plans as unknown as Record<EffectivePlan, Entitlements>;
export const TRIAL_DAYS: number = table.trialDays;
export const DETECTION_LIMITS = table.detection;

/** Where the sign-up and sign-in flow returns to after "Start 14-day trial". */
export const TRIAL_RETURN_PATH = "/pricing?trial=1";

/** Register link that comes back to the trial. The path is encoded into `next`. */
export const TRIAL_REGISTER_HREF = `/register?next=${encodeURIComponent(TRIAL_RETURN_PATH)}`;

/**
 * AI credits (Studio and AniBuddy) every account gets each month, on every plan.
 * Mirrors MONTHLY_GRANT in backend/src/modules/usage/usage.service.ts: change both together.
 */
export const AI_CREDITS_PER_MONTH = 150;

/** Free sheets a month, from the entitlement table. */
export const FREE_SHEETS_PER_MONTH = ENTITLEMENT_TABLE.free.sheetsPerMonth as number;

/** Shape of GET /api/plans/me (data). */
export interface PlanStatus {
  /** The stored plan. Do not gate features on it; use effectivePlan. */
  plan: StoredPlan;
  effectivePlan: EffectivePlan;
  planSource: PlanSource | null;
  entitlements: Entitlements;
  sheets: {
    used: number;
    /** null = unlimited. */
    limit: number | null;
    /** null = unlimited. */
    remaining: number | null;
    /** `YYYY-MM` (UTC). */
    period: string;
    /** When the allowance resets, ISO 8601. */
    resetAt: string;
  };
  trial: {
    days: number;
    /** A trial was started on this account at some point. */
    used: boolean;
    /** The user is on Pro through a trial right now. */
    active: boolean;
    /** The user can start a trial right now. */
    eligible: boolean;
    startedAt: string | null;
    endsAt: string | null;
    daysLeft: number | null;
  };
  /** End of any time-limited Pro period (trial or timed admin grant), else null. */
  proEndsAt: string | null;
  /** What the server's storage provider can do, the same for every account. */
  capabilities: {
    /** The export's upscale is AI (Cloudinary, ImageKit). False on local storage: a plain resize. */
    aiUpscale: boolean;
    /** Kept for older servers and clients: the crop can remove enclosed background. Now true everywhere the server keyer runs. */
    enclosedBackground: boolean;
    /**
     * How the crop can remove a sheet's background. `server`: our own flat and chroma-key keyer, free, on every
     * provider. `ai`: the provider's AI removal, a paid call (false on local storage). Absent on an older server.
     */
    backgroundRemoval?: {
      server: boolean;
      ai: boolean;
      /** Whose AI add-on the removal uses, for the cost note. null when `ai` is false. */
      aiProvider: "Cloudinary" | "ImageKit" | null;
    };
  };
}

/** Codes the API puts in `code` on plan errors. */
export const PLAN_ERROR_CODES = ["PLAN_REQUIRED", "PLAN_LIMIT", "SHEET_LIMIT"] as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

export function isPlanErrorCode(code: string | undefined): code is PlanErrorCode {
  return code !== undefined && (PLAN_ERROR_CODES as readonly string[]).includes(code);
}

/** "May 1" style date for a reset or end date. */
export function formatPlanDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
