/**
 * A signed-out visitor who clicks "Start 14-day trial" goes through sign-up and
 * sign-in (email verification in between) and lands on /pricing?trial=1. The
 * trial starts there on its own only if this browser remembers the click, so a
 * link to /pricing?trial=1 cannot burn someone's one trial.
 */
const KEY = "oa.trial-intent";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function markTrialIntent(): void {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage can be blocked; the visitor just clicks the button again.
  }
}

export function hasTrialIntent(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function clearTrialIntent(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
