import { authedFetch, requireAccount } from './auth';
import { browser } from 'wxt/browser';
import { frontendUrl } from './config';
import { failureFromResponse } from './errors';
import { addSent, fileNameForImage } from './sent';
import { updateSent } from './storage';
import type { SentItem } from './contracts';

const CHATGPT_HOST = 'chatgpt.com';
const GONE_FROM_CHATGPT = 'That image is no longer available from ChatGPT. Open the conversation and use Extract on the page instead.';

export interface ExtractOptions {
  /** Where the image came from; the Library's "Send to Extract" passes 'library'. */
  via?: SentItem['via'];
  /** Name to upload under; defaults to a name derived from the URL. */
  fileName?: string;
}

/** ChatGPT image URLs need the browser's chatgpt.com cookies; the extension has a host permission for the site. */
function fetchInit(imageUrl: string): RequestInit | undefined {
  try {
    return new URL(imageUrl).hostname === CHATGPT_HOST ? { credentials: 'include' } : undefined;
  } catch {
    return undefined;
  }
}

async function downloadImage(imageUrl: string, via: SentItem['via']): Promise<Blob> {
  let source: Response;
  try {
    source = await fetch(imageUrl, fetchInit(imageUrl));
  } catch (error) {
    // A library image comes from a ChatGPT link that stops working; say so instead of "Failed to fetch".
    if (via === 'library') throw new Error(GONE_FROM_CHATGPT);
    throw error;
  }
  if (!source.ok) throw new Error(via === 'library' ? GONE_FROM_CHATGPT : 'OpenAssets could not download that image.');
  const blob = await source.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Choose an image file to extract.');
  return blob;
}

/**
 * The web app's extraction flow: upload the image (the API checks the plan's
 * sheet allowance and the file), then open the editor on the new job. A
 * successful send is added to "Sent from this browser". Only called for an
 * image the user picked: nothing here runs on its own.
 */
export async function extractImage(imageUrl: string, options: ExtractOptions = {}): Promise<{ jobId: string }> {
  await requireAccount();
  const via = options.via ?? 'page';
  const blob = await downloadImage(imageUrl, via);
  const fileName = options.fileName?.trim() || fileNameForImage(imageUrl, blob.type);
  const form = new FormData();
  form.append('image', blob, fileName);
  const response = await authedFetch('/api/upload', { method: 'POST', body: form });
  const payload = await response.json().catch(() => null) as { data?: { jobId?: string }; message?: string; code?: string } | null;
  const jobId = payload?.data?.jobId;
  if (!response.ok || !jobId) throw failureFromResponse(response.status, payload, 'OpenAssets could not start extraction.');
  await updateSent((items) => addSent(items, { jobId, fileName, sentAt: new Date().toISOString(), via, status: 'queued' }));
  await browser.tabs.create({ url: `${frontendUrl}/editor/${jobId}` });
  return { jobId };
}
