import type { AppSnapshot, AuthSnapshot, LibraryItem, QueueItem } from './contracts';
import { browser } from 'wxt/browser';

const AUTH_KEY = 'auth';
const SNAPSHOT_KEY = 'snapshot';
const QUEUE_KEY = 'queue';
const LIBRARY_KEY = 'library';

const emptyAuth = (): AuthSnapshot => ({ account: null, accessToken: null, deviceToken: null });

export async function getAuth(): Promise<AuthSnapshot> {
  const value = await browser.storage.local.get(AUTH_KEY);
  const local = (value[AUTH_KEY] as Pick<AuthSnapshot, 'account' | 'deviceToken'> | undefined) ?? {};
  const session = await browser.storage.session.get(AUTH_KEY);
  const accessToken = (session[AUTH_KEY] as { accessToken?: string } | undefined)?.accessToken ?? null;
  return { ...emptyAuth(), ...local, accessToken };
}

export async function saveAuth(auth: AuthSnapshot): Promise<void> {
  await Promise.all([
    browser.storage.local.set({ [AUTH_KEY]: { account: auth.account, deviceToken: auth.deviceToken } }),
    browser.storage.session.set({ [AUTH_KEY]: { accessToken: auth.accessToken } }),
  ]);
}

export async function clearAuth(): Promise<void> {
  await Promise.all([browser.storage.local.remove(AUTH_KEY), browser.storage.session.remove(AUTH_KEY)]);
}

export async function getQueue(): Promise<QueueItem[]> {
  return ((await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as QueueItem[] | undefined) ?? [];
}

export async function saveQueue(queue: QueueItem[]): Promise<void> {
  await browser.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function getLibrary(): Promise<LibraryItem[]> {
  return ((await browser.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY] as LibraryItem[] | undefined) ?? [];
}

export async function saveLibrary(library: LibraryItem[]): Promise<void> {
  await browser.storage.local.set({ [LIBRARY_KEY]: library });
}

export async function getSnapshot(): Promise<AppSnapshot> {
  const [auth, queue, library, saved] = await Promise.all([getAuth(), getQueue(), getLibrary(), browser.storage.session.get(SNAPSHOT_KEY)]);
  const runtime = saved[SNAPSHOT_KEY] as Pick<AppSnapshot, 'isRunning' | 'activeItemId'> | undefined;
  return { account: auth.account, queue, library, isRunning: runtime?.isRunning ?? false, activeItemId: runtime?.activeItemId ?? null };
}

export async function saveRuntime(snapshot: Pick<AppSnapshot, 'isRunning' | 'activeItemId'>): Promise<void> {
  await browser.storage.session.set({ [SNAPSHOT_KEY]: snapshot });
}
