// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Fetch wrapper for the Next.js /api/studio/* routes (and AniBuddy's, which
// share the credits rules). Unlike @/lib/api-client (which prefixes the Express
// URL), these are relative same-origin calls. Attaches the user's JWT for the
// free tier and the BYOK OpenRouter key when set.
import { toast } from "sonner";
import { tokenStore } from "@/lib/token-store";
import { refreshAccessToken } from "@/lib/api-client";
import { STORAGE_KEY } from "@/features/studio/lib/app";
import { announceCreditsActivity, creditsShortfallMessage } from "@/features/usage/credits";

export class StudioApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getByokKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function buildHeaders(byok: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (byok) headers["X-OpenRouter-Key"] = byok;
  const token = tokenStore.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * POST to a studio route. Throws StudioApiError with `code` set for the two
 * cases the UI must handle specially:
 *  - AUTH_REQUIRED (401): the session ended; sign in again
 *  - INSUFFICIENT_CREDITS (402): out of credits until the monthly reset
 *
 * `byok: false` is for routes that never take a user key (AniBuddy): the key
 * is not sent and the request always uses, and spends, credits.
 *
 * Every request that can spend credits announces its outcome so the balance
 * in the page chrome refreshes; BYOK requests spend nothing and stay quiet.
 */
export async function studioPost<T>(
  path: string,
  body: unknown,
  options: { byok?: boolean } = {},
): Promise<T> {
  const byok = options.byok === false ? "" : getByokKey();
  const send = () =>
    fetch(path, {
      method: "POST",
      headers: buildHeaders(byok),
      body: JSON.stringify(body),
    });

  let outcome: "ok" | "insufficient" | "failed" = "failed";
  try {
    let res = await send();

    // Free-tier path: access token may have expired — refresh once and retry.
    if (res.status === 401 && !byok && tokenStore.get()) {
      const newToken = await refreshAccessToken();
      if (newToken) res = await send();
    }

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (res.status === 402) {
        outcome = "insufficient";
        throw new StudioApiError(402, creditsShortfallMessage(), "INSUFFICIENT_CREDITS");
      }
      throw new StudioApiError(
        res.status,
        payload.error ?? `Request failed (${res.status})`,
        payload.code,
      );
    }

    outcome = "ok";
    return (await res.json()) as T;
  } finally {
    if (!byok) announceCreditsActivity(outcome);
  }
}

/**
 * Toast for a failed Studio action. Running out of credits is not toasted: the
 * notice under the top bar already says so and when credits reset.
 */
export function reportStudioError(err: unknown): void {
  if (err instanceof StudioApiError) {
    if (err.code === "INSUFFICIENT_CREDITS") return;
    if (err.code === "AUTH_REQUIRED") {
      toast.error("Your session ended. Sign in again to keep generating.");
      return;
    }
  }
  toast.error(err instanceof Error ? err.message : "An error occurred");
}
