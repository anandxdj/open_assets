import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ExternalLink, FolderOpen, ImagePlus, Keyboard, Lock, LogIn, MousePointer2, Pause, Play, Plus, RotateCcw, ScanSearch, Focus, Search, Sparkles, X } from 'lucide-react';
import type { AppNotice, AppSnapshot, AspectRatio, LibraryItem, QueueItem, ReferenceAsset } from '../shared/contracts';
import { frontendUrl } from '../shared/config';
import { callWorker } from '../shared/worker';
import { browser } from 'wxt/browser';
import { AccountMenu, Brand, EmptyState, Notice, Segmented, Spinner, StatusBadge, Thumb, statusLabels, statusTone } from './components';
import { SentList } from './SentList';

type Tab = 'generate' | 'extract' | 'library';
type SplitMode = 'line' | 'block';

const frontendHost = new URL(frontendUrl).host;

const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'generate', label: 'Generate' },
  { id: 'extract', label: 'Extract' },
  { id: 'library', label: 'Library' },
];
const splitOptions: ReadonlyArray<{ value: SplitMode; label: string }> = [
  { value: 'line', label: 'Each line' },
  { value: 'block', label: 'Paragraphs' },
];
const ratioOptions: ReadonlyArray<{ value: AspectRatio; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'square', label: 'Square' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
];
const ratioLabels = Object.fromEntries(ratioOptions.map((option) => [option.value, option.label])) as Record<AspectRatio, string>;

function parsePrompts(source: string, splitMode: SplitMode) {
  return (splitMode === 'line' ? source.split('\n') : source.split(/\n\s*\n/)).map((value) => value.trim()).filter(Boolean);
}

async function filesToReferences(event: ChangeEvent<HTMLInputElement>): Promise<ReferenceAsset[]> {
  const files = [...(event.target.files ?? [])];
  return Promise.all(files.filter((file) => file.type.startsWith('image/')).map(async (file) => ({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, bytes: file.size, dataUrl: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }) })));
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function truncate(text: string, length = 60) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** Splits a Chrome shortcut ("Alt+Shift+E", or "⌥⇧E" on macOS) into keys. */
function shortcutKeys(shortcut: string) {
  return shortcut.includes('+') ? shortcut.split('+') : [...shortcut];
}

function queueProgress(app: AppSnapshot) {
  const items = app.queue.filter((item) => item.status !== 'cancelled');
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const activeIndex = app.activeItemId ? items.findIndex((item) => item.id === app.activeItemId) : -1;
  const active = items[activeIndex];
  let text: string;
  if (total === 0) text = 'Queue is empty';
  else if (app.isRunning && active) text = `Prompt ${activeIndex + 1} of ${total} · ${statusLabels[active.status]}`;
  else if (app.isRunning) text = `Running · ${completed} of ${total} complete`;
  else if (completed === total) text = total === 1 ? '1 complete' : `All ${total} complete`;
  else if (items.some((item) => item.status === 'paused')) text = `Paused · ${completed} of ${total} complete`;
  else text = `${completed} of ${total} complete`;
  const percent = total ? Math.round(((completed + failed) / total) * 100) : 0;
  return { text, percent };
}

export function App() {
  const [app, setApp] = useState<AppSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('generate');
  const [promptText, setPromptText] = useState('');
  const [splitMode, setSplitMode] = useState<SplitMode>('line');
  const [ratio, setRatio] = useState<AspectRatio>('auto');
  const [references, setReferences] = useState<ReferenceAsset[]>([]);
  const [error, setError] = useState<AppNotice | null>(null);
  // The Library image being sent to Extract ('<item id>:<output id>'), and the polite words about the result.
  const [sending, setSending] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [query, setQuery] = useState('');
  const [shortcut, setShortcut] = useState<string[]>(['Alt', 'Shift', 'E']);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const result = await callWorker({ type: 'APP_SNAPSHOT' });
    if ('snapshot' in result) setApp(result.snapshot);
  };
  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);
  // Show the shortcut Chrome actually has bound (people can change it in chrome://extensions/shortcuts).
  useEffect(() => {
    browser.commands.getAll()
      .then((commands) => {
        const bound = commands.find((command) => command.name === 'extract-image')?.shortcut;
        setShortcut(bound ? shortcutKeys(bound) : []);
      })
      .catch(() => undefined);
  }, []);

  const doneCount = useMemo(() => app?.queue.filter((item) => item.status === 'completed').length ?? 0, [app]);
  // "Run queue" only has work when something is waiting; failures have their own retry button.
  const runnableCount = useMemo(() => app?.queue.filter((item) => item.status === 'draft' || item.status === 'queued' || item.status === 'paused').length ?? 0, [app]);
  const pausedCount = useMemo(() => app?.queue.filter((item) => item.status === 'paused').length ?? 0, [app]);
  const failedCount = useMemo(() => app?.queue.filter((item) => item.status === 'failed').length ?? 0, [app]);
  // Only failures are left: retrying them is the one forward action, so it takes the primary slot.
  const retryOnly = !!app && !app.isRunning && runnableCount === 0 && failedCount > 0;
  const promptCount = useMemo(() => parsePrompts(promptText, splitMode).length, [promptText, splitMode]);
  const progress = useMemo(() => app ? queueProgress(app) : null, [app]);
  const libraryItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = app?.library ?? [];
    return needle ? items.filter((item) => item.prompt.toLowerCase().includes(needle)) : items;
  }, [app, query]);

  const send = async (request: Parameters<typeof callWorker>[0]) => {
    const result = await callWorker(request);
    // A later success replaces an earlier failure instead of leaving it on screen.
    setError(result.ok ? null : (result.code ? { message: result.error, code: result.code } : { message: result.error }));
    await refresh();
    return result;
  };
  const sendToExtract = async (item: LibraryItem, output: LibraryItem['outputs'][number]) => {
    if (sending) return;
    setSending(`${item.id}:${output.id}`);
    setSendResult('');
    try {
      const result = await send({ type: 'EXTRACT_IMAGE_URL', imageUrl: output.sourceUrl, via: 'library', ...(output.filename ? { fileName: output.filename } : {}) });
      if (result.ok) setSendResult('Sent to Extract. Opening the editor.');
    } finally {
      setSending(null);
    }
  };
  const clearDone = async () => {
    // One at a time: the worker rewrites the whole queue for every removal.
    for (const item of app?.queue ?? []) {
      if (item.status !== 'completed') continue;
      const result = await callWorker({ type: 'REMOVE_QUEUE_ITEM', itemId: item.id });
      if (!result.ok) { setError({ message: result.error }); break; }
    }
    await refresh();
  };
  const selectTab = (next: Tab) => {
    setError(null);
    setTab(next);
  };
  const addPrompts = async () => {
    const prompts = parsePrompts(promptText, splitMode);
    if (!prompts.length) return setError({ message: 'Add at least one prompt before adding it to the queue.' });
    await send({ type: 'ADD_PROMPTS', prompts, aspectRatio: ratio, references });
    setPromptText(''); setReferences([]);
  };
  const connect = async () => {
    setError(null);
    setConnecting(true);
    try { await send({ type: 'CONNECT_ACCOUNT' }); } finally { setConnecting(false); }
  };
  const onReferencesChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const added = filesToReferences(event);
    event.target.value = '';
    void added.then((items) => setReferences((current) => [...current, ...items]));
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((item) => item.id === tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1
            : -1;
    const target = tabs[next];
    if (!target) return;
    event.preventDefault();
    selectTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  // A failure from this window, or one kept by the worker for a send that had no window open (context menu, shortcut).
  const shown = error ?? app?.notice ?? null;
  const dismissNotice = () => {
    if (error) setError(null);
    else void callWorker({ type: 'DISMISS_NOTICE' }).then(() => refresh());
  };
  const notice = shown && <Notice notice={shown} onDismiss={dismissNotice} />;

  if (!app) {
    return (
      <main className="ext-shell">
        <h1 className="oa-sr-only">OpenAssets</h1>
        <header className="ext-header"><Brand /></header>
        <div className="ext-center ext-loading" role="status"><Spinner /><span>Opening OpenAssets…</span></div>
      </main>
    );
  }

  if (!app.account) {
    return (
      <main className="ext-shell">
        <header className="ext-header"><Brand /></header>
        <div className="ext-center">
          <span className="oa-icon-box"><Lock aria-hidden="true" /></span>
          <div className="ext-center-copy">
            <h1 className="oa-h3">Connect your account</h1>
            <p>Sign in once to queue ChatGPT generations, extract images and keep them in your library.</p>
          </div>
          {notice}
          <button type="button" className="oa-btn oa-btn-primary oa-btn-lg oa-btn-block" disabled={connecting} aria-busy={connecting} onClick={() => void connect()}>
            {connecting ? <Spinner /> : <LogIn aria-hidden="true" />}
            {connecting ? 'Waiting for sign-in…' : 'Connect account'}
          </button>
          <small>
            <span>Opens {frontendHost} in a new window.</span>
            <span>We never read your ChatGPT credentials. ChatGPT is checked only when you run a generation queue.</span>
          </small>
        </div>
      </main>
    );
  }

  const account = app.account;

  return (
    <main className="ext-shell">
      <h1 className="oa-sr-only">OpenAssets</h1>
      <header className="ext-header">
        <Brand />
        <a className="oa-btn oa-btn-ghost oa-btn-sm oa-btn-icon" href={frontendUrl} target="_blank" rel="noreferrer" aria-label="Open web app" title="Open web app">
          <ExternalLink aria-hidden="true" />
        </a>
        <AccountMenu account={account} onSignOut={() => void send({ type: 'SIGN_OUT' })} />
      </header>

      <div className="ext-tabs">
        <div className="oa-seg oa-seg-block" role="tablist" aria-label="OpenAssets sections">
          {tabs.map((item) => (
            <button
              key={item.id}
              ref={(node) => { tabRefs.current[item.id] = node; }}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              className="oa-seg-item"
              onClick={() => selectTab(item.id)}
              onKeyDown={onTabKeyDown}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {notice && <div className="ext-alert">{notice}</div>}

      {tab === 'generate' && (
        <section className="ext-panel" role="tabpanel" id="panel-generate" aria-labelledby="tab-generate">
          <div className="ext-scroll">
            <div className="ext-compose">
              <label className="oa-field">
                <span className="oa-field-label">Prompts</span>
                <textarea className="oa-textarea" rows={4} value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder="Describe the image you want to create…" />
              </label>
              <Segmented label="Split into" value={splitMode} options={splitOptions} onChange={setSplitMode} />
              <Segmented label="Ratio" value={ratio} options={ratioOptions} onChange={setRatio} className="ext-seg-fit" />
              <div className="ext-refs" role="group" aria-labelledby="refs-label">
                <span className="oa-field-label" id="refs-label">References</span>
                <ul className="ext-ref-list">
                  {references.map((reference) => (
                    <li key={reference.id}>
                      <button
                        type="button"
                        className="ext-ref oa-checker"
                        aria-label={`Remove reference ${reference.name}`}
                        title={reference.name}
                        onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))}
                      >
                        <img src={reference.dataUrl} alt="" />
                        <span className="ext-ref-x" aria-hidden="true"><X /></span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button type="button" className="oa-btn oa-btn-secondary oa-btn-sm oa-btn-icon" aria-label="Add reference images" title="Add reference images" onClick={() => fileInputRef.current?.click()}>
                      <ImagePlus aria-hidden="true" />
                    </button>
                  </li>
                </ul>
                <input ref={fileInputRef} className="ext-file-input" type="file" accept="image/*" multiple tabIndex={-1} aria-hidden="true" onChange={onReferencesChosen} />
              </div>
              <button type="button" className="oa-btn oa-btn-secondary oa-btn-block" onClick={() => void addPrompts()}>
                <Plus aria-hidden="true" />
                {promptCount > 0 ? `Add ${promptCount} to queue` : 'Add to queue'}
              </button>
            </div>

            <div className="ext-queue">
              <div className="ext-queue-head">
                <h2 className="oa-label">Queue · {plural(app.queue.length, 'item')}</h2>
                {doneCount > 0 && <button type="button" className="oa-btn oa-btn-ghost oa-btn-sm" onClick={() => void clearDone()}>Clear done</button>}
              </div>
              {app.queue.length === 0
                ? <EmptyState icon={<Sparkles aria-hidden="true" />} title="Start with a prompt">Paste one or more prompts above. Nothing is sent until you run the queue.</EmptyState>
                : <ul aria-label="Queue">{app.queue.map((item) => <QueueRow key={item.id} item={item} onDelete={() => void send({ type: 'REMOVE_QUEUE_ITEM', itemId: item.id })} />)}</ul>}
            </div>
          </div>

          <footer className="ext-footer">
            <div className="ext-footer-status">
              <span role="status">{progress?.text}</span>
              {failedCount > 0 && <span>{failedCount} failed</span>}
            </div>
            <div className="oa-progress" role="progressbar" aria-label="Queue progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress?.percent ?? 0}>
              <span style={{ width: `${progress?.percent ?? 0}%` }} />
            </div>
            <div className="ext-footer-actions">
              {app.isRunning
                ? <button type="button" className="oa-btn oa-btn-secondary ext-grow" onClick={() => void send({ type: 'PAUSE_QUEUE', reason: 'Paused by you.' })}><Pause aria-hidden="true" />Pause queue</button>
                : retryOnly
                  ? <button type="button" className="oa-btn oa-btn-primary ext-grow" onClick={() => void send({ type: 'RETRY_FAILED' })}><RotateCcw aria-hidden="true" />Retry {failedCount} failed</button>
                  : <button type="button" className="oa-btn oa-btn-primary ext-grow" disabled={runnableCount === 0} onClick={() => void send({ type: 'RUN_QUEUE' })}><Play aria-hidden="true" />{pausedCount > 0 ? 'Resume queue' : 'Run queue'}</button>}
              {failedCount > 0 && !retryOnly && <button type="button" className="oa-btn oa-btn-ghost" onClick={() => void send({ type: 'RETRY_FAILED' })}>Retry {failedCount} failed</button>}
            </div>
          </footer>
        </section>
      )}

      {tab === 'extract' && (
        <section className="ext-panel" role="tabpanel" id="panel-extract" aria-labelledby="tab-extract">
          <div className="ext-scroll">
            <div className="ext-pane">
              <div className="ext-extract">
                <span className="oa-icon-box"><ScanSearch aria-hidden="true" /></span>
                <div className="ext-extract-copy">
                  <h2 className="oa-section">Extract from this page</h2>
                  <p>Pick an image, then it opens in the OpenAssets editor.</p>
                </div>
                <button type="button" className="oa-btn oa-btn-primary oa-btn-block" onClick={() => void send({ type: 'EXTRACT_CURRENT_IMAGE' })}>Select an image on this page</button>
              </div>
              <ul className="ext-hints">
                <li><MousePointer2 aria-hidden="true" /><span>Or right-click any image and choose <strong>Extract with OpenAssets</strong>.</span></li>
                {shortcut.length > 0 && (
                  <li>
                    <Keyboard aria-hidden="true" />
                    <span>
                      <span className="ext-keys">{shortcut.map((key, index) => <kbd className="oa-kbd" key={`${key}-${index}`}>{key}</kbd>)}</span>
                      starts the same picker on the current tab.
                    </span>
                  </li>
                )}
                <li><Lock aria-hidden="true" /><span>You will be asked for page access only when needed.</span></li>
              </ul>
              <SentList items={app.sent} refresh={() => callWorker({ type: 'SENT_REFRESH' })} onClear={() => void send({ type: 'CLEAR_SENT' })} />
            </div>
          </div>
        </section>
      )}

      {tab === 'library' && (
        <section className="ext-panel" role="tabpanel" id="panel-library" aria-labelledby="tab-library">
          <div className="ext-scroll">
            <div className="ext-library">
              {app.library.length > 0 && (
                <label className="oa-input-group">
                  <Search aria-hidden="true" />
                  <span className="oa-sr-only">Search library</span>
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts" />
                </label>
              )}
              {app.library.length === 0
                ? <EmptyState icon={<FolderOpen aria-hidden="true" />} title="Your library is empty">Completed generations appear here with their original prompt and source conversation. They stay on this device.</EmptyState>
                : libraryItems.length === 0
                  ? <EmptyState icon={<Search aria-hidden="true" />} title="No matches">No prompts match “{query.trim()}”.</EmptyState>
                  : (
                    <>
                      <p className="ext-hint ext-lib-hint">Send to Extract uploads that image to your account.</p>
                      <ul aria-label="Library">
                        {libraryItems.map((item) => <LibraryRow key={item.id} item={item} sending={sending} onSend={(output) => void sendToExtract(item, output)} />)}
                      </ul>
                      <p className="oa-sr-only" role="status">{sendResult}</p>
                    </>
                  )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function QueueRow({ item, onDelete }: { item: QueueItem; onDelete: () => void }) {
  const tone = statusTone(item.status);
  const thumbnail = item.outputs[0]?.sourceUrl ?? item.references[0]?.dataUrl;
  const meta = [ratioLabels[item.aspectRatio], item.references.length ? plural(item.references.length, 'ref') : null].filter(Boolean).join(' · ');
  return (
    <li className="ext-row">
      <Thumb src={thumbnail} size="sm" />
      <div className="ext-row-main">
        <p className="ext-row-prompt" title={item.prompt}>{item.prompt}</p>
        <div className="ext-row-meta">
          <StatusBadge status={item.status} />
          <span className="ext-meta">{meta}</span>
        </div>
        {item.error && <p className="ext-row-error" data-tone={tone === 'danger' ? 'danger' : 'warning'}>{item.error}</p>}
      </div>
      <button type="button" className="oa-btn oa-btn-ghost oa-btn-sm oa-btn-icon" aria-label={`Remove from queue: ${truncate(item.prompt)}`} title="Remove from queue" onClick={onDelete}>
        <X aria-hidden="true" />
      </button>
    </li>
  );
}

function LibraryRow({ item, sending, onSend }: { item: LibraryItem; sending: string | null; onSend: (output: LibraryItem['outputs'][number]) => void }) {
  const [choosing, setChoosing] = useState(false);
  const chooserId = useId();
  const outputs = item.outputs;
  const several = outputs.length > 1;
  const busy = outputs.some((output) => sending === `${item.id}:${output.id}`);
  const name = `Send to Extract: ${truncate(item.prompt)}`;
  return (
    <li className="ext-lib-item" onKeyDown={(event) => { if (event.key === 'Escape' && choosing) { event.stopPropagation(); setChoosing(false); } }}>
      <Thumb src={item.thumbnailUrl ?? outputs[0]?.sourceUrl} size="lg" />
      <div className="ext-lib-main">
        <p className="ext-lib-prompt" id={`lib-${item.id}`} title={item.prompt}>{item.prompt}</p>
        <div className="ext-lib-meta">
          <span>{plural(outputs.length, 'image')}</span>
          {item.sourceConversationUrl && <a className="oa-link" href={item.sourceConversationUrl} target="_blank" rel="noreferrer" aria-describedby={`lib-${item.id}`}>Open conversation</a>}
        </div>
        {several && choosing && (
          <ul className="ext-chooser" id={chooserId} aria-label="Choose an image to send to Extract">
            {outputs.map((output, index) => {
              const key = `${item.id}:${output.id}`;
              return (
                <li key={output.id}>
                  <button
                    type="button"
                    className="ext-chooser-btn oa-checker"
                    disabled={!!sending}
                    aria-busy={sending === key}
                    aria-label={`Send image ${index + 1} of ${outputs.length} to Extract`}
                    title={`Send image ${index + 1} to Extract`}
                    onClick={() => { setChoosing(false); onSend(output); }}
                  >
                    <img src={output.sourceUrl} alt="" referrerPolicy="no-referrer" />
                    <span className="ext-chooser-n" aria-hidden="true">{index + 1}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="oa-btn oa-btn-ghost oa-btn-sm oa-btn-icon ext-send"
        aria-label={name}
        title="Send to Extract"
        disabled={!!sending || outputs.length === 0}
        aria-busy={busy}
        {...(several ? { 'aria-expanded': choosing, 'aria-controls': choosing ? chooserId : undefined } : {})}
        onClick={() => { if (several) setChoosing((value) => !value); else if (outputs[0]) onSend(outputs[0]); }}
      >
        {busy ? <Spinner /> : <Focus aria-hidden="true" />}
      </button>
    </li>
  );
}
