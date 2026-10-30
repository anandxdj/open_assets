// Credits shared by Studio and AniBuddy. The backend (modules/usage) owns the
// balance: 150 AI credits a month for every plan, granted on the 1st. Nothing here decides
// what a call costs; the client only reports and refreshes.

export type CreditsInfo = {
  credits: number;
  plan: "free" | "byok" | "pro";
  monthlyGrant: number;
  resetAt: string;
};

/** Balance at or below this reads as "low" in the chrome. */
export const LOW_CREDITS = 15;

/**
 * A credit-spending request finished. `studioPost` announces it so whichever
 * provider is mounted can refresh the balance without every tool wiring it up.
 * "insufficient" is the backend's 402.
 */
export const CREDITS_EVENT = "oa:credits";
export type CreditsOutcome = "ok" | "insufficient" | "failed";

export function announceCreditsActivity(outcome: CreditsOutcome): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CreditsOutcome>(CREDITS_EVENT, { detail: outcome }));
}

/** The 1st of next month, 00:00 UTC. Matches the backend's lazy monthly grant. */
export function nextResetDate(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** "1 November" or "November 1", in the viewer's locale. */
export function formatResetDate(resetAt?: string | Date | null): string {
  const date = resetAt ? new Date(resetAt) : nextResetDate();
  const valid = Number.isNaN(date.getTime()) ? nextResetDate() : date;
  return valid.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });
}

export function creditsLabel(count: number): string {
  return `${count} AI ${count === 1 ? "credit" : "credits"}`;
}

/** One sentence for inline errors and toasts. */
export function creditsShortfallMessage(resetAt?: string | null): string {
  return `You're out of AI credits. They reset on ${formatResetDate(resetAt)}.`;
}
