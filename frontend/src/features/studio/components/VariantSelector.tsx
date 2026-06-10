"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { ArrowLeft, ArrowRight, Check, Download, Loader2, RefreshCw, X } from "lucide-react";

export function VariantSelector({
  index,
  total,
  isBest,
  score,
  onPrev,
  onNext,
}: {
  index: number;
  total: number;
  /** True when the current variant is the algorithm-picked best blend. */
  isBest: boolean;
  /** Optional raw seam score, only shown in debug mode. */
  score?: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 border border-zinc-950 dark:border-zinc-700 py-0.5 pl-1 pr-2 rounded-none"
      role="group"
      aria-label="Cycle between extension variants"
    >
      <button
        onClick={onPrev}
        className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label="Previous variant (←)"
        title="Previous variant (←)"
      >
        <ArrowLeft size={13} />
      </button>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        Variant {index + 1}/{total}
      </span>
      {isBest && (
        <span
          className="bg-zinc-950 text-white dark:bg-white dark:text-black px-1.5 py-px text-[10px] font-black tracking-wide"
          title="Algorithm's pick: lowest seam residual"
        >
          BEST
        </span>
      )}
      {typeof score === "number" && (
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title="Mean color difference at the seam — lower is better"
        >
          {score.toFixed(1)}
        </span>
      )}
      <button
        onClick={onNext}
        className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label="Next variant (→)"
        title="Next variant (→)"
      >
        <ArrowRight size={13} />
      </button>
    </div>
  );
}

export function ResultActions({
  onAccept,
  onRegenerate,
  onDiscard,
  onDownload,
  loading,
}: {
  onAccept: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
  onDownload: () => void;
  loading: boolean;
}) {
  const ghost =
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground disabled:opacity-40 rounded-none";
  return (
    <div className="flex items-center gap-1.5 border-2 border-zinc-950 dark:border-zinc-700 bg-background p-1">
      <button onClick={onDiscard} disabled={loading} className={ghost} title="Discard this extension">
        <X size={14} />
        Discard
      </button>
      <button onClick={onRegenerate} disabled={loading} className={ghost} title="Generate a new variation">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Regenerate
      </button>
      <button onClick={onDownload} disabled={loading} className={ghost} title="Download as PNG">
        <Download size={14} />
        Download
      </button>
      <div className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button
        onClick={onAccept}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-black uppercase bg-zinc-950 text-white dark:bg-white dark:text-black border border-zinc-950 dark:border-white rounded-none disabled:opacity-40 hover:bg-transparent hover:text-zinc-950 dark:hover:bg-transparent dark:hover:text-white transition-colors"
        title="Use this as the new base image"
      >
        <Check size={14} />
        Accept
      </button>
    </div>
  );
}
