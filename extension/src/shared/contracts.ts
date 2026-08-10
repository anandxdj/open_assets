import { z } from 'zod';

export const queueStatusSchema = z.enum([
  'draft', 'queued', 'preparing', 'uploading_refs', 'submitting', 'generating',
  'downloading', 'completed', 'paused', 'failed', 'cancelled',
]);
export type QueueStatus = z.infer<typeof queueStatusSchema>;

export const aspectRatioSchema = z.enum(['auto', 'square', 'landscape', 'portrait']);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export interface ReferenceAsset {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  dataUrl: string;
}

export interface GeneratedOutput {
  id: string;
  sourceUrl: string;
  downloadId?: number;
  filename?: string;
  createdAt: string;
}

export interface QueueItem {
  id: string;
  prompt: string;
  aspectRatio: AspectRatio;
  references: ReferenceAsset[];
  status: QueueStatus;
  attempts: number;
  error?: string;
  sourceConversationUrl?: string;
  outputs: GeneratedOutput[];
  createdAt: string;
  updatedAt: string;
}

export interface LibraryItem {
  id: string;
  prompt: string;
  thumbnailUrl?: string;
  sourceConversationUrl?: string;
  outputs: GeneratedOutput[];
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

export interface AuthSnapshot {
  account: Account | null;
  accessToken: string | null;
  deviceToken: string | null;
}

export interface AppSnapshot {
  account: Account | null;
  queue: QueueItem[];
  library: LibraryItem[];
  isRunning: boolean;
  activeItemId: string | null;
}

export type WorkerRequest =
  | { type: 'APP_SNAPSHOT' }
  | { type: 'CONNECT_ACCOUNT' }
  | { type: 'SIGN_OUT' }
  | { type: 'ADD_PROMPTS'; prompts: string[]; aspectRatio: AspectRatio; references?: ReferenceAsset[] }
  | { type: 'UPDATE_QUEUE_ITEM'; item: QueueItem }
  | { type: 'REMOVE_QUEUE_ITEM'; itemId: string }
  | { type: 'RUN_QUEUE' }
  | { type: 'PAUSE_QUEUE'; reason?: string }
  | { type: 'RETRY_FAILED' }
  | { type: 'EXTRACT_CURRENT_IMAGE' }
  | { type: 'EXTRACT_IMAGE_URL'; imageUrl: string; mode?: 'interactive' | 'direct' }
  | { type: 'CHATGPT_EVENT'; event: ChatGptEvent };

export type ChatGptEvent =
  | { type: 'READY'; conversationUrl: string }
  | { type: 'NEEDS_LOGIN' }
  | { type: 'PROGRESS'; itemId: string; status: QueueStatus }
  | { type: 'COMPLETE'; itemId: string; conversationUrl: string; outputs: Array<{ sourceUrl: string; sourceId: string }> }
  | { type: 'FAILED'; itemId: string; error: string };

export type WorkerResponse =
  | { ok: true; snapshot: AppSnapshot }
  | { ok: true; started?: boolean }
  | { ok: false; error: string };
