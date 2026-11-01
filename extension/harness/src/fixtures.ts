import type { Account, AppSnapshot, AspectRatio, LibraryItem, QueueItem, QueueStatus, SentItem } from '../../src/shared/contracts';

/** A state the harness can put the popup or the side panel in. */
export interface Fixture {
  id: string;
  label: string;
  /** Tab to open first (the side panel starts on Generate). */
  tab?: 'generate' | 'extract' | 'library';
  /** `null` keeps the first APP_SNAPSHOT pending, which is the loading state. */
  snapshot: AppSnapshot | null;
  /** Shortcut Chrome reports for the extract command; '' means unbound. */
  shortcut?: string;
  /** How the stubbed worker answers CONNECT_ACCOUNT. */
  connect?: 'ok' | 'pending' | { error: string };
  /** Answer to EXTRACT_CURRENT_IMAGE when it should fail; `extractCode` is the API error code that comes with it. */
  extractError?: string;
  extractCode?: string;
  /** How the stubbed worker answers EXTRACT_IMAGE_URL (Send to Extract): a new row, never, or a failure. */
  sendResult?: 'ok' | 'pending' | { error: string; code?: string };
  /** SENT_REFRESH fails with this message. */
  refreshError?: string;
  /** Each SENT_REFRESH moves rows along Queued, Detecting, Ready, so the live update can be watched. */
  advance?: boolean;
  /** UI steps replayed after the first render (see frame.ts). */
  drive?: Step[];
}

export type Step =
  | { click: string }
  | { tab: string }
  | { type: string; into: string };

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 31, 12, 0) - minutesAgo * 60_000).toISOString();

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;
export const art = {
  coin: svg('<circle cx="32" cy="32" r="22" fill="#F2B632" stroke="#0A0A0A" stroke-width="4"/><rect x="29" y="20" width="6" height="24" fill="#0A0A0A"/>'),
  chest: svg('<rect x="10" y="26" width="44" height="26" fill="#9A5B2A" stroke="#0A0A0A" stroke-width="4"/><rect x="10" y="16" width="44" height="12" fill="#B87333" stroke="#0A0A0A" stroke-width="4"/><rect x="28" y="30" width="8" height="10" fill="#F2B632" stroke="#0A0A0A" stroke-width="2"/>'),
  potion: svg('<rect x="26" y="8" width="12" height="12" fill="#D8D4C8" stroke="#0A0A0A" stroke-width="4"/><circle cx="32" cy="40" r="16" fill="#D6304A" stroke="#0A0A0A" stroke-width="4"/>'),
  shield: svg('<path d="M12 10h40v24c0 12-10 18-20 22C22 52 12 46 12 34z" fill="#3E6FD8" stroke="#0A0A0A" stroke-width="4"/><rect x="29" y="16" width="6" height="30" fill="#F4F3EE"/><rect x="20" y="24" width="24" height="6" fill="#F4F3EE"/>'),
  slime: svg('<path d="M10 50c0-18 8-30 22-30s22 12 22 30z" fill="#3DB26B" stroke="#0A0A0A" stroke-width="4"/><circle cx="25" cy="38" r="3" fill="#0A0A0A"/><circle cx="39" cy="38" r="3" fill="#0A0A0A"/>'),
  mushroom: svg('<path d="M8 36c0-16 10-26 24-26s24 10 24 26z" fill="#D6304A" stroke="#0A0A0A" stroke-width="4"/><rect x="24" y="36" width="16" height="18" fill="#F4F3EE" stroke="#0A0A0A" stroke-width="4"/><circle cx="24" cy="24" r="4" fill="#F4F3EE"/><circle cx="40" cy="26" r="3" fill="#F4F3EE"/>'),
};

export const account: Account = { id: 'u_1', name: 'Ada Park', email: 'ada@example.com' };
const longAccount: Account = { id: 'u_2', name: 'Maximiliana Konstantinopoulos-Featherstonehaugh', email: 'maximiliana.konstantinopoulos.featherstonehaugh@a-very-long-company-domain.example.com' };

const refDataUrl = art.coin;

function item(n: number, prompt: string, status: QueueStatus, extra: Partial<QueueItem> = {}): QueueItem {
  const ratio: AspectRatio = extra.aspectRatio ?? 'square';
  return {
    id: `q_${n}`,
    prompt,
    aspectRatio: ratio,
    references: [],
    status,
    attempts: 0,
    outputs: [],
    createdAt: at(30 - n),
    updatedAt: at(20 - n),
    ...extra,
  };
}

const withRef = [{ id: 'r_1', name: 'gold_coin.png', mimeType: 'image/png', bytes: 3200, dataUrl: refDataUrl }];
const out = (n: number, url: string) => [{ id: `o_${n}`, sourceUrl: url, filename: `openassets-${n}.png`, createdAt: at(10) }];

const library: LibraryItem[] = [
  { id: 'l_1', prompt: 'Pixel art gold coin, spinning, 4 frames', thumbnailUrl: art.coin, sourceConversationUrl: 'https://chatgpt.com/c/1', outputs: [...out(1, art.coin), ...out(2, art.coin), ...out(3, art.coin), ...out(4, art.coin)], createdAt: at(5) },
  { id: 'l_2', prompt: 'Cute slime family in four colours, sticker style', thumbnailUrl: art.slime, sourceConversationUrl: 'https://chatgpt.com/c/2', outputs: out(5, art.slime), createdAt: at(15) },
  { id: 'l_3', prompt: 'Knight shield with a cream cross, flat game icon', thumbnailUrl: art.shield, outputs: [...out(6, art.shield), ...out(7, art.shield)], createdAt: at(25) },
  { id: 'l_4', prompt: 'Spell book with a gold star on the cover, hand-painted look, soft shadow, transparent background, no text, centred composition with generous margin', thumbnailUrl: art.chest, sourceConversationUrl: 'https://chatgpt.com/c/4', outputs: out(8, art.chest), createdAt: at(45) },
  { id: 'l_5', prompt: 'Red mushroom with white spots, top-down RPG pickup', outputs: out(9, 'https://invalid.localhost/missing.png'), sourceConversationUrl: 'https://chatgpt.com/c/5', createdAt: at(65) },
];

const sentRow = (n: number, fileName: string, status: SentItem['status'], minutesAgo: number, extra: Partial<SentItem> = {}): SentItem => ({
  jobId: `job_${n}`,
  fileName,
  sentAt: at(minutesAgo),
  via: 'page',
  status,
  ...(status === 'expired' ? {} : { thumbnailUrl: art.slime }),
  ...extra,
});

const sent: SentItem[] = [
  sentRow(1, 'rpg_pack_v1.png', 'ready', 42, { thumbnailUrl: art.chest }),
  sentRow(2, 'slime_sheet.png', 'detecting', 3),
  sentRow(3, 'openassets-1761912000000.png', 'queued', 0, { via: 'library' }),
  sentRow(4, 'broken_scan.jpg', 'failed', 90, { error: 'Detection failed. Try a larger image.', thumbnailUrl: art.potion }),
  sentRow(5, 'old_icons.png', 'expired', 1380),
];

const empty: AppSnapshot = { account, queue: [], library: [], isRunning: false, activeItemId: null, sent: [], notice: null };
const signedOut: AppSnapshot = { account: null, queue: [], library: [], isRunning: false, activeItemId: null, sent: [], notice: null };

const drafts = [
  item(1, 'Pixel art treasure chest, closed, front view', 'draft', { references: withRef }),
  item(2, 'Pixel art treasure chest, open, gold inside', 'draft', { aspectRatio: 'landscape' }),
  item(3, 'Health potion icon set, three sizes', 'draft', { aspectRatio: 'portrait', references: [...withRef, ...withRef.map((r) => ({ ...r, id: 'r_2' }))] }),
];

const working: AppSnapshot = {
  account,
  library: [],
  isRunning: true,
  activeItemId: 'q_2', sent: [], notice: null,
  queue: [
    item(1, 'Pixel art gold coin, spinning, 4 frames', 'completed', { references: withRef, outputs: out(1, art.coin) }),
    item(2, 'Pixel art treasure chest, closed, front view', 'generating', { references: withRef }),
    item(3, 'Pixel art treasure chest, open, gold inside', 'queued', { references: withRef }),
    item(4, 'Health potion icon set, three sizes', 'queued', { aspectRatio: 'portrait' }),
  ],
};

const allStatuses: AppSnapshot = {
  account,
  library,
  isRunning: true,
  activeItemId: 'q_6', sent: [], notice: null,
  queue: [
    item(1, 'Draft: pixel art banner', 'draft'),
    item(2, 'Queued: pixel art key', 'queued'),
    item(3, 'Preparing: pixel art lantern', 'preparing'),
    item(4, 'Uploading references: pixel art crown', 'uploading_refs', { references: withRef }),
    item(5, 'Submitting: pixel art ring', 'submitting'),
    item(6, 'Generating: pixel art sword', 'generating'),
    item(7, 'Downloading: pixel art bow', 'downloading'),
    item(8, 'Complete: pixel art coin', 'completed', { outputs: out(1, art.coin) }),
    item(9, 'Paused: pixel art map', 'paused', { error: 'Paused by you.' }),
    item(10, 'Failed: pixel art torch', 'failed', { error: 'ChatGPT timed out' }),
    item(11, 'Cancelled: pixel art gem', 'cancelled'),
  ],
};

export const fixtures: Fixture[] = [
  { id: 'loading', label: 'Loading (snapshot pending)', snapshot: null },
  { id: 'signed-out', label: 'Signed out', snapshot: signedOut },
  { id: 'connecting', label: 'Connecting (waiting for sign-in)', snapshot: signedOut, connect: 'pending', drive: [{ click: 'Connect account' }] },
  { id: 'connect-error', label: 'Sign-in cancelled (error)', snapshot: signedOut, connect: { error: 'OpenAssets sign-in was cancelled.' }, drive: [{ click: 'Connect account' }] },
  { id: 'signed-in-empty', label: 'Signed in, nothing yet', snapshot: empty },
  { id: 'account-menu', label: 'Account menu open', snapshot: { ...empty, queue: drafts }, drive: [{ click: 'Account menu' }] },
  { id: 'draft', label: 'Generate: drafts ready to run', snapshot: { ...empty, queue: drafts } },
  { id: 'working', label: 'Generate: working', snapshot: working },
  {
    id: 'paused',
    label: 'Generate: paused (ChatGPT login)',
    snapshot: {
      account,
      library: [],
      isRunning: false,
      activeItemId: null, sent: [], notice: null,
      queue: [
        item(1, 'Pixel art gold coin, spinning, 4 frames', 'completed', { outputs: out(1, art.coin) }),
        item(2, 'Pixel art treasure chest, closed, front view', 'paused', { error: 'Sign in to ChatGPT, then resume.' }),
        item(3, 'Pixel art treasure chest, open, gold inside', 'draft'),
      ],
    },
  },
  {
    id: 'failed',
    label: 'Generate: failures',
    snapshot: {
      account,
      library: [],
      isRunning: false,
      activeItemId: null, sent: [], notice: null,
      queue: [
        item(1, 'Pixel art gold coin, spinning, 4 frames', 'completed', { outputs: out(1, art.coin) }),
        item(2, 'Health potion icon set, three sizes', 'failed', { error: 'ChatGPT timed out' }),
        item(3, 'Knight shield with a cream cross, flat game icon, with a very long prompt that keeps going so the row has to truncate it cleanly', 'failed', { error: 'ChatGPT did not return an image. It may have refused the prompt or hit a usage limit. Check the conversation in ChatGPT, then retry.' }),
      ],
    },
  },
  {
    id: 'results',
    label: 'Generate: all complete, library filled',
    snapshot: {
      account,
      library,
      isRunning: false,
      activeItemId: null, sent: [], notice: null,
      queue: [
        item(1, 'Pixel art gold coin, spinning, 4 frames', 'completed', { references: withRef, outputs: out(1, art.coin) }),
        item(2, 'Cute slime family in four colours, sticker style', 'completed', { outputs: out(5, art.slime) }),
        item(3, 'Knight shield with a cream cross, flat game icon', 'completed', { aspectRatio: 'portrait', outputs: out(6, art.shield) }),
      ],
    },
  },
  { id: 'all-statuses', label: 'Generate: every queue status', snapshot: allStatuses },
  { id: 'error-add', label: 'Error: add with no prompt', snapshot: empty, drive: [{ click: 'Add to queue' }] },
  { id: 'library', label: 'Library: items', tab: 'library', snapshot: { ...empty, library } },
  { id: 'library-send-chooser', label: 'Library: Send to Extract, several images (chooser open)', tab: 'library', snapshot: { ...empty, library }, drive: [{ click: 'Send to Extract: Pixel art gold coin' }] },
  { id: 'library-send-sending', label: 'Library: Send to Extract in progress', tab: 'library', snapshot: { ...empty, library }, sendResult: 'pending', drive: [{ click: 'Send to Extract: Cute slime' }] },
  { id: 'library-send-done', label: 'Library: Send to Extract done (row added to Sent)', tab: 'library', snapshot: { ...empty, library }, drive: [{ click: 'Send to Extract: Cute slime' }] },
  { id: 'library-send-limit', label: 'Library: Send to Extract refused, sheets used up', tab: 'library', snapshot: { ...empty, library }, sendResult: { error: 'You have used all 10 sheets this month. Your allowance resets on 2026-11-01. Pro has no sheet limit.', code: 'SHEET_LIMIT' }, drive: [{ click: 'Send to Extract: Cute slime' }] },
  { id: 'library-send-gone', label: 'Library: Send to Extract, image gone from ChatGPT', tab: 'library', snapshot: { ...empty, library }, sendResult: { error: 'That image is no longer available from ChatGPT. Open the conversation and use Extract on the page instead.' }, drive: [{ click: 'Send to Extract: Cute slime' }] },
  { id: 'notice-plan-limit', label: 'Notice kept by the worker: sheets used up (context menu)', tab: 'extract', snapshot: { ...empty, notice: { message: 'You have used all 10 sheets this month. Your allowance resets on 2026-11-01. Pro has no sheet limit.', code: 'SHEET_LIMIT' } } },
  { id: 'library-empty', label: 'Library: empty', tab: 'library', snapshot: empty },
  { id: 'library-no-match', label: 'Library: search with no match', tab: 'library', snapshot: { ...empty, library }, drive: [{ type: 'zzz', into: 'input[type="search"]' }] },
  { id: 'extract', label: 'Extract', tab: 'extract', snapshot: empty },
  { id: 'extract-sent', label: 'Extract: sent from this browser (all statuses)', tab: 'extract', snapshot: { ...empty, sent } },
  { id: 'extract-sent-live', label: 'Extract: sent, statuses update on their own', tab: 'extract', advance: true, snapshot: { ...empty, sent: sent.filter((row) => row.status === 'detecting' || row.status === 'queued') } },
  { id: 'extract-sent-error', label: 'Extract: sent, status refresh failed', tab: 'extract', refreshError: 'Could not reach OpenAssets.', snapshot: { ...empty, sent: sent.slice(1, 3) } },
  { id: 'extract-sent-long', label: 'Stress: long file names in the sent list', tab: 'extract', snapshot: { ...empty, sent: [sentRow(1, 'a_very_long_sprite_sheet_name_that_keeps_going_and_going_for_the_final_export_v12.png', 'detecting', 4), sentRow(2, 'Unbroken_token_without_any_spaces_that_is_long_enough_to_push_the_row_wider_than_the_panel.png', 'failed', 10, { error: 'Detectionfailedwithaverylongunbrokenerrormessagethatmustwrapinsidetherow' })] } },
  { id: 'extract-no-shortcut', label: 'Extract: shortcut unbound', tab: 'extract', shortcut: '', snapshot: empty },
  { id: 'extract-mac-shortcut', label: 'Extract: macOS shortcut glyphs', tab: 'extract', shortcut: '⌥⇧E', snapshot: empty },
  { id: 'error-extract', label: 'Error: extract on a non-web page', tab: 'extract', snapshot: empty, extractError: 'Open a webpage with an image first.', drive: [{ click: 'Select an image on this page' }] },
  {
    id: 'plan-limit',
    label: 'Plan limit: sheets used up',
    tab: 'extract',
    snapshot: empty,
    extractError: 'You have used all 10 sheets this month. Your allowance resets on 2026-11-01. Pro has no sheet limit.',
    extractCode: 'SHEET_LIMIT',
    drive: [{ click: 'Select an image on this page' }],
  },
  {
    id: 'long-content',
    label: 'Stress: long names and text',
    snapshot: {
      account: longAccount,
      library: library.map((entry, index) => ({ ...entry, prompt: `${entry.prompt} ${'with extra detail '.repeat(index + 3)}`.trim() })),
      isRunning: false,
      activeItemId: null, sent: [], notice: null,
      queue: [
        item(1, 'Unbroken_token_without_any_spaces_that_is_long_enough_to_push_the_row_wider_than_the_panel_if_nothing_clips_it', 'failed', { error: 'ChatGPTreturnedanerrorwithaverylongunbrokenmessagethatmustwrapinsidetherow' }),
        item(2, 'Pixel art treasure chest, open, gold inside', 'uploading_refs', { aspectRatio: 'landscape', references: [...withRef, ...withRef.map((r) => ({ ...r, id: 'r_2' })), ...withRef.map((r) => ({ ...r, id: 'r_3' }))] }),
      ],
    },
  },
];

export const fixtureById = (id: string | null) => fixtures.find((fixture) => fixture.id === id) ?? fixtures.find((fixture) => fixture.id === 'signed-in-empty')!;
