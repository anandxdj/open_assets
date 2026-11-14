import type { Account, AuthSnapshot } from './contracts';
import { clearAuth, getAuth, saveAuth } from './storage';
import { browser } from 'wxt/browser';
import { apiUrl, frontendUrl } from './config';
import { fetchWithAuth, isSessionRejected, singleFlight } from './api';
import { failureFromResponse } from './errors';

type TokenPayload = { accessToken: string; deviceToken: string; user: Account };

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null) as { data?: TokenPayload; message?: string } | null;
  if (!response.ok || !payload?.data) throw failureFromResponse(response.status, payload, 'Could not verify your OpenAssets session.');
  return payload.data;
}

export async function connectAccount(): Promise<Account> {
  const redirectUri = browser.identity.getRedirectURL('auth');
  const state = crypto.randomUUID();
  const { verifier, challenge } = await pkce();
  const url = new URL(`${frontendUrl}/extension/connect`);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  const resultUrl = await browser.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  if (!resultUrl) throw new Error('OpenAssets sign-in was cancelled.');
  const returned = new URL(resultUrl);
  if (returned.searchParams.get('state') !== state) throw new Error('The sign-in response could not be verified.');
  const code = returned.searchParams.get('code');
  if (!code) throw new Error('OpenAssets did not return an authorization code.');
  const data = await request('/api/auth/extension/token', { method: 'POST', body: JSON.stringify({ code, redirectUri, codeVerifier: verifier }) });
  await saveAuth({ account: data.user, accessToken: data.accessToken, deviceToken: data.deviceToken });
  return data.user;
}

const signedOutAuth = (): AuthSnapshot => ({ account: null, accessToken: null, deviceToken: null });

/**
 * Trades the device token for a new access token. Shared between callers (the
 * device token rotates on every refresh, so two at once would sign the user
 * out). The session is dropped only when the server rejects it; offline or a
 * server error leaves the user signed in and throws.
 */
export const refreshAccount = singleFlight(async (): Promise<AuthSnapshot> => {
  const current = await getAuth();
  if (!current.deviceToken) return current;
  try {
    const data = await request('/api/auth/extension/refresh', { method: 'POST', body: JSON.stringify({ deviceToken: current.deviceToken }) });
    const next = { account: data.user, accessToken: data.accessToken, deviceToken: data.deviceToken };
    await saveAuth(next);
    return next;
  } catch (error) {
    if (!isSessionRejected(error)) throw error;
    await clearAuth();
    return signedOutAuth();
  }
});

/** The stored session, with a fresh access token when the browser restart dropped it. */
async function currentAuth(): Promise<AuthSnapshot> {
  const current = await getAuth();
  if (!current.deviceToken || current.accessToken) return current;
  return refreshAccount();
}

export async function requireAccount(): Promise<AuthSnapshot> {
  const auth = await currentAuth();
  if (!auth.account || !auth.accessToken) throw new Error('Sign in to OpenAssets to use the extension.');
  return auth;
}

/**
 * A call to the API with the signed-in user's access token. The token lives
 * 15 minutes, so a 401 is retried once with a refreshed one.
 */
export function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithAuth(`${apiUrl}${path}`, init, {
    getAccessToken: async () => (await requireAccount()).accessToken!,
    refreshAccessToken: async (rejected) => {
      // Another call may have refreshed while this one was in flight.
      const latest = await getAuth();
      if (latest.accessToken && latest.accessToken !== rejected) return latest.accessToken;
      const next = await refreshAccount();
      if (!next.accessToken) throw new Error('Sign in to OpenAssets to use the extension.');
      return next.accessToken;
    },
  });
}

export async function signOut(): Promise<void> {
  const auth = await getAuth();
  if (auth.deviceToken) {
    await fetch(`${apiUrl}/api/auth/extension/session/current`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: auth.deviceToken }),
    }).catch(() => undefined);
  }
  await clearAuth();
}
