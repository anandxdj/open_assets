"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Eye, EyeOff, Key, X } from "lucide-react";

/** Mount conditionally — state initializes fresh on each open. */
export function ApiKeyModal({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue: string;
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmed = value.trim();
  const looksValid = trimmed.startsWith("sk-or-") && trimmed.length > 20;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md border-2 border-zinc-950 dark:border-zinc-700 bg-background p-6 rounded-none shadow-[6px_6px_0_0_rgba(0,0,0,0.9)] dark:shadow-[6px_6px_0_0_rgba(255,255,255,0.15)]">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-950 text-white dark:bg-white dark:text-black">
            <Key size={16} />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-black uppercase tracking-wider">OpenRouter Key</h2>
            <p className="text-[11px] text-muted-foreground uppercase">
              Bring your own key — bypasses free credits
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-4">
          <div className="relative">
            <input
              autoFocus
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && looksValid) onSave(trimmed);
              }}
              placeholder="sk-or-..."
              className="w-full border-2 border-zinc-300 dark:border-zinc-700 bg-background px-3 py-2 pr-10 font-mono text-[13px] rounded-none focus:border-zinc-950 dark:focus:border-white focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 flex items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={reveal ? "Hide key" : "Show key"}
              tabIndex={-1}
            >
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {value && !looksValid && (
            <div className="mt-2 flex items-start gap-2 text-[12px] text-destructive">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                OpenRouter keys start with <code className="font-mono font-bold">sk-or-</code>.
              </span>
            </div>
          )}
        </div>

        <div className="mb-4 border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 text-[12px] leading-relaxed text-muted-foreground">
          Stored only in this browser&apos;s{" "}
          <code className="font-mono font-bold">localStorage</code>. Sent with each request to
          this app&apos;s server, which proxies it to OpenRouter and nowhere else — never
          logged, never persisted server-side. Without a key, free-tier prompts and images
          are routed through Open Quota first, then OpenRouter.
        </div>

        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-5 inline-flex items-center gap-1.5 text-[12px] font-bold uppercase underline underline-offset-4 hover:text-foreground"
        >
          Get a key at openrouter.ai/keys
          <ExternalLink size={11} />
        </a>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 rounded-none"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(trimmed)}
            disabled={!looksValid}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase bg-zinc-950 text-white dark:bg-white dark:text-black border-2 border-zinc-950 dark:border-white rounded-none disabled:opacity-40 hover:bg-transparent hover:text-zinc-950 dark:hover:bg-transparent dark:hover:text-white transition-colors"
          >
            <Check size={14} />
            Save Key
          </button>
        </div>
      </div>
    </div>
  );
}
