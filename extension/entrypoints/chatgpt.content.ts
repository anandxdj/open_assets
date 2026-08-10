import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import type { ChatGptEvent, QueueItem } from '../src/shared/contracts';

const notify = (event: ChatGptEvent) => browser.runtime.sendMessage({ type: 'CHATGPT_EVENT', event });

function composer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"], textarea[placeholder]');
}

function submitButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[data-testid*="send"], button[aria-label*="Send" i]');
}

function setComposer(node: HTMLElement, value: string) {
  node.focus();
  if (node instanceof HTMLTextAreaElement) node.value = value;
  else node.textContent = value;
  node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}

async function attachReferences(item: QueueItem): Promise<void> {
  if (!item.references.length) return;
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('ChatGPT did not expose its reference-image control.');
  const transfer = new DataTransfer();
  for (const reference of item.references) {
    const response = await fetch(reference.dataUrl);
    transfer.items.add(new File([await response.blob()], reference.name, { type: reference.mimeType }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 800));
}

function generatedImages(before: Set<string>) {
  return [...document.querySelectorAll<HTMLImageElement>('main img')].filter((image) => image.currentSrc && !before.has(image.currentSrc) && image.naturalWidth >= 256).map((image) => image.currentSrc);
}

async function run(item: QueueItem) {
  const input = composer();
  const send = submitButton();
  if (!input || !send) { await notify({ type: 'NEEDS_LOGIN' }); return; }
  try {
    await notify({ type: 'PROGRESS', itemId: item.id, status: 'uploading_refs' });
    await attachReferences(item);
    const before = new Set([...document.querySelectorAll<HTMLImageElement>('main img')].map((image) => image.currentSrc));
    const ratioHint = item.aspectRatio === 'auto' ? '' : `\n\nAspect ratio: ${item.aspectRatio}.`;
    await notify({ type: 'PROGRESS', itemId: item.id, status: 'submitting' });
    setComposer(input, `${item.prompt}${ratioHint}`);
    send.click();
    await notify({ type: 'PROGRESS', itemId: item.id, status: 'generating' });
    const deadline = Date.now() + 180_000;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const images = generatedImages(before);
      if (images.length) {
        stableSince ||= Date.now();
        if (Date.now() - stableSince > 3500) {
          await notify({ type: 'COMPLETE', itemId: item.id, conversationUrl: location.href, outputs: images.map((sourceUrl) => ({ sourceUrl, sourceId: crypto.randomUUID() })) });
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('ChatGPT took too long. The queue was paused safely.');
  } catch (error) {
    await notify({ type: 'FAILED', itemId: item.id, error: error instanceof Error ? error.message : 'ChatGPT automation failed.' });
  }
}

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  main() {
    browser.runtime.onMessage.addListener((message: { type?: string; item?: QueueItem }) => {
      if (message.type === 'OPENASSETS_RUN_ITEM' && message.item) void run(message.item);
    });
    void notify({ type: 'READY', conversationUrl: location.href });
  },
});
