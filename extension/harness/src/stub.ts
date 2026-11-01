import type { AppSnapshot, QueueItem, SentItem, WorkerRequest, WorkerResponse } from '../../src/shared/contracts';
import { account, type Fixture } from './fixtures';

/**
 * A stand-in for the `chrome.*` APIs the popup and side panel use, backed by a
 * small in-memory copy of the worker's state. It answers the same messages as
 * entrypoints/background.ts, so clicking through the UI behaves like the real
 * extension without ChatGPT or the API. Install it before importing any UI
 * module: `wxt/browser` reads `globalThis.chrome` once, when it loads.
 */
export function installChromeStub(fixture: Fixture) {
  let state: AppSnapshot | null = fixture.snapshot ? structuredClone(fixture.snapshot) : null;
  const listeners = new Set<(message: unknown) => void>();
  const log = (name: string, ...args: unknown[]) => console.info(`[harness] ${name}`, ...args);
  const notify = () => listeners.forEach((listener) => listener({ type: 'SNAPSHOT_CHANGED' }));
  const now = () => new Date().toISOString();
  const mutate = (change: (current: AppSnapshot) => void) => {
    if (!state) return;
    change(state);
    notify();
  };

  async function handle(request: WorkerRequest): Promise<WorkerResponse> {
    if (request.type === 'APP_SNAPSHOT') {
      if (!state) return new Promise<WorkerResponse>(() => undefined);
      return { ok: true, snapshot: structuredClone(state) };
    }
    if (!state) return { ok: false, error: 'Unsupported request.' };
    switch (request.type) {
      case 'CONNECT_ACCOUNT': {
        const mode = fixture.connect ?? 'ok';
        if (mode === 'pending') return new Promise<WorkerResponse>(() => undefined);
        if (typeof mode === 'object') return { ok: false, error: mode.error };
        mutate((current) => { current.account = account; });
        return { ok: true, snapshot: structuredClone(state) };
      }
      case 'SIGN_OUT':
        mutate((current) => { current.account = null; current.isRunning = false; current.activeItemId = null; current.sent = []; current.notice = null; });
        return { ok: true, snapshot: structuredClone(state) };
      case 'ADD_PROMPTS':
        mutate((current) => {
          current.queue.push(...request.prompts.map((prompt, index): QueueItem => ({
            id: `new_${Date.now()}_${index}`, prompt, aspectRatio: request.aspectRatio, references: request.references ?? [],
            status: 'draft', attempts: 0, outputs: [], createdAt: now(), updatedAt: now(),
          })));
        });
        return { ok: true, snapshot: structuredClone(state) };
      case 'REMOVE_QUEUE_ITEM':
        mutate((current) => { current.queue = current.queue.filter((item) => item.id !== request.itemId); });
        return { ok: true, snapshot: structuredClone(state) };
      case 'RUN_QUEUE':
        mutate((current) => {
          current.queue = current.queue.map((item) => (item.status === 'draft' || item.status === 'paused' ? { ...item, status: 'queued', error: undefined } : item));
          current.isRunning = true;
          const first = current.queue.find((item) => item.status === 'queued');
          if (first) { first.status = 'generating'; current.activeItemId = first.id; }
        });
        return { ok: true, started: true };
      case 'PAUSE_QUEUE':
        mutate((current) => {
          current.isRunning = false;
          current.activeItemId = null;
          current.queue = current.queue.map((item) => (item.status === 'generating' ? { ...item, status: 'paused', error: request.reason } : item));
        });
        return { ok: true };
      case 'RETRY_FAILED':
        mutate((current) => {
          current.queue = current.queue.map((item) => (item.status === 'failed' ? { ...item, status: 'queued', error: undefined } : item));
          current.isRunning = true;
        });
        return { ok: true, started: true };
      case 'EXTRACT_CURRENT_IMAGE':
        return fixture.extractError ? { ok: false, error: fixture.extractError, ...(fixture.extractCode ? { code: fixture.extractCode } : {}) } : { ok: true };
      case 'EXTRACT_IMAGE_URL': {
        const mode = fixture.sendResult ?? 'ok';
        if (mode === 'pending') return new Promise<WorkerResponse>(() => undefined);
        if (typeof mode === 'object') return { ok: false, error: mode.error, ...(mode.code ? { code: mode.code } : {}) };
        const jobId = `job_new_${Date.now()}`;
        const row: SentItem = { jobId, fileName: request.fileName ?? 'openassets-new.png', sentAt: now(), via: request.via ?? 'page', status: 'queued' };
        mutate((current) => { current.sent = [row, ...current.sent]; });
        log('tabs.create', { url: `/editor/${jobId}` });
        return { ok: true, jobId };
      }
      case 'SENT_REFRESH':
        if (fixture.refreshError) return { ok: false, error: fixture.refreshError };
        if (fixture.advance) {
          mutate((current) => {
            current.sent = current.sent.map((row) => (row.status === 'queued' ? { ...row, status: 'detecting' } : row.status === 'detecting' ? { ...row, status: 'ready' } : row));
          });
        }
        return { ok: true };
      case 'CLEAR_SENT':
        mutate((current) => { current.sent = []; });
        return { ok: true };
      case 'DISMISS_NOTICE':
        mutate((current) => { current.notice = null; });
        return { ok: true };
      default:
        log('unhandled worker request', request);
        return { ok: true };
    }
  }

  const event = () => ({ addListener: () => undefined, removeListener: () => undefined, hasListener: () => false });
  const storageArea = () => {
    const data: Record<string, unknown> = {};
    return {
      get: async (keys?: string | string[]) => (typeof keys === 'string' ? { [keys]: data[keys] } : Array.isArray(keys) ? Object.fromEntries(keys.map((key) => [key, data[key]])) : { ...data }),
      set: async (items: Record<string, unknown>) => { Object.assign(data, items); },
      remove: async (keys: string | string[]) => { [keys].flat().forEach((key) => delete data[key]); },
      clear: async () => { Object.keys(data).forEach((key) => delete data[key]); },
    };
  };

  const shortcut = fixture.shortcut ?? 'Alt+Shift+E';
  const chromeStub = {
    runtime: {
      id: 'harness',
      getURL: (path: string) => `/${path}`,
      sendMessage: (message: WorkerRequest) => handle(message),
      onMessage: {
        addListener: (listener: (message: unknown) => void) => listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) => listeners.delete(listener),
        hasListener: (listener: (message: unknown) => void) => listeners.has(listener),
      },
    },
    commands: {
      getAll: async () => [{ name: 'extract-image', description: 'Extract the last selected image', shortcut }],
      onCommand: event(),
    },
    sidePanel: { open: async (options: unknown) => log('sidePanel.open', options) },
    windows: { WINDOW_ID_CURRENT: -2 },
    tabs: {
      create: async (options: unknown) => { log('tabs.create', options); return { id: 1 }; },
      query: async () => [],
      sendMessage: async () => undefined,
    },
    storage: { local: storageArea(), session: storageArea(), onChanged: event() },
    identity: { getRedirectURL: (path = '') => `https://harness.invalid/${path}`, launchWebAuthFlow: async () => undefined },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [] },
    downloads: { download: async () => 1 },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined, setTitle: async () => undefined },
    alarms: { create: async () => undefined, onAlarm: event() },
    contextMenus: { create: () => undefined, onClicked: event() },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
}
