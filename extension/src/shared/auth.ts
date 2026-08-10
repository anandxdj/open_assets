import type { Account, AuthSnapshot } from './contracts';
import { clearAuth, getAuth, saveAuth } from './storage';
import { browser } from 'wxt/browser';

const apiUrl = import.meta.env.WXT_PUBLIC_API_URL || 'https://openasset-backend.anands.dev';
const frontendUrl = import.meta.env.WXT_PUBLIC_FRONTEND_URL || 'https://openassets.anands.dev';

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
  if (!response.ok || !payload?.data) throw new Error(payload?.message || 'Could not verify your OpenAssets session.');
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

export async function refreshAccount(): Promise<AuthSnapshot> {
  const current = await getAuth();
  if (!current.deviceToken) return current;
  if (current.accessToken) return current;
  try {
    const data = await request('/api/auth/extension/refresh', { method: 'POST', body: JSON.stringify({ deviceToken: current.deviceToken }) });
    const next = { account: data.user, accessToken: data.accessToken, deviceToken: data.deviceToken };
    await saveAuth(next);
    return next;
  } catch {
    await clearAuth();
    return { account: null, accessToken: null, deviceToken: null };
  }
}

export async function requireAccount(): Promise<AuthSnapshot> {
  const auth = await refreshAccount();
  if (!auth.account || !auth.accessToken) throw new Error('Sign in to OpenAssets to use the extension.');
  return auth;
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
