import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { CircleAlert, ExternalLink, FolderOpen, ImagePlus, Keyboard, Lock, LogIn, MousePointer2, Pause, Play, Plus, ScanSearch, Search, Sparkles, X } from 'lucide-react';
import type { AppSnapshot, AspectRatio, QueueItem, ReferenceAsset } from '../shared/contracts';
import { frontendUrl } from '../shared/config';
import { callWorker } from '../shared/worker';
import { browser } from 'wxt/browser';
import { AccountMenu, Brand, EmptyState, Segmented, Spinner, StatusBadge, Thumb, statusLabels, statusTone } from './components';

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
  const [error, setError] = useState<string | null>(null);
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

  const failedCount = useMemo(() => app?.queue.filter((item) => item.status === 'failed').length ?? 0, [app]);
  const promptCount = useMemo(() => parsePrompts(promptText, splitMode).length, [promptText, splitMode]);
  const progress = useMemo(() => app ? queueProgress(app) : null, [app]);
  const libraryItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = app?.library ?? [];
    return needle ? items.filter((item) => item.prompt.toLowerCase().includes(needle)) : items;
  }, [app, query]);

  const send = async (request: Parameters<typeof callWorker>[0]) => {
    const result = await callWorker(request);
    if (!result.ok) setError(result.error);
    await refresh();
    return result;
  };
  const addPrompts = async () => {
    const prompts = parsePrompts(promptText, splitMode);
    if (!prompts.length) return setError('Add at least one prompt before adding it to the queue.');
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
    setTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  const notice = error && (
    <div className="oa-notice oa-notice-danger" role="alert">
      <CircleAlert aria-hidden="true" />
      <span>{error}</span>
      <button type="button" className="oa-btn oa-btn-ghost oa-btn-sm" onClick={() => setError(null)}>Dismiss</button>
    </div>
  );

  if (!app) {
    return (
      <main className="ext-shell">
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
          <button type="button" className="oa-btn oa-btn-primary oa-btn-lg oa-btn-block" disabled={connecting} onClick={() => void connect()}>
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
              onClick={() => setTab(item.id)}
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
                : <button type="button" className="oa-btn oa-btn-primary ext-grow" disabled={app.queue.length === 0} onClick={() => void send({ type: 'RUN_QUEUE' })}><Play aria-hidden="true" />Run queue</button>}
              {failedCount > 0 && <button type="button" className="oa-btn oa-btn-ghost" onClick={() => void send({ type: 'RETRY_FAILED' })}>Retry {failedCount} failed</button>}
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
                    <ul aria-label="Library">
                      {libraryItems.map((item) => (
                        <li className="ext-lib-item" key={item.id}>
                          <Thumb src={item.thumbnailUrl ?? item.outputs[0]?.sourceUrl} size="lg" />
                          <div className="ext-lib-main">
                            <p className="ext-lib-prompt" id={`lib-${item.id}`} title={item.prompt}>{item.prompt}</p>
                            <div className="ext-lib-meta">
                              <span>{plural(item.outputs.length, 'image')}</span>
                              {item.sourceConversationUrl && <a className="oa-link" href={item.sourceConversationUrl} target="_blank" rel="noreferrer" aria-describedby={`lib-${item.id}`}>Open conversation</a>}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
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
