// Server-side lookup of the sign-in methods the API can complete, so the sign-in and sign-up pages
// are rendered with or without "Continue with Google" and the button never flashes in or out.
// Call it only from a server component.

const API_URL = process.env.EXPRESS_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface AuthProviders {
  google: boolean;
}

/** What the API reports at /api/auth/providers, cached for a minute. If it cannot be reached, extra methods stay hidden. */
export async function getAuthProviders(): Promise<AuthProviders> {
  try {
    const res = await fetch(`${API_URL}/api/auth/providers`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { google: false };
    const body = (await res.json()) as { data?: { google?: unknown } };
    return { google: body.data?.google === true };
  } catch {
    return { google: false };
  }
}
