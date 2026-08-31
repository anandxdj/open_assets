"use client";

// Clip list, transport and keyframe strip.
//
// Keyframes are draggable on a continuous strip rather than being buttons in a
// frame grid, because a 120-frame clip in a grid gives each frame six pixels and a
// diamond nothing to be grabbed by. The strip is pointer-driven; a range input
// underneath carries the same playhead for keyboard and assistive tech, so the
// visual affordance is not the only affordance.
//
// Editing a keyframe's POSE is not done here. Clicking a diamond parks the
// playhead on it and the inspector edits the channels at that time -- one editing
// surface for "what does this pose look like", whether the user arrived by
// scrubbing or by clicking a key.

import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  CloudOff,
  Check,
  Loader2,
  Lock,
  Pause,
  Play,
  Plus,
  Save,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { ANIBUDDY_LIMITS, EASE_VALUES } from "@/features/anibuddy/rig/index.rig";
import type { Clip, Ease, Keyframe } from "@/features/anibuddy/rig/index.rig";
import { ClipEditor } from "../clip-editor";
import { EditorConstants } from "../editor.constants";
import type { ClipSaveState } from "../use-pipeline-project";

interface ClipTimelineProps {
  clips: readonly Clip[];
  activeClip: Clip | null;
  frame: number;
  playing: boolean;
  autokey: boolean;
  /** Where the active clip stands against the revision the server holds. */
  saveState: ClipSaveState | null;
  /** Clip ids the current revision contains, so the list can mark the rest. */
  savedClipIds: readonly string[];
  onSelectClip: (clipId: string) => void;
  onAddClip: () => void;
  onDeleteClip: (clipId: string) => void;
  onRenameClip: (name: string) => void;
  onSaveClip: () => void;
  onScrub: (frame: number) => void;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onToggleAutokey: () => void;
  onMoveKeyframe: (from: number, to: number) => void;
  onRemoveKeyframe: (t: number) => void;
  onSetEase: (t: number, ease: Ease) => void;
  onSetLoop: (loop: boolean) => void;
  onSetFps: (fps: number) => void;
  onSetFrameCount: (frameCount: number) => void;
}

const FIELD_CLASS =
  "border-2 border-zinc-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-zinc-700";

/**
 * The four save states, as a label and an icon.
 *
 * `stale` carries no label of its own beyond "refused" because the sentence
 * underneath it is the server's, and a second summary in front of that sentence
 * would be this component's opinion of a refusal it did not author (F9 §7.8).
 */
const SAVE_LABEL: Record<ClipSaveState["status"], string> = {
  saved: "Saved on this revision.",
  unsaved: "Not saved. A render samples the saved revision, so save before exporting.",
  saving: "Saving…",
  stale: "The gateway refused this write.",
};

export function ClipTimeline({
  clips,
  activeClip,
  frame,
  playing,
  autokey,
  saveState,
  savedClipIds,
  onSelectClip,
  onAddClip,
  onDeleteClip,
  onRenameClip,
  onSaveClip,
  onScrub,
  onTogglePlay,
  onStep,
  onToggleAutokey,
  onMoveKeyframe,
  onRemoveKeyframe,
  onSetEase,
  onSetLoop,
  onSetFps,
  onSetFrameCount,
}: ClipTimelineProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  // The pointer id belongs in a ref -- it is only ever compared inside a handler.
  // Where the dragged key currently SITS is rendered, so it is state.
  const pointerRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  // A clip with no save state yet reads as unsaved rather than as saved: the
  // optimistic default is the one that tells the user their work is safe when it
  // is not.
  const status = saveState?.status ?? "unsaved";
  const frameCount = activeClip?.frameCount ?? EditorConstants.DEFAULT_FRAME_COUNT;
  const currentTime = activeClip ? ClipEditor.timeOfFrame(frame, frameCount) : 0;
  const currentKey = useMemo(
    () => (activeClip ? ClipEditor.keyframeNear(activeClip, currentTime) : null),
    [activeClip, currentTime],
  );

  // Normalized time from a pointer x, snapped to the clip's frame grid so a drag
  // can only ever land somewhere the playhead can reach.
  const timeFromPointer = useCallback(
    (clientX: number): number => {
      const strip = stripRef.current;
      if (!strip) return 0;
      const rect = strip.getBoundingClientRect();
      const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
      return ClipEditor.quantize(Math.max(0, Math.min(1, ratio)), frameCount);
    },
    [frameCount],
  );

  const onStripPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!activeClip) return;
      onScrub(ClipEditor.frameOfTime(timeFromPointer(event.clientX), frameCount));
    },
    [activeClip, frameCount, onScrub, timeFromPointer],
  );

  const onKeyPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, key: Keyframe) => {
      event.stopPropagation();
      onScrub(ClipEditor.frameOfTime(key.t, frameCount));
      // The key at t = 0 is the clip's rest reference and cannot move (ClipEditor
      // refuses it), so it is not made draggable either.
      if (key.t === 0) return;
      pointerRef.current = event.pointerId;
      setDrag({ from: key.t, to: key.t });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [frameCount, onScrub],
  );

  const onKeyPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (pointerRef.current !== event.pointerId) return;
      const to = timeFromPointer(event.clientX);
      setDrag((current) => (current === null ? null : { from: current.from, to }));
    },
    [timeFromPointer],
  );

  const onKeyPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (pointerRef.current !== event.pointerId || drag === null) return;
      pointerRef.current = null;
      setDrag(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (drag.to !== drag.from) {
        onMoveKeyframe(drag.from, drag.to);
        onScrub(ClipEditor.frameOfTime(drag.to, frameCount));
      }
    },
    [drag, frameCount, onMoveKeyframe, onScrub],
  );

  return (
    <section className="border-2 border-zinc-950 bg-card dark:border-zinc-100">
      <div className="grid gap-0 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="border-b-2 border-zinc-950 p-3 dark:border-zinc-100 lg:border-b-0 lg:border-r-2">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
              Clips
            </h3>
            <button
              type="button"
              onClick={onAddClip}
              className="inline-flex items-center gap-1 border-2 border-zinc-950 px-2 py-1 font-mono text-[10px] font-bold uppercase dark:border-zinc-100"
            >
              <Plus className="h-3 w-3" /> New
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {clips.length === 0 && (
              <li className="font-mono text-[11px] leading-5 text-zinc-500">
                No clips yet. Create one to hand-author a pose, or run the animate stage.
              </li>
            )}
            {clips.map((clip) => {
              const active = clip.id === activeClip?.id;
              const onServer = savedClipIds.includes(clip.id);
              return (
                <li
                  key={clip.id}
                  className={`border-2 p-2 ${active ? "border-fuchsia-700" : "border-zinc-300 dark:border-zinc-700"}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectClip(clip.id)}
                    className="block w-full truncate text-left text-sm font-bold"
                  >
                    {clip.name}
                  </button>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase text-zinc-500">
                    <span>
                      {clip.source} · {clip.keyframes.length} keys
                      {ClipEditor.hasContent(clip) ? "" : " · empty"}
                      {onServer ? "" : " · local"}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteClip(clip.id)}
                      aria-label={`Delete ${clip.name}`}
                      className="text-zinc-500 hover:text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="p-3">
          {!activeClip ? (
            <p className="border-2 border-dashed border-zinc-300 p-8 text-center font-mono text-xs text-zinc-500 dark:border-zinc-700">
              Select or create a clip to pose it.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="inline-flex items-center gap-2 border-2 border-zinc-950 px-3 py-1.5 font-mono text-[11px] font-bold uppercase dark:border-zinc-100"
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={() => onStep(-1)}
                  aria-label="Previous frame"
                  className="border-2 border-zinc-300 px-2 py-1.5 dark:border-zinc-700"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onStep(1)}
                  aria-label="Next frame"
                  className="border-2 border-zinc-300 px-2 py-1.5 dark:border-zinc-700"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </button>
                <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                  {frame + 1} / {frameCount}
                </span>

                <label className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                  <input type="checkbox" checked={autokey} onChange={onToggleAutokey} />
                  Autokey
                </label>
                <label className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                  <input
                    type="checkbox"
                    checked={activeClip.loop}
                    onChange={(event) => onSetLoop(event.target.checked)}
                  />
                  Loop
                </label>

                {/*
                  Enabled in every state except a request already in flight. The
                  gateway is the only thing that knows whether this write can land —
                  it refuses while a stage is writing its own revision of the same
                  document, and it refuses a clip naming ids the revision no longer
                  has — so pressing it is how the user learns which, in the server's
                  own words.
                */}
                <button
                  type="button"
                  disabled={status === "saving"}
                  onClick={onSaveClip}
                  className={`inline-flex items-center gap-1 border-2 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] disabled:opacity-40 ${
                    status === "saved"
                      ? "border-zinc-300 text-zinc-500 dark:border-zinc-700"
                      : "border-zinc-950 dark:border-zinc-100"
                  }`}
                >
                  {status === "saving" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : status === "saved" ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : status === "stale" ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  {status === "saved" ? "Saved" : "Save clip"}
                </button>
              </div>

              <p
                className={`mt-2 flex items-start gap-2 font-mono text-[11px] leading-5 ${
                  status === "stale"
                    ? "border-2 border-red-500 bg-red-50 p-2 text-zinc-900 dark:bg-red-950/30 dark:text-red-100"
                    : "text-zinc-500"
                }`}
              >
                {status === "unsaved" && <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                {/*
                  The refusal is printed verbatim. It is a sentence the gateway wrote
                  against the document it actually holds -- which stage is running, or
                  which ids no longer resolve -- and paraphrasing it here would replace
                  what happened with a guess about it.
                */}
                <span>{saveState?.message ?? SAVE_LABEL[status]}</span>
              </p>

              <div
                ref={stripRef}
                onPointerDown={onStripPointerDown}
                className="relative mt-3 h-12 touch-none border-2 border-zinc-950 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
              >
                <div
                  className="absolute top-0 h-full w-0.5 bg-fuchsia-700"
                  style={{ left: `${currentTime * 100}%` }}
                />
                {activeClip.keyframes.map((key) => {
                  const time = drag !== null && drag.from === key.t ? drag.to : key.t;
                  const selected = currentKey?.t === key.t;
                  return (
                    <button
                      key={`${key.t}`}
                      type="button"
                      onPointerDown={(event) => onKeyPointerDown(event, key)}
                      onPointerMove={onKeyPointerMove}
                      onPointerUp={onKeyPointerUp}
                      onPointerCancel={onKeyPointerUp}
                      title={`Keyframe at ${(key.t * 100).toFixed(0)}% · ${key.ease}`}
                      aria-label={`Keyframe at frame ${ClipEditor.frameOfTime(key.t, frameCount) + 1}`}
                      className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 touch-none border-2"
                      style={{
                        left: `${time * 100}%`,
                        borderColor: selected ? "#c026d3" : "#18181b",
                        backgroundColor: key.t === 0 ? "#18181b" : selected ? "#c026d3" : "#fafafa",
                        cursor: key.t === 0 ? "default" : "grab",
                      }}
                    />
                  );
                })}
              </div>

              <label className="mt-2 block">
                <span className="sr-only">Playhead</span>
                <input
                  type="range"
                  min={0}
                  max={frameCount - 1}
                  step={1}
                  value={frame}
                  onChange={(event) => onScrub(Number(event.target.value))}
                  className="w-full"
                />
              </label>

              <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px]">
                <label className="inline-flex items-center gap-2">
                  Name
                  <input
                    value={activeClip.name}
                    onChange={(event) => onRenameClip(event.target.value)}
                    maxLength={80}
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="inline-flex items-center gap-2">
                  fps
                  <select
                    value={activeClip.fps}
                    onChange={(event) => onSetFps(Number(event.target.value))}
                    className={FIELD_CLASS}
                  >
                    {EditorConstants.FPS_CHOICES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex items-center gap-2">
                  Frames
                  <input
                    type="number"
                    min={EditorConstants.MIN_FRAMES}
                    max={ANIBUDDY_LIMITS.MAX_FRAMES}
                    value={activeClip.frameCount}
                    onChange={(event) => onSetFrameCount(Number(event.target.value))}
                    className={`${FIELD_CLASS} w-20`}
                  />
                </label>

                {currentKey ? (
                  <>
                    <label className="inline-flex items-center gap-2">
                      Ease out of key
                      <select
                        value={currentKey.ease}
                        onChange={(event) => onSetEase(currentKey.t, event.target.value as Ease)}
                        className={FIELD_CLASS}
                      >
                        {EASE_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={!ClipEditor.canRemove(activeClip, currentKey.t)}
                      onClick={() => onRemoveKeyframe(currentKey.t)}
                      title={
                        ClipEditor.canRemove(activeClip, currentKey.t)
                          ? "Delete this keyframe"
                          : "The key at frame 1 is the clip's rest reference and cannot be deleted."
                      }
                      className="inline-flex items-center gap-1 border-2 border-zinc-300 px-2 py-1 font-bold uppercase tracking-[0.12em] disabled:opacity-40 dark:border-zinc-700"
                    >
                      <Trash2 className="h-3 w-3" /> Delete key
                    </button>
                  </>
                ) : activeClip.keyframes.length >= ANIBUDDY_LIMITS.MAX_KEYFRAMES ? (
                  <span className="text-amber-700 dark:text-amber-300">
                    This clip is at the {ANIBUDDY_LIMITS.MAX_KEYFRAMES}-keyframe limit, so posing
                    here cannot create a new one. Edit an existing key instead.
                  </span>
                ) : (
                  <span className="text-zinc-500">
                    No keyframe on this frame.{" "}
                    {autokey
                      ? "Posing here will create one."
                      : "Posing here previews only; turn autokey on to record it."}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
