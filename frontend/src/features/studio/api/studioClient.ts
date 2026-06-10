// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Fetch wrapper for the Next.js /api/studio/* routes. Unlike @/lib/api-client
// (which prefixes the Express URL), these are relative same-origin calls.
// Attaches the user's JWT for the free tier and the BYOK OpenRouter key when set.
import { tokenStore } from "@/lib/token-store";
import { refreshAccessToken } from "@/lib/api-client";
import { STORAGE_KEY } from "@/features/studio/lib/app";

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

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const byok = getByokKey();
  if (byok) headers["X-OpenRouter-Key"] = byok;
  const token = tokenStore.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * POST to a studio route. Throws StudioApiError with `code` set for the two
 * cases the UI must handle specially:
 *  - AUTH_REQUIRED (401): prompt sign-in or BYOK
 *  - INSUFFICIENT_CREDITS (402): prompt BYOK / upsell
 */
export async function studioPost<T>(path: string, body: unknown): Promise<T> {
  const send = () =>
    fetch(path, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });

  let res = await send();

  // Free-tier path: access token may have expired — refresh once and retry.
  if (res.status === 401 && !getByokKey() && tokenStore.get()) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await send();
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    throw new StudioApiError(
      res.status,
      payload.error ?? `Request failed (${res.status})`,
      payload.code,
    );
  }

  return res.json() as Promise<T>;
}
