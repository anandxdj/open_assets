import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { connectAccount, requireAccount, signOut } from '../src/shared/auth';
import type { AppSnapshot, ChatGptEvent, QueueItem, WorkerRequest, WorkerResponse } from '../src/shared/contracts';
import { getLibrary, getQueue, getSnapshot, saveLibrary, saveQueue, saveRuntime } from '../src/shared/storage';
import { extractImage } from '../src/shared/extract';

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

async function snapshot(): Promise<AppSnapshot> {
  return getSnapshot();
}

async function publish(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'SNAPSHOT_CHANGED' }).catch(() => undefined);
}

async function updateQueue(mutator: (queue: QueueItem[]) => QueueItem[]): Promise<QueueItem[]> {
  const queue = mutator(await getQueue());
  await saveQueue(queue);
  await publish();
  return queue;
}

async function activeChatGptTab() {
  const tabs = await browser.tabs.query({ url: 'https://chatgpt.com/*' });
  const existing = tabs.find((tab) => tab.active) ?? tabs[0];
  if (existing?.id) return existing;
  const created = await browser.tabs.create({ url: 'https://chatgpt.com/' });
  if (!created.id) throw new Error('Could not open ChatGPT.');
  return created;
}

async function startNext(): Promise<void> {
  const app = await snapshot();
  if (!app.isRunning || app.activeItemId) return;
  const next = app.queue.find((item) => item.status === 'queued');
  if (!next) {
    await saveRuntime({ isRunning: false, activeItemId: null });
    await publish();
    return;
  }
  const tab = await activeChatGptTab();
  await updateQueue((items) => items.map((item) => item.id === next.id ? { ...item, status: 'preparing', updatedAt: now() } : item));
  await saveRuntime({ isRunning: true, activeItemId: next.id });
  await browser.tabs.sendMessage(tab.id!, { type: 'OPENASSETS_RUN_ITEM', item: next }).catch(async () => {
    await updateQueue((items) => items.map((item) => item.id === next.id ? { ...item, status: 'paused', error: 'Open ChatGPT and reload the tab, then resume.', updatedAt: now() } : item));
    await saveRuntime({ isRunning: false, activeItemId: null });
  });
  await publish();
}

async function recordChatGptEvent(event: ChatGptEvent): Promise<void> {
  if (event.type === 'READY') return;
  if (event.type === 'NEEDS_LOGIN') {
    await updateQueue((items) => items.map((item) => item.status === 'preparing' ? { ...item, status: 'paused', error: 'Sign in to ChatGPT, then resume.', updatedAt: now() } : item));
    await saveRuntime({ isRunning: false, activeItemId: null });
    return;
  }
  if (event.type === 'PROGRESS') {
    await updateQueue((items) => items.map((item) => item.id === event.itemId ? { ...item, status: event.status, updatedAt: now() } : item));
    return;
  }
  if (event.type === 'FAILED') {
    await updateQueue((items) => items.map((item) => item.id === event.itemId ? { ...item, status: 'failed', error: event.error, updatedAt: now() } : item));
  }
  if (event.type === 'COMPLETE') {
    const queue = await getQueue();
    const item = queue.find((candidate) => candidate.id === event.itemId);
    if (!item) return;
    const outputs = await Promise.all(event.outputs.map(async (output, index) => {
      const filename = `openassets-${item.id.slice(0, 8)}-${index + 1}.png`;
      const downloadId = await browser.downloads.download({ url: output.sourceUrl, filename, conflictAction: 'uniquify', saveAs: false });
      return { id: output.sourceId, sourceUrl: output.sourceUrl, filename, downloadId, createdAt: now() };
    }));
    await updateQueue((items) => items.map((candidate) => candidate.id === event.itemId ? { ...candidate, status: 'completed', outputs, sourceConversationUrl: event.conversationUrl, updatedAt: now() } : candidate));
    const library = await getLibrary();
    await saveLibrary([{ id: item.id, prompt: item.prompt, sourceConversationUrl: event.conversationUrl, outputs, createdAt: now() }, ...library]);
  }
  await saveRuntime({ isRunning: true, activeItemId: null });
  await publish();
  await startNext();
}

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    if (request.type === 'APP_SNAPSHOT') return { ok: true, snapshot: await snapshot() };
    if (request.type === 'CONNECT_ACCOUNT') { await connectAccount(); return { ok: true, snapshot: await snapshot() }; }
    if (request.type === 'SIGN_OUT') { await signOut(); await saveRuntime({ isRunning: false, activeItemId: null }); return { ok: true, snapshot: await snapshot() }; }
    await requireAccount();
    if (request.type === 'ADD_PROMPTS') {
      const additions = request.prompts.filter(Boolean).map((prompt): QueueItem => ({ id: id(), prompt, aspectRatio: request.aspectRatio, references: request.references ?? [], status: 'draft', attempts: 0, outputs: [], createdAt: now(), updatedAt: now() }));
      await updateQueue((queue) => [...queue, ...additions]);
      return { ok: true, snapshot: await snapshot() };
    }
    if (request.type === 'UPDATE_QUEUE_ITEM') { await updateQueue((queue) => queue.map((item) => item.id === request.item.id ? { ...request.item, updatedAt: now() } : item)); return { ok: true, snapshot: await snapshot() }; }
    if (request.type === 'REMOVE_QUEUE_ITEM') { await updateQueue((queue) => queue.filter((item) => item.id !== request.itemId)); return { ok: true, snapshot: await snapshot() }; }
    if (request.type === 'RUN_QUEUE') { await updateQueue((queue) => queue.map((item) => item.status === 'draft' || item.status === 'paused' ? { ...item, status: 'queued', error: undefined, updatedAt: now() } : item)); await saveRuntime({ isRunning: true, activeItemId: null }); await startNext(); return { ok: true, started: true }; }
    if (request.type === 'PAUSE_QUEUE') { await saveRuntime({ isRunning: false, activeItemId: null }); await updateQueue((queue) => queue.map((item) => ['preparing', 'uploading_refs', 'submitting', 'generating', 'downloading'].includes(item.status) ? { ...item, status: 'paused', error: request.reason, updatedAt: now() } : item)); return { ok: true }; }
    if (request.type === 'RETRY_FAILED') { await updateQueue((queue) => queue.map((item) => item.status === 'failed' ? { ...item, status: 'queued', attempts: item.attempts + 1, error: undefined, updatedAt: now() } : item)); await saveRuntime({ isRunning: true, activeItemId: null }); await startNext(); return { ok: true, started: true }; }
    if (request.type === 'CHATGPT_EVENT') { await recordChatGptEvent(request.event); return { ok: true }; }
    if (request.type === 'EXTRACT_CURRENT_IMAGE') {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url?.startsWith('http')) throw new Error('Open a webpage with an image first.');
      const origin = new URL(tab.url).origin + '/*';
      const granted = await browser.permissions.contains({ origins: [origin] });
      if (!granted && !(await browser.permissions.request({ origins: [origin] }))) throw new Error('Page access is needed to select an image.');
      await browser.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const previous = document.querySelector<HTMLElement>('[data-openassets-picker]');
        previous?.remove();
        const hint = document.createElement('div');
        hint.dataset.openassetsPicker = 'true';
        hint.textContent = 'OpenAssets: click an image to extract, or press Escape to cancel';
        hint.style.cssText = 'position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:8px;background:#20201d;color:#fff;font:600 13px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.28)';
        document.documentElement.append(hint);
        const cleanup = () => { hint.remove(); document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); };
        const onClick = (event: MouseEvent) => { const image = (event.target as Element | null)?.closest('img'); if (!image || !(image as HTMLImageElement).currentSrc) return; event.preventDefault(); event.stopPropagation(); chrome.runtime.sendMessage({ type: 'EXTRACT_IMAGE_URL', imageUrl: (image as HTMLImageElement).currentSrc }); cleanup(); };
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cleanup(); };
        document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey, true);
      } });
      return { ok: true };
    }
    if (request.type === 'EXTRACT_IMAGE_URL') { await extractImage(request.imageUrl); return { ok: true }; }
    return { ok: false, error: 'Unsupported request.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unexpected extension error.' };
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: 'openassets-extract', title: 'Extract with OpenAssets', contexts: ['image'] });
  });
  browser.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== 'openassets-extract' || !info.srcUrl) return;
    const result = await handle({ type: 'EXTRACT_IMAGE_URL', imageUrl: info.srcUrl });
    if (!result.ok) await browser.notifications?.create?.({ type: 'basic', iconUrl: '/icon/48.png', title: 'OpenAssets', message: result.error });
  });
  browser.commands.onCommand.addListener(async (command) => { if (command === 'extract-image') await handle({ type: 'EXTRACT_CURRENT_IMAGE' }); });
  browser.runtime.onMessage.addListener((request: WorkerRequest) => handle(request));
  browser.alarms.create('openassets-resume', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'openassets-resume') void startNext(); });
});
