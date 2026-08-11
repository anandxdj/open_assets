"use client";

import { useCallback, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type PreparedAsset,
  type SourceAsset,
  DEFAULT_PREPARE_OPTIONS,
} from "@/features/anibuddy/types";
import { PrepareError, prepareAsset } from "@/features/anibuddy/lib/prepare";

const CHECKERBOARD =
  "bg-[linear-gradient(45deg,#e4e4e7_25%,transparent_25%),linear-gradient(-45deg,#e4e4e7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e4e4e7_75%),linear-gradient(-45deg,transparent_75%,#e4e4e7_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] dark:bg-[linear-gradient(45deg,#27272a_25%,transparent_25%),linear-gradient(-45deg,#27272a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#27272a_75%),linear-gradient(-45deg,transparent_75%,#27272a_75%)]";

interface PrepareStepProps {
  source: SourceAsset;
  prepared: PreparedAsset | null;
  onPrepared: (prepared: PreparedAsset | null) => void;
  onContinue: () => void;
}

export function PrepareStep({ source, prepared, onPrepared, onContinue }: PrepareStepProps) {
  // Seed from the asset already on the project, so walking back into this step
  // shows the settings that actually produced what is on screen.
  const seed = prepared?.options ?? DEFAULT_PREPARE_OPTIONS;
  const [keepBackground, setKeepBackground] = useState(seed.keepBackground);
  const [keepLooseParts, setKeepLooseParts] = useState(seed.keepLooseParts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onPrepared(await prepareAsset(source.dataUrl, { keepBackground, keepLooseParts }));
    } catch (cause) {
      // Keep whatever was already prepared. `setPrepared` also clears the rig and
      // the motion, so nulling here would destroy finished rig work because a
      // *retry* failed — and the asset that produced that rig is still valid.
      // The user flips an option and tries again, or continues with the old one.
      setError(
        cause instanceof PrepareError
          ? cause.message
          : "Preparation failed unexpectedly. Try a different image.",
      );
    } finally {
      setBusy(false);
    }
  }, [source.dataUrl, keepBackground, keepLooseParts, onPrepared]);

  return (
    <section className="border-2 border-zinc-950 bg-card text-card-foreground p-5 dark:border-zinc-100 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            02 / prepared asset
          </p>
          <h2 className="mt-1 text-xl font-black uppercase tracking-tight">Cut the character out</h2>
        </div>
        {prepared && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Ready to rig
          </span>
        )}
      </div>

      <p className="max-w-2xl text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        Removes background, cleans stray specks, and trims asset to silhouette.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <figure>
          <figcaption className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Supplied
          </figcaption>
          <div className={cn("grid min-h-56 place-items-center overflow-hidden border border-zinc-300 dark:border-zinc-700", CHECKERBOARD)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source.dataUrl} alt="Supplied artwork" className="max-h-72 max-w-full object-contain" />
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {source.width} × {source.height}px
          </p>
        </figure>

        <figure>
          <figcaption className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Prepared
          </figcaption>
          <div className={cn("grid min-h-56 place-items-center overflow-hidden border border-zinc-300 dark:border-zinc-700", CHECKERBOARD)}>
            {prepared ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={prepared.dataUrl} alt="Prepared transparent artwork" className="max-h-72 max-w-full object-contain" />
            ) : (
              <p className="px-4 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {busy ? "Working" : "Not prepared yet"}
              </p>
            )}
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {prepared ? `${prepared.width} × ${prepared.height}px · trimmed` : "—"}
          </p>
        </figure>
      </div>

      <div className="mt-5 space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-5">
          <input
            type="checkbox"
            checked={keepBackground}
            onChange={(event) => setKeepBackground(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-fuchsia-700"
          />
          <span>
            Keep the original background
            <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-300">
              For art whose backdrop is part of the piece. Only works if the image already has
              transparency to trim against.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-5">
          <input
            type="checkbox"
            checked={keepLooseParts}
            onChange={(event) => setKeepLooseParts(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-fuchsia-700"
          />
          <span>
            Keep detached parts
            <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-300">
              Leave held props, floating hair, or a separated tail in place instead of keeping only
              the largest shape.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p className="mt-4 border border-red-500 bg-red-50 px-3 py-2 text-sm leading-6 dark:bg-red-950/30">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="flex items-center gap-2 border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 dark:border-zinc-100"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {prepared ? "Prepare again" : "Prepare asset"}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!prepared || busy}
          className="bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue to rig
        </button>
      </div>
    </section>
  );
}
