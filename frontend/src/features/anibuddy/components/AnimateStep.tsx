"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  FPS_OPTIONS,
  MAX_FRAMES,
  type Fps,
  type MotionId,
  type PreparedAsset,
  type Rig,
} from "@/features/anibuddy/types";
import { loadImageElement } from "@/features/anibuddy/lib/raster";
import { createDeformer, STRETCH_WARNING } from "@/features/anibuddy/lib/deform";
import { MOTION_META, getFramePoses, referencePose } from "@/features/anibuddy/lib/motion";

const MOTION_ORDER: MotionId[] = ["idle", "bounce", "wave", "blink"];
const MAX_PREVIEW_EDGE = 420;

interface AnimateStepProps {
  prepared: PreparedAsset;
  rig: Rig;
  motion: MotionId | null;
  fps: Fps;
  frameCount: number;
  onMotion: (motion: MotionId | null) => void;
  onFps: (fps: Fps) => void;
  onFrameCount: (frameCount: number) => void;
  onContinue: () => void;
}

export function AnimateStep({
  prepared,
  rig,
  motion,
  fps,
  frameCount,
  onMotion,
  onFps,
  onFrameCount,
  onContinue,
}: AnimateStepProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [showDistortion, setShowDistortion] = useState(false);
  const [worstStretch, setWorstStretch] = useState(1);
  const [flipped, setFlipped] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadImageElement(prepared.dataUrl).then((loaded) => {
      if (!cancelled) setImage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [prepared.dataUrl]);

  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(prepared.width, prepared.height));
  const previewWidth = Math.round(prepared.width * scale);
  const previewHeight = Math.round(prepared.height * scale);

  const deformer = useMemo(
    () => (image ? createDeformer(rig, prepared, image) : null),
    [image, rig, prepared],
  );

  const frames = useMemo(
    () => (motion ? getFramePoses(rig.bodyPlan, motion, frameCount) : null),
    [motion, rig.bodyPlan, frameCount],
  );

  const reference = useMemo(
    () => (motion ? referencePose(rig.bodyPlan, motion) : null),
    [motion, rig.bodyPlan],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !deformer || !frames || !reference) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let index = 0;
    let last = 0;
    const interval = 1000 / fps;

    // Accumulated per effect run, not in state: the worst stretch belongs to the
    // motion currently on screen, so it has to start over whenever the thing
    // being measured changes — which is exactly when this effect re-runs.
    let worst = 1;
    let folds = 0;

    // A single render pass whether or not the loop is running, so pausing shows
    // the current frame rather than a blank canvas.
    const draw = () => {
      const stats = deformer.render(ctx, frames[index], reference, {
        width: previewWidth,
        height: previewHeight,
        showDistortion,
      });
      worst = Math.max(worst, stats.maxStretch);
      folds = Math.max(folds, stats.flippedTriangles);
      // Publishing unconditionally is what clears a stale warning from the
      // previous template. React bails out when the value is unchanged, so the
      // steady state costs no re-render.
      setWorstStretch(worst);
      setFlipped(folds);
    };

    if (!playing) {
      draw();
      return;
    }

    const tick = (time: number) => {
      if (time - last >= interval) {
        last = time;
        draw();
        index = (index + 1) % frames.length;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [deformer, frames, reference, fps, playing, previewWidth, previewHeight, showDistortion]);

  const chooseMotion = useCallback(
    (candidate: MotionId) => {
      onMotion(motion === candidate ? null : candidate);
    },
    [motion, onMotion],
  );

  const distorted = worstStretch > STRETCH_WARNING || flipped > 0;

  return (
    <section className="border-2 border-zinc-950 bg-card text-card-foreground p-5 dark:border-zinc-100 sm:p-7">
      <div className="mb-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          04 / motion
        </p>
        <h2 className="mt-1 text-xl font-black uppercase tracking-tight">Pick a motion and watch it move</h2>
      </div>

      <p className="max-w-2xl text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        Select a motion preset to preview interactive 2D character animation loops.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {MOTION_ORDER.map((candidate) => {
          const available = rig.supported.includes(candidate);
          const meta = MOTION_META[candidate];
          const selected = motion === candidate;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => chooseMotion(candidate)}
              disabled={!available}
              aria-pressed={selected}
              className={cn(
                "border-2 p-4 text-left transition-colors",
                selected
                  ? "border-fuchsia-700 bg-fuchsia-50 dark:bg-fuchsia-950/30"
                  : "border-zinc-300 dark:border-zinc-700",
                available
                  ? "hover:border-zinc-950 dark:hover:border-zinc-100"
                  : "cursor-not-allowed opacity-45",
              )}
            >
              <span className="font-mono text-xs font-bold uppercase tracking-wider">
                {meta.label}
              </span>
              <span className="mt-1 block text-sm leading-5 text-zinc-600 dark:text-zinc-300">
                {available ? meta.blurb : "Unavailable for this artwork — see the notes below."}
              </span>
            </button>
          );
        })}
      </div>

      {rig.warnings.length > 0 && (
        <ul className="mt-4 space-y-2 border-l-2 border-amber-500 pl-4">
          {rig.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
              <TriangleAlert className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-600" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {motion && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="justify-self-center border border-zinc-300 dark:border-zinc-700">
            <canvas
              ref={canvasRef}
              width={previewWidth}
              height={previewHeight}
              className="block"
              aria-label={`${MOTION_META[motion].label} preview`}
            />
          </div>

          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setPlaying((current) => !current)}
              className="flex w-full items-center gap-2 border-2 border-zinc-950 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider dark:border-zinc-100"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? "Pause" : "Play"}
            </button>

            <div>
              <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Frames per second
              </p>
              <div className="flex gap-2">
                {FPS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onFps(option)}
                    aria-pressed={fps === option}
                    className={cn(
                      "flex-1 border px-2 py-1.5 font-mono text-xs font-bold",
                      fps === option
                        ? "border-fuchsia-700 bg-fuchsia-700 text-white"
                        : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="anibuddy-frames"
                className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500"
              >
                Frames · {frameCount}
              </label>
              <input
                id="anibuddy-frames"
                type="range"
                min={4}
                max={MAX_FRAMES}
                step={1}
                value={frameCount}
                onChange={(event) => onFrameCount(Number(event.target.value))}
                className="w-full accent-fuchsia-700"
              />
              <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                More frames make the loop smoother and the export larger.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowDistortion((current) => !current)}
              aria-pressed={showDistortion}
              className={cn(
                "w-full border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider",
                showDistortion
                  ? "border-red-600 text-red-700 dark:text-red-300"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
              )}
            >
              {showDistortion ? "Hide stretch overlay" : "Show stretch overlay"}
            </button>

            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Worst stretch ×{worstStretch.toFixed(1)}
            </p>
          </div>
        </div>
      )}

      {motion && distorted && (
        <p className="mt-5 flex gap-2 border border-amber-500 bg-amber-50 px-3 py-2 text-sm leading-6 dark:bg-amber-950/25">
          <TriangleAlert className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            Parts of the artwork stretch{" "}
            {flipped > 0 ? "and fold over themselves" : `up to ${worstStretch.toFixed(1)}×`} in this
            motion. Turn on the stretch overlay to see where, then move the nearby joints onto the
            body part they belong to, or choose a smaller motion.
          </span>
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-700">
        <button
          type="button"
          onClick={onContinue}
          disabled={!motion}
          className="bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue to export
        </button>
        {!motion && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Choose a motion first
          </span>
        )}
      </div>
    </section>
  );
}
