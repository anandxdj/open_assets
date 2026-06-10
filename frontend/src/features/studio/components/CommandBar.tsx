"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Floating bottom bar: optional prompt + art-style picker. Scene-brief block
// appears in parallax/tiles where a shared art direction exists.

import { Loader2 } from "lucide-react";
import { ART_STYLE_GROUPS } from "@/features/studio/lib/artStyles";

export function CommandBar({
  prompt,
  setPrompt,
  artStyle,
  setArtStyle,
  loading,
  hint,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  loading: boolean;
  hint?: string;
  sceneBrief?: string;
  setSceneBrief?: (v: string) => void;
  sceneBriefLoading?: boolean;
}) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-2 px-4 pb-6 pt-2 font-mono">
      {setSceneBrief && (
        <div className="w-full max-w-3xl border-2 border-zinc-950 dark:border-zinc-700 bg-background p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
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
            value={sceneBrief ?? ""}
            onChange={(e) => setSceneBrief(e.target.value)}
            disabled={loading || sceneBriefLoading}
            placeholder="Shared art direction for all layers — generated from your Near layer prompt. Edit to steer Mid, Far, and Sky."
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed focus:outline-none"
          />
        </div>
      )}

      <div className="flex w-full max-w-3xl items-stretch gap-2 border-2 border-zinc-950 dark:border-zinc-700 bg-background p-1.5">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={loading}
          placeholder={hint ?? "Optional: describe what should appear in the new area…"}
          className="flex-1 bg-transparent px-3 py-2.5 text-[13px] focus:outline-none"
        />

        <div className="hidden items-center border-l border-border sm:flex">
          <select
            value={artStyle}
            onChange={(e) => setArtStyle(e.target.value)}
            disabled={loading}
            className="cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[12px] uppercase font-bold text-muted-foreground focus:outline-none"
            title="Art style for the extension"
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
  );
}
