"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { useEffect } from "react";
import { Key, Settings2, Trash2, X } from "lucide-react";
import { MODELS, maskKey } from "@/features/studio/lib/models";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";

export function SettingsDrawer({
  open,
  onClose,
  onEditApiKey,
}: {
  open: boolean;
  onClose: () => void;
  onEditApiKey: () => void;
}) {
  const {
    apiKey,
    setApiKey,
    selectedModel,
    setSelectedModel,
    debugMode,
    setDebugMode,
    credits,
  } = useStudioSettings();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col border-l-2 border-zinc-950 dark:border-zinc-700 bg-background font-mono">
        <div className="flex h-14 shrink-0 items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 px-5">
          <h2 className="text-xs font-black uppercase tracking-widest">Studio Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <Section title="Plan">
            <div className="border-2 border-zinc-200 dark:border-zinc-800 p-3 text-[12px]">
              {apiKey ? (
                <p>
                  <span className="font-black uppercase">BYOK</span>{" "}
                  <span className="text-muted-foreground">
                    — using your OpenRouter key, no credit limits.
                  </span>
                </p>
              ) : credits ? (
                <p>
                  <span className="font-black uppercase">Free tier</span>{" "}
                  <span className="text-muted-foreground">
                    — {credits.credits}/{credits.monthlyGrant} credits, resets{" "}
                    {new Date(credits.resetAt).toLocaleDateString()}.
                  </span>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Sign in for free monthly credits, or add your own OpenRouter key below.
                </p>
              )}
            </div>
          </Section>

          <Section title="Model">
            <div className="space-y-2">
              {MODELS.map((m) => {
                const active = m.value === selectedModel;
                return (
                  <button
                    key={m.value}
                    onClick={() => setSelectedModel(m.value)}
                    className={`flex w-full items-start gap-3 border-2 p-3 text-left rounded-none transition-colors ${
                      active
                        ? "border-zinc-950 dark:border-white bg-zinc-950 text-white dark:bg-white dark:text-black"
                        : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold uppercase">{m.label}</div>
                      <div
                        className={`mt-0.5 truncate text-[11px] ${
                          active ? "opacity-70" : "text-muted-foreground"
                        }`}
                      >
                        {m.hint ? `${m.hint} · ` : ""}~{m.approxSecondsPerCall}s/call
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="OpenRouter key">
            {apiKey ? (
              <div className="flex items-center gap-3 border-2 border-zinc-200 dark:border-zinc-800 p-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-zinc-950 text-white dark:bg-white dark:text-black">
                  <Key size={13} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold uppercase">Key saved locally</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {maskKey(apiKey)}
                  </div>
                </div>
                <button
                  onClick={onEditApiKey}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label="Edit key"
                  title="Edit key"
                >
                  <Settings2 size={14} />
                </button>
                <button
                  onClick={() => setApiKey("")}
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                  aria-label="Remove key"
                  title="Remove key"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={onEditApiKey}
                className="inline-flex w-full items-center gap-2 border-2 border-zinc-950 dark:border-zinc-700 px-3 py-2.5 text-xs font-black uppercase rounded-none hover:bg-zinc-950 hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors"
              >
                <Key size={14} />
                Add OpenRouter key
              </button>
            )}
            <p className="mt-2 text-[12px] text-muted-foreground">
              Stored only in this browser. Get one at{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold underline underline-offset-4"
              >
                openrouter.ai/keys
              </a>
              .
            </p>
          </Section>

          <Section title="Developer">
            <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
              <div className="flex-1">
                <div className="text-[13px] font-bold uppercase">Debug overlay</div>
                <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  Draw seam guides and log Poisson scores to the console.
                </div>
              </div>
              <span
                role="switch"
                aria-checked={debugMode}
                onClick={() => setDebugMode(!debugMode)}
                className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 rounded-none transition-colors ${
                  debugMode
                    ? "border-zinc-950 dark:border-white bg-zinc-950 dark:bg-white"
                    : "border-zinc-300 dark:border-zinc-700 bg-transparent"
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 transition-transform ${
                    debugMode
                      ? "translate-x-[18px] bg-white dark:bg-black"
                      : "translate-x-[3px] bg-zinc-400"
                  }`}
                />
              </span>
            </label>
          </Section>

          <Section title="About">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Extensions are 38% of the current image dimension. For larger extensions,
              click an edge again after accepting. Seamless blending via Poisson editing
              (Pérez et al. 2003).
            </p>
          </Section>
        </div>
      </aside>
    </>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
