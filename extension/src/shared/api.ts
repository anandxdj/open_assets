import { ApiFailure } from './errors';

/**
 * Authenticated API calls, kept free of browser APIs so the retry and
 * session rules can be tested in Node. `auth.ts` supplies the real token
 * functions.
 */

export interface AuthDeps {
  /** The access token to send; throws when nobody is signed in. */
  getAccessToken: () => Promise<string>;
  /**
   * A fresh access token after the API rejected `rejected`. It may return the
   * stored token when another call already refreshed it. Throws when the session is gone.
   */
  refreshAccessToken: (rejected: string) => Promise<string>;
  fetchImpl?: typeof fetch;
}

/**
 * Sends the request with the access token. The token lives 15 minutes, so a
 * 401 gets exactly one retry with a refreshed token; any other answer
 * (including a second 401) is returned as it is.
 */
export async function fetchWithAuth(url: string, init: RequestInit, deps: AuthDeps): Promise<Response> {
  const send = (token: string) => (deps.fetchImpl ?? fetch)(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  const token = await deps.getAccessToken();
  const response = await send(token);
  if (response.status !== 401) return response;
  return send(await deps.refreshAccessToken(token));
}

/**
 * Shares one running call between concurrent callers. The device token
 * rotates on every refresh, so two parallel refreshes would invalidate each
 * other and sign the user out.
 */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (!running) {
      running = task().finally(() => { running = null; });
    }
    return running;
  };
}

/**
 * True when the server itself turned the device session down (expired,
 * revoked, user gone). A network error or a 5xx is not that: the session may
 * still be good, so the user stays signed in.
 */
export function isSessionRejected(error: unknown): boolean {
  return error instanceof ApiFailure && (error.status === 401 || error.status === 403);
}
