import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Archive, Box, Download, FileText, FolderOpen, ImagePlus, LogIn, Pause, Play, Plus, RotateCcw, Scissors, Settings, Sparkles, Trash2, Upload, UserRound } from 'lucide-react';
import type { AppSnapshot, AspectRatio, QueueItem, ReferenceAsset } from '../shared/contracts';
import { callWorker } from '../shared/worker';
import { browser } from 'wxt/browser';

type Tab = 'generate' | 'extract' | 'library';
const labels: Record<QueueItem['status'], string> = { draft: 'Draft', queued: 'Queued', preparing: 'Preparing', uploading_refs: 'Uploading references', submitting: 'Submitting', generating: 'Generating', downloading: 'Downloading', completed: 'Complete', paused: 'Paused', failed: 'Failed', cancelled: 'Cancelled' };

function parsePrompts(source: string, splitMode: 'line' | 'block') {
  return (splitMode === 'line' ? source.split('\n') : source.split(/\n\s*\n/)).map((value) => value.trim()).filter(Boolean);
}

async function filesToReferences(event: ChangeEvent<HTMLInputElement>): Promise<ReferenceAsset[]> {
  const files = [...(event.target.files ?? [])];
  return Promise.all(files.filter((file) => file.type.startsWith('image/')).map(async (file) => ({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, bytes: file.size, dataUrl: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }) })));
}

export function App() {
  const [app, setApp] = useState<AppSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('generate');
  const [promptText, setPromptText] = useState('');
  const [splitMode, setSplitMode] = useState<'line' | 'block'>('line');
  const [ratio, setRatio] = useState<AspectRatio>('auto');
  const [references, setReferences] = useState<ReferenceAsset[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const failedCount = useMemo(() => app?.queue.filter((item) => item.status === 'failed').length ?? 0, [app]);
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

  if (!app) return <main className="shell"><div className="loading-line">Opening OpenAssets…</div></main>;
  if (!app.account) return <main className="shell locked"><header className="brand"><Box size={20} /><strong>OpenAssets</strong></header><div className="locked-copy"><div className="lock-orb"><UserRound size={24} /></div><h1>Your image workspace is locked</h1><p>Connect your OpenAssets account to generate, extract, and manage assets.</p><button className="primary" onClick={() => void send({ type: 'CONNECT_ACCOUNT' })}><LogIn size={16} /> Connect account</button><small>We never read your ChatGPT credentials. ChatGPT is checked only when you run a generation queue.</small></div></main>;

  return <main className="shell">
    <header className="topbar"><div className="brand"><Box size={20} /><strong>OpenAssets</strong></div><button className="icon-button" aria-label="Settings"><Settings size={18} /></button></header>
    <div className="account-row"><div className="avatar">{app.account.name.slice(0, 1).toUpperCase()}</div><div><strong>{app.account.name}</strong><span>{app.account.email}</span></div><button className="quiet" onClick={() => void send({ type: 'SIGN_OUT' })}>Sign out</button></div>
    <nav className="tabs" aria-label="OpenAssets sections">
      <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}><Sparkles size={16} /> Generate</button>
      <button className={tab === 'extract' ? 'active' : ''} onClick={() => setTab('extract')}><Scissors size={16} /> Extract</button>
      <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><FolderOpen size={16} /> Library</button>
    </nav>
    {error && <div className="notice error" role="alert">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
    {tab === 'generate' && <section className="workspace">
      <div className="section-heading"><div><h1>Generate</h1><p>Build a queue, then confirm before it reaches ChatGPT.</p></div></div>
      <textarea value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder="Describe the image you want to create…" aria-label="Image prompts" />
      <div className="compose-controls"><label>Split<input type="checkbox" checked={splitMode === 'block'} onChange={(event) => setSplitMode(event.target.checked ? 'block' : 'line')} /> <span>{splitMode === 'line' ? 'Each line' : 'Paragraphs'}</span></label><label>Ratio<select value={ratio} onChange={(event) => setRatio(event.target.value as AspectRatio)}><option value="auto">Auto</option><option value="square">Square</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label></div>
      <div className="reference-row"><label className="file-button"><ImagePlus size={16} /> Reference images<input type="file" accept="image/*" multiple onChange={(event) => void filesToReferences(event).then(setReferences)} /></label>{references.length > 0 && <span>{references.length} attached</span>}<button className="secondary" onClick={() => void addPrompts()}><Plus size={16} /> Add to queue</button></div>
      <div className="queue-header"><div><h2>Queue</h2><span>{app.queue.length} items</span></div><div>{app.isRunning ? <button className="secondary" onClick={() => void send({ type: 'PAUSE_QUEUE', reason: 'Paused by you.' })}><Pause size={16} /> Pause</button> : <button className="primary compact" onClick={() => void send({ type: 'RUN_QUEUE' })}><Play size={16} /> Run queue</button>}</div></div>
      <div className="queue-list">{app.queue.length === 0 ? <div className="empty"><Sparkles size={22} /><strong>Start with a prompt</strong><span>Paste one or more prompts above. Nothing is sent until you run the queue.</span></div> : app.queue.map((item) => <QueueRow key={item.id} item={item} onDelete={() => void send({ type: 'REMOVE_QUEUE_ITEM', itemId: item.id })} />)}</div>
      {failedCount > 0 && <button className="secondary full" onClick={() => void send({ type: 'RETRY_FAILED' })}><RotateCcw size={16} /> Retry {failedCount} failed</button>}
    </section>}
    {tab === 'extract' && <section className="workspace"><div className="section-heading"><div><h1>Extract</h1><p>Turn an image on the current page into usable assets.</p></div></div><div className="extract-actions"><button className="primary" onClick={() => void send({ type: 'EXTRACT_CURRENT_IMAGE' })}><Scissors size={16} /> Select image on this page</button><p>Or right-click an image and choose <strong>Extract with OpenAssets</strong>. You will be asked for page access only when needed.</p></div><div className="extract-note"><Archive size={18} /><div><strong>Direct ZIP and Canvas Editor remain available</strong><span>Choose the workflow after selecting an image.</span></div></div></section>}
    {tab === 'library' && <section className="workspace"><div className="section-heading"><div><h1>Library</h1><p>Your queue history stays on this device until you explicitly save assets to an OpenAssets Collection.</p></div></div><div className="library-grid">{app.library.length === 0 ? <div className="empty"><FolderOpen size={24} /><strong>Your library is empty</strong><span>Completed generations appear here with their original prompt and source conversation.</span></div> : app.library.map((item) => <article className="library-item" key={item.id}><div className="thumbnail"><Download size={18} /></div><strong>{item.prompt}</strong><span>{item.outputs.length} download{item.outputs.length === 1 ? '' : 's'}</span>{item.sourceConversationUrl && <a href={item.sourceConversationUrl} target="_blank">Open conversation</a>}</article>)}</div></section>}
  </main>;
}

function QueueRow({ item, onDelete }: { item: QueueItem; onDelete: () => void }) {
  return <article className="queue-row"><div className="queue-copy"><strong>{item.prompt}</strong><span>{item.references.length ? `${item.references.length} reference image${item.references.length === 1 ? '' : 's'} · ` : ''}{item.aspectRatio}</span>{item.error && <small>{item.error}</small>}</div><div className={`status ${item.status}`}>{labels[item.status]}</div><button className="icon-button" aria-label={`Delete ${item.prompt}`} onClick={onDelete}><Trash2 size={16} /></button></article>;
}
