"use client";

import { useCallback, useState } from "react";
import { Download, FileJson, Film, Images, Loader2, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type AniBuddyProject,
  type BackgroundId,
  type MotionId,
  type PreparedAsset,
  type Rig,
  MAX_GIF_EDGE,
} from "@/features/anibuddy/types";
import {
  type ExportInput,
  BACKGROUND_LABEL,
  ExportError,
  downloadBlob,
  exportBaseName,
  exportGif,
  exportPngFrames,
} from "@/features/anibuddy/lib/export";
import { buildManifest, manifestFilename } from "@/features/anibuddy/lib/manifest";

const BACKGROUNDS: BackgroundId[] = ["transparent", "white", "dark"];

type Job = "gif" | "png" | null;

interface ExportStepProps {
  project: AniBuddyProject;
  prepared: PreparedAsset;
  rig: Rig;
  motion: MotionId;
  onBackground: (background: BackgroundId) => void;
}

export function ExportStep({ project, prepared, rig, motion, onBackground }: ExportStepProps) {
  const [job, setJob] = useState<Job>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const name = exportBaseName(project.source?.name, motion);
  const input: ExportInput = {
    prepared,
    rig,
    motion,
    frameCount: project.frameCount,
    fps: project.fps,
    background: project.background,
    name,
  };

  const track = (completed: number, total: number) =>
    setProgress(Math.round((completed / total) * 100));

  const runPng = useCallback(async () => {
    setJob("png");
    setProgress(0);
    setError(null);
    setNote(null);
    try {
      downloadBlob(await exportPngFrames(input, track), `${name}-frames.zip`);
    } catch (cause) {
      setError(
        cause instanceof ExportError ? cause.message : "The PNG export failed unexpectedly.",
      );
    } finally {
      setJob(null);
    }
    // `input` is rebuilt every render from project state; depending on it would
    // recreate this callback constantly for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, rig, motion, project.frameCount, project.fps, project.background, name]);

  const runGif = useCallback(async () => {
    setJob("gif");
    setProgress(0);
    setError(null);
    setNote(null);
    try {
      downloadBlob(await exportGif(input, track), `${name}.gif`);
    } catch (cause) {
      // Doc §6's stated mitigation: fall back to the lossless output rather than
      // leaving the user with nothing, and say why it happened.
      const reason = cause instanceof ExportError ? cause.message : "GIF encoding failed.";
      try {
        setJob("png");
        setProgress(0);
        downloadBlob(await exportPngFrames(input, track), `${name}-frames.zip`);
        setNote(`${reason} PNG frames were downloaded instead — they keep full transparency.`);
      } catch {
        setError(`${reason} The PNG fallback failed too.`);
      }
    } finally {
      setJob(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, rig, motion, project.frameCount, project.fps, project.background, name]);

  const runManifest = useCallback(() => {
    setError(null);
    setNote(null);
    const manifest = buildManifest(project, prepared, new Date().toISOString());
    downloadBlob(
      new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      manifestFilename(project),
    );
  }, [project, prepared]);

  const busy = job !== null;

  return (
    <section className="border-2 border-zinc-950 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-900 sm:p-7">
      <div className="mb-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          05 / export
        </p>
        <h2 className="mt-1 text-xl font-black tracking-tight">Take it with you</h2>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          Background
        </p>
        <div className="flex flex-wrap gap-2">
          {BACKGROUNDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onBackground(option)}
              aria-pressed={project.background === option}
              className={cn(
                "border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider",
                project.background === option
                  ? "border-fuchsia-700 bg-fuchsia-700 text-white"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
              )}
            >
              {BACKGROUND_LABEL[option]}
            </button>
          ))}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          A GIF can only mark a pixel as fully transparent or fully opaque, so soft edges are
          flattened onto this colour. Choosing <strong>Transparent</strong> gives a clean cut-out
          with slightly harder edges. The PNG frames keep the real alpha channel either way.
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => void runGif()}
          disabled={busy}
          className="flex items-center justify-center gap-2 bg-fuchsia-700 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:opacity-40"
        >
          {job === "gif" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
          Animated GIF
        </button>
        <button
          type="button"
          onClick={() => void runPng()}
          disabled={busy}
          className="flex items-center justify-center gap-2 border-2 border-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 dark:border-zinc-100"
        >
          {job === "png" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Images className="h-3.5 w-3.5" />}
          PNG frames
        </button>
        <button
          type="button"
          onClick={runManifest}
          disabled={busy}
          className="flex items-center justify-center gap-2 border-2 border-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 dark:border-zinc-100"
        >
          <FileJson className="h-3.5 w-3.5" />
          Project file
        </button>
      </div>

      {busy && (
        <div className="mt-4">
          <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-fuchsia-700 transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Rendering frames · {progress}%
          </p>
        </div>
      )}

      <dl className="mt-5 grid gap-x-6 gap-y-2 border-t border-zinc-200 pt-5 font-mono text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300 sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt>Motion</dt>
          <dd>{motion}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Frames</dt>
          <dd>
            {project.frameCount} @ {project.fps}fps
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>PNG size</dt>
          <dd>
            {prepared.width} × {prepared.height}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>GIF cap</dt>
          <dd>{MAX_GIF_EDGE}px longest edge</dd>
        </div>
      </dl>

      {note && (
        <p className="mt-4 border border-amber-500 bg-amber-50 px-3 py-2 text-sm leading-6 dark:bg-amber-950/25">
          {note}
        </p>
      )}
      {error && (
        <p className="mt-4 border border-red-500 bg-red-50 px-3 py-2 text-sm leading-6 dark:bg-red-950/30">
          {error}
        </p>
      )}

      <p className="mt-5 flex gap-2 border-l-2 border-emerald-600 pl-4 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
        <ShieldCheck className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        <span>
          No image generation was used. Every exported pixel came from the artwork you supplied,
          moved by the rig you placed, rendered in this browser.
        </span>
      </p>

      <p className="mt-4 flex gap-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
        <Download className="mt-1 h-3.5 w-3.5 shrink-0" />
        <span>
          The project file holds your rig and settings but not the artwork. Reopen it from the first
          step and supply the same image to carry on editing.
        </span>
      </p>
    </section>
  );
}
