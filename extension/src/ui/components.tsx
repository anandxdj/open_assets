import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Ban, Check, ChevronDown, CircleAlert, Clock, Download, Hourglass, Image as ImageIcon, LoaderCircle, LogOut, Pause, PencilLine, Send, Upload, type LucideIcon } from 'lucide-react';
import type { Account, QueueStatus } from '../shared/contracts';

/** The OA monogram drawn as a vector so it follows the text colour (same mark as the web app). */
export function LogoMark() {
  const maskId = useId();
  return (
    <svg viewBox="90 380 1370 780" className="ext-mark" aria-hidden="true" focusable="false">
      <mask id={maskId}>
        <rect x="0" y="0" width="1600" height="1600" fill="white" />
        <polygon points="593,1200 926,600 1100,600 1100,1200" fill="black" />
      </mask>
      <circle cx="480" cy="770" r="294" fill="none" stroke="currentColor" strokeWidth="172" mask={`url(#${maskId})`} />
      <polygon points="695,1115 1100,390 1450,1115 975,1115 1075,945 1195,945 1095,750 890,1115" fill="currentColor" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="ext-brand">
      <LogoMark />
      <span className="ext-wordmark">OpenAssets</span>
    </span>
  );
}

export function Spinner() {
  return <LoaderCircle className="oa-spin" aria-hidden="true" />;
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const statusLabels: Record<QueueStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  preparing: 'Preparing',
  uploading_refs: 'Uploading references',
  submitting: 'Submitting',
  generating: 'Generating',
  downloading: 'Downloading',
  completed: 'Complete',
  paused: 'Paused',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const statusLook: Record<QueueStatus, { tone: Tone; icon: LucideIcon; spin?: boolean }> = {
  draft: { tone: 'neutral', icon: PencilLine },
  queued: { tone: 'neutral', icon: Clock },
  preparing: { tone: 'info', icon: Hourglass },
  uploading_refs: { tone: 'info', icon: Upload },
  submitting: { tone: 'info', icon: Send },
  generating: { tone: 'info', icon: LoaderCircle, spin: true },
  downloading: { tone: 'info', icon: Download },
  completed: { tone: 'success', icon: Check },
  paused: { tone: 'warning', icon: Pause },
  failed: { tone: 'danger', icon: CircleAlert },
  cancelled: { tone: 'neutral', icon: Ban },
};

export function statusTone(status: QueueStatus): Tone {
  return statusLook[status].tone;
}

/** Status always pairs an icon, words and colour. */
export function StatusBadge({ status }: { status: QueueStatus }) {
  const { tone, icon: Icon, spin } = statusLook[status];
  return (
    <span className={tone === 'neutral' ? 'oa-badge' : `oa-badge oa-badge-${tone}`}>
      <Icon className={spin ? 'oa-spin' : undefined} aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

/** Square checkerboard thumbnail; falls back to an image icon when there is no source or it fails to load. */
export function Thumb({ src, size }: { src?: string; size: 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`ext-thumb ext-thumb-${size} oa-checker`} aria-hidden="true">
      {src && !failed
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <ImageIcon />}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="ext-empty">
      <span className="oa-icon-box">{icon}</span>
      <strong className="oa-section">{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange, className }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div className="oa-field">
      <span className="oa-field-label" id={labelId}>{label}</span>
      <div className={`oa-seg oa-seg-block${className ? ` ${className}` : ''}`} role="group" aria-labelledby={labelId}>
        {options.map((option) => (
          <button key={option.value} type="button" className="oa-seg-item" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

/** Avatar button with a menu showing who is signed in and a sign-out action. */
export function AccountMenu({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const identityId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' && event.target === triggerRef.current) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className="ext-account" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="oa-btn oa-btn-ghost oa-btn-sm ext-account-btn"
        aria-label={`Account menu, ${account.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="oa-avatar oa-avatar-sm" aria-hidden="true">{initials(account.name)}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="oa-menu ext-account-menu">
          <div className="ext-account-id" id={identityId}>
            <span className="ext-account-name">{account.name}</span>
            <span className="ext-account-email">{account.email}</span>
          </div>
          <div className="oa-menu-sep" aria-hidden="true" />
          <div ref={menuRef} id={menuId} role="menu" aria-label="Account" aria-describedby={identityId}>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="oa-menu-item oa-menu-item-danger"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
