import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCcw, TriangleAlert } from 'lucide-react';
import type { SentItem, WorkerResponse } from '../shared/contracts';
import { frontendUrl } from '../shared/config';
import { describeSentChanges, formatAge, isInProgress, nextPollDelay } from '../shared/sent';
import { SentBadge, Thumb } from './components';

/**
 * Keeps the list's statuses current while it is on screen. Asks the worker for
 * a refresh at once when a row is in progress, then backs off (3 s, 5 s, 8 s,
 * 13 s, then 30 s). It stops when the list unmounts (panel closed or another tab
 * showing), when nothing is in progress, and pauses while the page is hidden.
 */
function usePolling(items: SentItem[], refresh: () => Promise<WorkerResponse>) {
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const pending = items.filter(isInProgress).map((item) => item.jobId).join(',');
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const retryRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!pending) { setError(null); setUpdating(false); return; }
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { timer = setTimeout(() => void tick(), nextPollDelay(attempt)); };
    const tick = async () => {
      clearTimeout(timer);
      if (cancelled) return;
      if (document.hidden) { schedule(); return; }
      setUpdating(true);
      let failure: string | null = null;
      try {
        const result = await refreshRef.current();
        if (!result.ok) failure = result.error;
      } catch (caught) {
        failure = caught instanceof Error ? caught.message : 'Could not reach OpenAssets.';
      }
      if (cancelled) return;
      setUpdating(false);
      setError(failure);
      attempt += 1;
      schedule();
    };
    const restart = () => { clearTimeout(timer); attempt = 0; void tick(); };
    const onVisible = () => { if (!document.hidden) restart(); };
    retryRef.current = restart;
    document.addEventListener('visibilitychange', onVisible);
    restart();
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [pending]);

  return { error, updating, retry: () => retryRef.current() };
}

/** Words for a polite live region, set when a status changes while the list is open. */
function useAnnouncement(items: SentItem[]) {
  const [text, setText] = useState('');
  const previous = useRef<SentItem[] | null>(null);
  useEffect(() => {
    if (previous.current) {
      const change = describeSentChanges(previous.current, items);
      if (change) setText(change);
    }
    previous.current = items;
  }, [items]);
  return text;
}

export function SentList({ items, refresh, onClear }: {
  items: SentItem[];
  refresh: () => Promise<WorkerResponse>;
  onClear: () => void;
}) {
  const { error, updating, retry } = usePolling(items, refresh);
  const announcement = useAnnouncement(items);

  return (
    <section className="ext-sent" aria-labelledby="sent-heading">
      <div className="ext-sent-head">
        <h2 className="oa-label" id="sent-heading">Sent from this browser</h2>
        {items.length > 0 && (
          <button type="button" className="oa-btn oa-btn-ghost oa-btn-sm" onClick={onClear} title="Removes this list from this browser. Your uploads stay in your account until they expire.">
            Clear list
          </button>
        )}
      </div>
      <p className="oa-sr-only" role="status">{announcement}</p>

      {items.length === 0
        ? <p className="ext-sent-empty">Nothing sent yet. Images you extract from a page or send from the Library show up here for 24 hours.</p>
        : (
          <>
            <ul aria-label="Sent from this browser" aria-busy={updating}>
              {items.map((item) => <SentRow key={item.jobId} item={item} />)}
            </ul>
            {error && (
              <div className="oa-notice oa-notice-warning ext-sent-error" role="status">
                <TriangleAlert aria-hidden="true" />
                <span>Could not update statuses. {error}</span>
                <button type="button" className="oa-btn oa-btn-ghost oa-btn-sm" onClick={retry}><RotateCcw aria-hidden="true" />Try again</button>
              </div>
            )}
            <p className="ext-hint">Shown for 24 hours. Clear list removes it from this browser only.</p>
          </>
        )}
    </section>
  );
}

function SentRow({ item }: { item: SentItem }) {
  const openable = item.status !== 'expired';
  return (
    <li className="ext-row ext-sent-row">
      <Thumb src={item.thumbnailUrl} size="sm" />
      <div className="ext-row-main">
        <p className="ext-row-prompt" title={item.fileName}>{item.fileName}</p>
        <div className="ext-row-meta">
          <SentBadge status={item.status} />
          <span className="ext-meta">{formatAge(item.sentAt)}</span>
        </div>
        {item.status === 'failed' && <p className="ext-row-error" data-tone="danger">{item.error ?? 'Detection failed.'}</p>}
        {item.status === 'expired' && <p className="ext-row-error" data-tone="warning">The original is no longer stored.</p>}
      </div>
      {openable && (
        <a
          className="oa-btn oa-btn-ghost oa-btn-sm oa-btn-icon"
          href={`${frontendUrl}/editor/${encodeURIComponent(item.jobId)}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${item.fileName} in the editor`}
          title="Open in editor"
        >
          <ExternalLink aria-hidden="true" />
        </a>
      )}
    </li>
  );
}
