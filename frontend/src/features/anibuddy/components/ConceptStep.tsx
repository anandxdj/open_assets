"use client";

import { useState } from "react";
import { Copy, ExternalLink, Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { requestPrompt } from "@/features/anibuddy/api/anibuddyClient";

type View = "front" | "three-quarter";

interface ConceptStepProps {
  idea: string;
  prompt: string | null;
  onIdea: (idea: string) => void;
  onPrompt: (prompt: string | null) => void;
  onSkip: () => void;
}

export function ConceptStep({ idea, prompt, onIdea, onPrompt, onSkip }: ConceptStepProps) {
  const [view, setView] = useState<View>("front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!idea.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { prompt: written } = await requestPrompt({ idea: idea.trim(), view });
      onPrompt(written);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The prompt helper failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="border-2 border-zinc-950 bg-card text-card-foreground p-5 dark:border-zinc-100 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            00 / optional
          </p>
          <h2 className="mt-1 text-xl font-black uppercase tracking-tight">Start from an idea</h2>
        </div>
        {prompt && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Prompt ready
          </span>
        )}
      </div>

      <p className="max-w-2xl text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        Describe your character to generate a structured image prompt for external art tools.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="anibuddy-idea" className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Character idea
          </label>
          <textarea
            id="anibuddy-idea"
            value={idea}
            onChange={(event) => onIdea(event.target.value)}
            rows={3}
            placeholder="e.g. a red fox courier in a canvas backpack, 2D vector style"
            className="w-full resize-y border-2 border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-fuchsia-700 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>

        <div>
          <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            View
          </span>
          <div className="flex gap-2">
            {(["front", "three-quarter"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                aria-pressed={view === option}
                className={cn(
                  "border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider",
                  view === option
                    ? "border-fuchsia-700 bg-fuchsia-700 text-white"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-950 dark:border-zinc-700 dark:text-zinc-300",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!idea.trim() || busy}
            className="flex items-center gap-2 border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 dark:border-zinc-100"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Write prompt
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500 underline underline-offset-4 hover:text-zinc-950 dark:hover:text-zinc-100"
          >
            Skip — I already have art
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 border border-red-500 bg-red-50 px-3 py-2 text-sm leading-6 dark:bg-red-950/30">
          {error}
        </p>
      )}

      {prompt && (
        <div className="mt-5 border-2 border-zinc-950 dark:border-zinc-100">
          <div className="flex items-center justify-between gap-3 border-b-2 border-zinc-950 px-3 py-2 dark:border-zinc-100">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
              Prompt for your image tool
            </span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
              <ExternalLink className="h-3 w-3" />
              external only
            </span>
          </div>
          <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6">{prompt}</p>
          <div className="border-t-2 border-zinc-950 p-3 dark:border-zinc-100">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy prompt"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
