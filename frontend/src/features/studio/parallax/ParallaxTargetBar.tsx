"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Bottom bar: target width + presets, auto-extend progress, tileable /
// harmonize / export actions.

import { useState } from "react";
import { Download, Layers, Loader2, Repeat, Sparkles, Square, Target, Waves } from "lucide-react";
import { PARALLAX_TARGET_PRESETS } from "@/features/studio/lib/parallax";

const ghostBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground disabled:opacity-40 rounded-none";

export function ParallaxTargetBar({
  dimensions,
  targetWidth,
  setTargetWidth,
  progress,
  remainingPx,
  targetReached,
  autoExtending,
  loading,
  onAutoExtend,
  onStopAutoExtend,
  onMakeTileable,
  makeTileableDisabled,
  onHarmonize,
  harmonizeDisabled,
  onDownloadFull,
  onExportZip,
  exportZipDisabled,
  exportZipTitle,
}: {
  dimensions: { width: number; height: number } | null;
  targetWidth: number | null;
  setTargetWidth: (n: number | null) => void;
  progress: number;
  remainingPx: number;
  targetReached: boolean;
  autoExtending: boolean;
  loading: boolean;
  onAutoExtend: () => void;
  onStopAutoExtend: () => void;
  onMakeTileable: () => void;
  makeTileableDisabled?: boolean;
  onHarmonize: () => void;
  harmonizeDisabled?: boolean;
  onDownloadFull: () => void;
  onExportZip: () => void;
  exportZipDisabled?: boolean;
  exportZipTitle?: string;
}) {
  const [showPresets, setShowPresets] = useState(false);
  return (
    <div className="flex w-full flex-wrap items-center gap-3 border-2 border-zinc-950 dark:border-zinc-700 bg-background p-2.5 font-mono">
      {/* Target input */}
      <div className="relative flex items-center gap-2">
        <Target size={14} className="ml-1 text-muted-foreground" />
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Target
        </span>
        <input
          type="number"
          min={dimensions?.width ?? 0}
          max={20000}
          step={64}
          value={targetWidth ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setTargetWidth(v === "" ? null : Math.max(0, Number(v)));
          }}
          placeholder="e.g. 7680"
          disabled={loading || autoExtending}
          className="w-24 border-2 border-zinc-300 dark:border-zinc-700 bg-background px-2 py-1 font-mono text-[12px] focus:border-zinc-950 dark:focus:border-white focus:outline-none rounded-none"
        />
        <span className="text-[10px] uppercase text-muted-foreground">px</span>
        <button
          onClick={() => setShowPresets((s) => !s)}
          className="flex h-7 w-7 items-center justify-center border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground"
          aria-label="Width presets"
          title="Width presets"
        >
          <Layers size={13} />
        </button>
        {showPresets && (
          <div className="absolute left-0 top-full z-30 mt-1 flex min-w-[230px] flex-col border-2 border-zinc-950 dark:border-zinc-700 bg-background p-1">
            {PARALLAX_TARGET_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setTargetWidth(p.value);
                  setShowPresets(false);
                }}
                className="flex items-center justify-between px-2.5 py-1.5 text-left text-[12px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <span className="font-mono">{p.label}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{p.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="flex min-w-[120px] flex-1 items-center gap-2 px-2">
        <div className="h-1.5 flex-1 overflow-hidden bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full transition-all ${targetReached ? "bg-green-600" : "bg-zinc-950 dark:bg-white"}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <span className="min-w-[64px] font-mono text-[11px] tabular-nums text-muted-foreground">
          {targetReached ? "Reached" : remainingPx > 0 ? `${remainingPx}px left` : "—"}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {autoExtending ? (
          <button
            onClick={onStopAutoExtend}
            className="inline-flex items-center gap-1.5 border border-destructive px-3 py-1.5 text-[11px] font-bold uppercase text-destructive rounded-none"
            title="Stop auto-extend"
          >
            <Square size={12} />
            Stop
          </button>
        ) : (
          <button
            onClick={onAutoExtend}
            disabled={loading || !targetWidth || !dimensions || dimensions.width >= targetWidth}
            className="inline-flex items-center gap-1.5 bg-zinc-950 text-white dark:bg-white dark:text-black border border-zinc-950 dark:border-white px-3 py-1.5 text-[11px] font-black uppercase rounded-none disabled:opacity-40 hover:bg-transparent hover:text-zinc-950 dark:hover:bg-transparent dark:hover:text-white transition-colors"
            title="Auto-extend right until target width is reached"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Auto-extend
          </button>
        )}
        <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <button
          onClick={onMakeTileable}
          disabled={loading || autoExtending || !!makeTileableDisabled}
          className={ghostBtn}
          title="Make tileable — heals the loop-point seam so repeat-x scrolling has no visible joint"
        >
          <Repeat size={14} />
          Tileable
        </button>
        <button
          onClick={onHarmonize}
          disabled={loading || autoExtending || !!harmonizeDisabled}
          className={ghostBtn}
          title="Harmonize — flatten cumulative color/brightness drift across many extensions"
        >
          <Waves size={14} />
          Harmonize
        </button>
        <button
          onClick={onDownloadFull}
          disabled={loading || autoExtending}
          className={ghostBtn}
          title="Download as a single PNG"
        >
          <Download size={14} />
          PNG
        </button>
        <button
          onClick={onExportZip}
          disabled={loading || autoExtending || !dimensions || !!exportZipDisabled}
          className={ghostBtn}
          title={exportZipTitle || "Export project ZIP"}
        >
          <Layers size={14} />
          ZIP
        </button>
      </div>
    </div>
  );
}
