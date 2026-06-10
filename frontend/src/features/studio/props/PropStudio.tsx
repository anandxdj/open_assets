"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Props Studio UI: ever-growing decoration gallery + biome presets + prompt rail.

import { Download, Layers, Loader2, Plus, Sparkles, Sprout, Square, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ART_STYLE_GROUPS } from "@/features/studio/lib/artStyles";
import { PROP_PRESETS } from "@/features/studio/lib/props";
import type { PropItem } from "@/features/studio/lib/props";

const CHECKER =
  "bg-[repeating-conic-gradient(#80808033_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]";

const ghostBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 disabled:opacity-40 rounded-none";

export function PropItemCell({
  item,
  index,
  onRegenerate,
  onDelete,
  busy,
}: {
  item: PropItem;
  index: number;
  onRegenerate: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden border border-zinc-300 dark:border-zinc-700 rounded-none",
        CHECKER,
      )}
      title={item.name || `Prop ${index + 1}`}
    >
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt={item.name || `Prop ${index + 1}`}
          draggable={false}
          className="block h-full w-full object-contain"
        />
      ) : (
        <div className="h-full w-full" />
      )}

      {item.generating && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <Loader2 size={18} className="animate-spin text-white" />
        </div>
      )}

      <div className="pointer-events-none absolute left-1 top-1 bg-black/45 px-1 py-px font-mono text-[8px] text-white backdrop-blur">
        {item.name ? item.name.slice(0, 16) : index + 1}
      </div>

      {item.imageUrl && !item.generating && (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="inline-flex h-6 w-6 items-center justify-center bg-black/60 text-white backdrop-blur"
            title="Re-roll this prop — a new decoration matched to the rest of the set"
          >
            <Sparkles size={11} />
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="inline-flex h-6 w-6 items-center justify-center bg-black/60 text-red-400 backdrop-blur"
            title="Delete this prop from the library"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

export function PropStudio({
  items,
  batchSize,
  prompt,
  setPrompt,
  artStyle,
  setArtStyle,
  generating,
  progressMessage,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
  onAddMore,
  onStop,
  onRegenerate,
  onDelete,
  onClearAll,
  onDownloadSheet,
  onDownloadZip,
}: {
  items: PropItem[];
  batchSize: number;
  prompt: string;
  setPrompt: (v: string) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  generating: boolean;
  progressMessage?: string | null;
  sceneBrief: string;
  setSceneBrief: (v: string) => void;
  sceneBriefLoading: boolean;
  onAddMore: () => void;
  onStop: () => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onDownloadSheet: () => void;
  onDownloadZip: () => void;
}) {
  const filledCount = items.filter((p) => p.imageUrl).length;
  const hasAny = filledCount > 0;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3 font-mono sm:px-6">
      <div className="flex items-center justify-center gap-2 text-center text-[11px] uppercase">
        <Sprout size={14} />
        <span className="text-muted-foreground">
          Props mode — a growing library of transparent decorations to scatter over your tile
          map. Each press paints {batchSize} new props; keep adding for an endless set.
        </span>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {generating ? (
          <button
            onClick={onStop}
            className="inline-flex items-center gap-1.5 border border-destructive px-3 py-1.5 text-[11px] font-bold uppercase text-destructive rounded-none"
            title="Stop the current generation"
          >
            <Square size={12} />
            Stop
          </button>
        ) : (
          <button
            onClick={onAddMore}
            disabled={!prompt.trim()}
            className="inline-flex items-center gap-1.5 bg-zinc-950 text-white dark:bg-white dark:text-black border border-zinc-950 dark:border-white px-3 py-1.5 text-[11px] font-black uppercase rounded-none disabled:opacity-40 hover:bg-transparent hover:text-zinc-950 dark:hover:bg-transparent dark:hover:text-white transition-colors"
            title={
              hasAny
                ? `Paint ${batchSize} more decorations and add them to the library`
                : `Paint your first ${batchSize} decorations`
            }
          >
            <Plus size={14} />
            {hasAny ? `Add ${batchSize} more` : `Generate ${batchSize} props`}
          </button>
        )}
        <button
          onClick={onDownloadSheet}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Export the packed transparent atlas PNG with a JSON manifest"
        >
          <Download size={14} />
          Atlas + manifest
        </button>
        <button
          onClick={onDownloadZip}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Export individual transparent PNGs + atlas + manifest as a ZIP"
        >
          <Layers size={14} />
          ZIP
        </button>
        <button
          onClick={onClearAll}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Clear the whole library and start over"
        >
          <Trash2 size={14} />
          Clear
        </button>
        <div className="border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {filledCount} prop{filledCount === 1 ? "" : "s"}
          {progressMessage ? ` · ${progressMessage}` : ""}
        </div>
      </div>

      {/* Library gallery */}
      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Decoration library
        </div>
        {items.length === 0 ? (
          <div className="mx-auto flex w-full max-w-3xl items-center justify-center border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-6 py-12 text-center text-[11px] uppercase text-muted-foreground">
            Pick a biome below and press &ldquo;Generate {batchSize} props&rdquo; to start your
            decoration library. Keep pressing &ldquo;Add more&rdquo; to grow it.
          </div>
        ) : (
          <div
            className="mx-auto grid w-full max-w-4xl gap-1.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}
          >
            {items.map((item, i) => (
              <PropItemCell
                key={item.id}
                item={item}
                index={i}
                onRegenerate={() => onRegenerate(item.id)}
                onDelete={() => onDelete(item.id)}
                busy={generating}
              />
            ))}
          </div>
        )}
        <div className="mx-auto max-w-4xl text-[10px] uppercase text-muted-foreground">
          Every prop is exported on transparency. Hover a prop to re-roll or delete it. New
          batches are style-matched to what you already have.
        </div>
      </div>

      {/* Command rail */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <div className="border-2 border-zinc-950 dark:border-zinc-700 bg-background p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Scene direction
            </label>
            {sceneBriefLoading && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
                <Loader2 size={10} className="animate-spin" />
                Updating…
              </span>
            )}
          </div>
          <textarea
            value={sceneBrief}
            onChange={(e) => setSceneBrief(e.target.value)}
            disabled={generating || sceneBriefLoading}
            placeholder="Optional shared art direction. Reused from your parallax / tile work so the props match the same palette and lighting."
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Quick start
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PROP_PRESETS.map((preset) => {
              const active = prompt.trim() === preset.prompt;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPrompt(preset.prompt)}
                  disabled={generating}
                  className={cn(
                    "border px-2.5 py-1 text-[10px] font-bold uppercase transition-colors rounded-none disabled:opacity-50",
                    active
                      ? "border-zinc-950 dark:border-white bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:border-zinc-500 hover:text-foreground",
                  )}
                  title={preset.prompt}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex w-full items-stretch gap-2 border-2 border-zinc-950 dark:border-zinc-700 bg-background p-1.5">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && prompt.trim() && !generating) {
                e.preventDefault();
                onAddMore();
              }
            }}
            placeholder="Describe the biome / palette — or pick a quick start above"
            className="flex-1 bg-transparent px-3 py-2.5 text-[13px] focus:outline-none"
          />
          <div className="hidden items-center border-l border-border sm:flex">
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value)}
              disabled={generating}
              className="cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[12px] uppercase font-bold text-muted-foreground focus:outline-none"
              title="Art style for the props"
            >
              {ART_STYLE_GROUPS.map((group) =>
                group.options.length === 1 && group.label === "Match original" ? (
                  <option key={group.options[0].value} value={group.options[0].value}>
                    {group.options[0].label}
                  </option>
                ) : (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
