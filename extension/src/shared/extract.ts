import { requireAccount } from './auth';
import { browser } from 'wxt/browser';

const apiUrl = import.meta.env.WXT_PUBLIC_API_URL || 'https://openasset-backend.anands.dev';
const frontendUrl = import.meta.env.WXT_PUBLIC_FRONTEND_URL || 'https://openassets.anands.dev';

export async function extractImage(imageUrl: string): Promise<void> {
  const auth = await requireAccount();
  const source = await fetch(imageUrl);
  if (!source.ok) throw new Error('OpenAssets could not download that image.');
  const blob = await source.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Choose an image file to extract.');
  const form = new FormData();
  form.append('image', blob, `openassets-${Date.now()}.${blob.type.split('/')[1] || 'png'}`);
  const response = await fetch(`${apiUrl}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}` }, body: form });
  const payload = await response.json().catch(() => null) as { data?: { jobId?: string }; message?: string } | null;
  const jobId = payload?.data?.jobId;
  if (!response.ok || !jobId) throw new Error(payload?.message || 'OpenAssets could not start extraction.');
  await browser.tabs.create({ url: `${frontendUrl}/editor/${jobId}` });
}
