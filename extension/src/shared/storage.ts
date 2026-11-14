import type { AppNotice, AppSnapshot, AuthSnapshot, LibraryItem, QueueItem, SentItem } from './contracts';
import { pruneSent, sentForAccount } from './sent';
import { browser } from 'wxt/browser';

const AUTH_KEY = 'auth';
const SNAPSHOT_KEY = 'snapshot';
const QUEUE_KEY = 'queue';
const LIBRARY_KEY = 'library';
const SENT_KEY = 'sent';
const NOTICE_KEY = 'notice';

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

/**
 * Signs the extension out locally. This is also where everything that belongs
 * to the account is dropped: the "Sent from this browser" list and any failure
 * waiting to be shown. Every sign-out path (the menu, a rejected device
 * session) goes through here.
 */
export async function clearAuth(): Promise<void> {
  await Promise.all([
    browser.storage.local.remove([AUTH_KEY, SENT_KEY]),
    browser.storage.session.remove([AUTH_KEY, NOTICE_KEY]),
  ]);
}

// "Sent from this browser": rows live in local storage next to the id of the
// account that sent them (see sent.ts for what a row holds and what it never does).
let sentChain: Promise<unknown> = Promise.resolve();

async function readSent(accountId: string | null): Promise<SentItem[]> {
  const stored = (await browser.storage.local.get(SENT_KEY))[SENT_KEY] as { accountId?: string; items?: SentItem[] } | undefined;
  return sentForAccount(stored, accountId);
}

/**
 * Read, change and save the list as one step. Calls run one after another, so
 * a status refresh and a new send cannot overwrite each other. Does nothing
 * (and returns an empty list) when nobody is signed in, so a refresh that
 * finishes after sign-out cannot bring the list back.
 */
export function updateSent(mutate: (items: SentItem[]) => SentItem[]): Promise<SentItem[]> {
  const run = sentChain.then(async () => {
    const { account } = await getAuth();
    if (!account) return [];
    const next = pruneSent(mutate(await readSent(account.id)));
    await browser.storage.local.set({ [SENT_KEY]: { accountId: account.id, items: next } });
    return next;
  });
  sentChain = run.catch(() => undefined);
  return run;
}

export async function clearSent(): Promise<void> {
  await updateSent(() => []);
}

export async function getNotice(): Promise<AppNotice | null> {
  return ((await browser.storage.session.get(NOTICE_KEY))[NOTICE_KEY] as AppNotice | undefined) ?? null;
}

export async function saveNotice(notice: AppNotice): Promise<void> {
  await browser.storage.session.set({ [NOTICE_KEY]: notice });
}

export async function clearNotice(): Promise<void> {
  await browser.storage.session.remove(NOTICE_KEY);
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
  const [auth, queue, library, saved, notice] = await Promise.all([getAuth(), getQueue(), getLibrary(), browser.storage.session.get(SNAPSHOT_KEY), getNotice()]);
  const runtime = saved[SNAPSHOT_KEY] as Pick<AppSnapshot, 'isRunning' | 'activeItemId'> | undefined;
  const sent = auth.account ? await readSent(auth.account.id) : [];
  return { account: auth.account, queue, library, isRunning: runtime?.isRunning ?? false, activeItemId: runtime?.activeItemId ?? null, sent, notice: auth.account ? notice : null };
}

export async function saveRuntime(snapshot: Pick<AppSnapshot, 'isRunning' | 'activeItemId'>): Promise<void> {
  await browser.storage.session.set({ [SNAPSHOT_KEY]: snapshot });
}
