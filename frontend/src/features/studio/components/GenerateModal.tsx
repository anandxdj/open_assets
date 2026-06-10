"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Text-to-image modal. Mount conditionally — state lives in the parent hook.

import { useEffect } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { ART_STYLE_GROUPS } from "@/features/studio/lib/artStyles";

const field =
  "w-full border-2 border-zinc-300 dark:border-zinc-700 bg-background px-3 py-2 text-[13px] rounded-none focus:border-zinc-950 dark:focus:border-white focus:outline-none";

export function GenerateModal({
  onClose,
  prompt,
  setPrompt,
  width,
  setWidth,
  height,
  setHeight,
  artStyle,
  setArtStyle,
  generating,
  onGenerate,
  workflowNote,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
  showSceneBrief,
  layerLabel,
}: {
  onClose: () => void;
  prompt: string;
  setPrompt: (v: string) => void;
  width: number;
  setWidth: (v: number) => void;
  height: number;
  setHeight: (v: number) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  generating: boolean;
  onGenerate: () => void;
  workflowNote?: string | null;
  sceneBrief?: string;
  setSceneBrief?: (v: string) => void;
  sceneBriefLoading?: boolean;
  showSceneBrief?: boolean;
  layerLabel?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg border-2 border-zinc-950 dark:border-zinc-700 bg-background p-6 rounded-none shadow-[6px_6px_0_0_rgba(0,0,0,0.9)] dark:shadow-[6px_6px_0_0_rgba(255,255,255,0.15)]">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center bg-zinc-950 text-white dark:bg-white dark:text-black">
              <Sparkles size={15} />
            </div>
            <h2 className="text-sm font-black uppercase tracking-wider">Generate image</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {workflowNote && (
          <div className="mb-4 border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {workflowNote}
          </div>
        )}

        <div className="space-y-4">
          {showSceneBrief && setSceneBrief && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                  Scene direction
                </label>
                {sceneBriefLoading ? (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
                    <Loader2 size={10} className="animate-spin" />
                    Deriving from Near…
                  </span>
                ) : (
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Shared across all layers
                  </span>
                )}
              </div>
              <textarea
                value={sceneBrief ?? ""}
                onChange={(e) => setSceneBrief(e.target.value)}
                disabled={generating || sceneBriefLoading}
                placeholder="Generate the Near layer first — we'll derive palette, lighting, and mood from that prompt. You can edit this before generating Mid, Far, and Sky."
                rows={3}
                className={`${field} resize-none leading-relaxed`}
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {layerLabel ? `${layerLabel} layer` : "Description"}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A wide mountain valley at golden hour, with a winding river through pine forest"
              rows={3}
              className={`${field} resize-none`}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Width
              </label>
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className={field}>
                {[512, 768, 960, 1024, 1280, 1536, 1920].map((v) => (
                  <option key={v} value={v}>
                    {v}px{v === 1280 ? " · 720p" : v === 1920 ? " · 1080p" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Height
              </label>
              <select value={height} onChange={(e) => setHeight(Number(e.target.value))} className={field}>
                {[360, 540, 720, 768, 1024, 1080, 1280, 1536].map((v) => (
                  <option key={v} value={v}>
                    {v}px{v === 720 ? " · 720p" : v === 1080 ? " · 1080p" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              Style
            </label>
            <select value={artStyle} onChange={(e) => setArtStyle(e.target.value)} className={field}>
              {ART_STYLE_GROUPS.map((group) =>
                group.options.length === 1 && group.label === "Match original" ? (
                  <option key={group.options[0].value} value={group.options[0].value}>
                    Photorealistic
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

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-4 py-2 text-xs font-bold uppercase border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground rounded-none disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onGenerate}
            disabled={generating || !prompt.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase bg-zinc-950 text-white dark:bg-white dark:text-black border-2 border-zinc-950 dark:border-white rounded-none disabled:opacity-40 hover:bg-transparent hover:text-zinc-950 dark:hover:bg-transparent dark:hover:text-white transition-colors"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
