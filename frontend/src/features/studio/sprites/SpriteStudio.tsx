"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Sprite Studio UI: body-plan + animation pickers, live player, 4×2 frame
// grid with per-frame exclude, character upload/starter rail.

import { useEffect, useRef, useState } from "react";
import {
  Download,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ART_STYLE_GROUPS } from "@/features/studio/lib/artStyles";
import {
  SPRITE_ANIMATIONS,
  SPRITE_FRAME_COUNT,
  SPRITE_SHEET_H,
  SPRITE_SHEET_W,
} from "@/features/studio/lib/sprite";
import type { SpriteAnimType, SpriteFrame, SpriteSheet } from "@/features/studio/lib/sprite";
import { BODY_PLANS, BODY_PLAN_ORDER } from "@/features/studio/lib/bodyPlans";
import type { BodyPlan } from "@/features/studio/lib/bodyPlans";

const CHECKER =
  "bg-[repeating-conic-gradient(#80808033_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]";

const chip = (active: boolean, busy: boolean) =>
  cn(
    "inline-flex items-center gap-1.5 border px-3 py-1 text-[11px] font-bold uppercase transition-colors rounded-none",
    active
      ? "border-zinc-950 dark:border-white bg-zinc-950 text-white dark:bg-white dark:text-black"
      : "border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:border-zinc-500 hover:text-foreground",
    busy && "opacity-50 cursor-not-allowed",
  );

const ghostBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 disabled:opacity-40 rounded-none";

export function SpriteAnimationPlayer({
  frames,
  fps,
  loop,
  playing,
  setPlaying,
  anchorImageUrl,
  anchorUploaded,
}: {
  frames: SpriteFrame[];
  fps: number;
  loop: boolean;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  anchorImageUrl?: string | null;
  anchorUploaded?: boolean;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const populated = frames.filter((f) => !!f.imageUrl && !f.disabled);
  const hasFrames = populated.length > 0;
  const frameCount = populated.length;

  // setInterval + functional setState: a rAF version captured stale state and
  // froze after one frame. One-shot anims stop at the last frame.
  useEffect(() => {
    if (!playing || !hasFrames) return;
    const intervalMs = Math.max(1, Math.round(1000 / Math.max(1, fps)));
    let stopped = false;
    const id = window.setInterval(() => {
      if (stopped) return;
      setCurrentIdx((prev) => {
        const next = prev + 1;
        if (next >= frameCount) {
          if (loop) return 0;
          stopped = true;
          window.clearInterval(id);
          queueMicrotask(() => setPlaying(false));
          return frameCount - 1;
        }
        return next;
      });
    }, intervalMs);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [playing, fps, loop, frameCount, hasFrames, setPlaying]);

  // Rewind when a new generation arrives.
  const populatedKey = frameCount;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional playhead reset on new sheet
    setCurrentIdx(0);
  }, [populatedKey]);

  const handleTogglePlay = () => {
    if (!playing && !loop && hasFrames && currentIdx >= frameCount - 1) {
      setCurrentIdx(0);
    }
    setPlaying(!playing);
  };

  const activeFrame = populated[currentIdx] ?? populated[0] ?? null;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        <span>Live playback</span>
        <span className="font-mono normal-case tracking-normal">
          {hasFrames ? `Frame ${currentIdx + 1}/${populated.length} · ${fps} FPS` : "No frames yet"}
        </span>
      </div>

      <div
        className={cn(
          "relative flex aspect-square w-full items-center justify-center overflow-hidden border-2 border-zinc-950 dark:border-zinc-700 bg-gradient-to-b from-sky-300/15 to-blue-900/25",
          CHECKER,
        )}
      >
        {activeFrame?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activeFrame.imageUrl}
            alt={`Frame ${activeFrame.index + 1}`}
            draggable={false}
            className="h-full w-full object-contain [image-rendering:pixelated]"
          />
        ) : anchorImageUrl ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={anchorImageUrl}
              alt="Locked character"
              draggable={false}
              className="max-h-[62%] max-w-[62%] object-contain [image-rendering:pixelated] drop-shadow-xl"
            />
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="bg-zinc-950 text-white dark:bg-white dark:text-black px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                {anchorUploaded ? "Uploaded character" : "Character ready"}
              </span>
              <span className="text-[11px] uppercase text-muted-foreground">
                Pick an animation and hit generate to bring it to life
              </span>
            </div>
          </div>
        ) : (
          <div className="text-[11px] uppercase text-muted-foreground">
            Generate a sheet to see the animation play
          </div>
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleTogglePlay}
          disabled={!hasFrames}
          className="flex h-7 w-7 items-center justify-center border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground disabled:opacity-40"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, populated.length - 1)}
          value={Math.min(currentIdx, Math.max(0, populated.length - 1))}
          onChange={(e) => {
            setPlaying(false);
            setCurrentIdx(Number(e.target.value));
          }}
          disabled={!hasFrames}
          className="flex-1"
          aria-label="Scrub frame"
        />
      </div>
    </div>
  );
}

export function SpriteFrameCell({
  frame,
  loading,
  onToggle,
}: {
  frame: SpriteFrame;
  loading?: boolean;
  onToggle?: (index: number) => void;
}) {
  const hasImage = !!frame.imageUrl;
  const disabled = !!frame.disabled;
  const interactive = hasImage && !!onToggle && !loading;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onToggle!(frame.index) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle!(frame.index);
              }
            }
          : undefined
      }
      className={cn(
        "group relative aspect-square overflow-hidden border rounded-none",
        CHECKER,
        disabled
          ? "border-destructive"
          : "border-zinc-300 dark:border-zinc-700",
        interactive && "cursor-pointer",
      )}
      title={
        interactive
          ? disabled
            ? `Frame ${frame.index + 1} — excluded · click to include`
            : `Frame ${frame.index + 1} — click to exclude from animation & exports`
          : `Frame ${frame.index + 1}`
      }
    >
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame.imageUrl as string}
          alt={`Frame ${frame.index + 1}`}
          draggable={false}
          className={cn(
            "block h-full w-full object-contain [image-rendering:pixelated] transition-all",
            disabled && "opacity-25 grayscale",
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-muted-foreground">
          {frame.index + 1}
        </div>
      )}

      {loading && !hasImage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <Loader2 size={16} className="animate-spin text-white" />
        </div>
      )}

      {disabled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-destructive/10">
          <span className="bg-destructive px-1.5 py-px font-mono text-[8px] font-black uppercase tracking-wider text-white">
            Excluded
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute left-1 top-1 bg-black/55 px-1 py-px font-mono text-[8px] text-white backdrop-blur">
        {frame.index + 1}
      </div>

      {interactive && (
        <div
          className={cn(
            "pointer-events-none absolute right-1 top-1 bg-black/55 p-0.5 text-white backdrop-blur transition-opacity",
            disabled ? "opacity-100 text-destructive" : "opacity-0 group-hover:opacity-100",
          )}
        >
          {disabled ? <EyeOff size={12} /> : <Eye size={12} />}
        </div>
      )}
    </div>
  );
}

export function SpriteStudio({
  sheet,
  anchor,
  bodyPlan,
  setBodyPlan,
  selectedAnim,
  setSelectedAnim,
  generatedAnims,
  prompt,
  setPrompt,
  fps,
  setFps,
  artStyle,
  setArtStyle,
  generating,
  progressMessage,
  onGenerate,
  onRerollCharacter,
  onUploadCharacter,
  onRemoveUploadedCharacter,
  onStop,
  onClear,
  onDownloadSheet,
  onDownloadZip,
  onToggleFrame,
}: {
  sheet: SpriteSheet;
  anchor: { imageUrl: string; rawImageUrl: string; prompt: string; uploaded?: boolean } | null;
  bodyPlan: BodyPlan;
  setBodyPlan: (v: BodyPlan) => void;
  selectedAnim: SpriteAnimType;
  setSelectedAnim: (v: SpriteAnimType) => void;
  generatedAnims: Set<SpriteAnimType>;
  prompt: string;
  setPrompt: (v: string) => void;
  fps: number;
  setFps: (v: number) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  generating: boolean;
  progressMessage?: string | null;
  onGenerate: () => void;
  onRerollCharacter: () => void;
  onUploadCharacter: (file: File) => void;
  onRemoveUploadedCharacter: () => void;
  onStop: () => void;
  onClear: () => void;
  onDownloadSheet: () => void;
  onDownloadZip: () => void;
  onToggleFrame: (index: number) => void;
}) {
  const [playing, setPlaying] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const spec = SPRITE_ANIMATIONS[selectedAnim];
  const filledCount = sheet.frames.filter((f) => !!f.imageUrl).length;
  const activeCount = sheet.frames.filter((f) => !!f.imageUrl && !f.disabled).length;
  const excludedCount = filledCount - activeCount;
  const hasAny = filledCount > 0;
  const canGenerate = !!prompt.trim() || !!anchor?.uploaded;

  // Auto-resume playback whenever a fresh generation arrives.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional auto-play on new sheet
    if (hasAny) setPlaying(true);
  }, [hasAny, sheet.anim, sheet.gridSheetUrl]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3 font-mono sm:px-6">
      <div className="flex items-center justify-center gap-2 text-[11px] uppercase">
        <Play size={12} />
        <span className="text-muted-foreground">
          Sprite mode — pick a body plan, then an animation. Pass 1 locks a character anchor;
          Pass 2 paints all 8 keyframes onto a deterministic pose map.
        </span>
      </div>

      {/* Body plan */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Body plan
        </span>
        {BODY_PLAN_ORDER.map((planId) => {
          const plan = BODY_PLANS[planId];
          return (
            <button
              key={planId}
              type="button"
              onClick={() => setBodyPlan(planId)}
              disabled={generating}
              className={chip(bodyPlan === planId, generating)}
              title={plan.hint}
            >
              {plan.label}
            </button>
          );
        })}
      </div>

      {/* Animation picker */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {BODY_PLANS[bodyPlan].anims.map((animType) => {
          const animSpec = SPRITE_ANIMATIONS[animType];
          const active = selectedAnim === animType;
          const hasSaved = generatedAnims.has(animType) && !active;
          return (
            <button
              key={animType}
              type="button"
              onClick={() => setSelectedAnim(animType)}
              disabled={generating}
              className={chip(active, generating)}
              title={hasSaved ? `${animSpec.hint} · saved animation — click to view` : animSpec.hint}
            >
              {animSpec.label}
              {hasSaved && (
                <span className="inline-block h-1.5 w-1.5 bg-current" aria-label="has saved animation" />
              )}
            </button>
          );
        })}
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
            onClick={onGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center gap-1.5 bg-zinc-950 text-white dark:bg-white dark:text-black border border-zinc-950 dark:border-white px-3 py-1.5 text-[11px] font-black uppercase rounded-none disabled:opacity-40 hover:bg-transparent hover:text-zinc-950 dark:hover:bg-transparent dark:hover:text-white transition-colors"
            title={
              anchor
                ? `Generate the ${spec.label.toLowerCase()} sheet for the existing character (skips the anchor pass)`
                : `Two-pass generation: lock character (Pass 1) + paint ${spec.label.toLowerCase()} sheet (Pass 2)`
            }
          >
            <Sparkles size={14} />
            {anchor
              ? hasAny
                ? `Re-roll ${spec.label.toLowerCase()}`
                : `Generate ${spec.label.toLowerCase()}`
              : `Lock character + ${spec.label.toLowerCase()}`}
          </button>
        )}
        {anchor && !generating && (
          <button
            onClick={onRerollCharacter}
            disabled={!prompt.trim()}
            className={ghostBtn}
            title="Discard the current character and re-roll a fresh anchor + sheet"
          >
            <RefreshCw size={14} />
            Re-roll character
          </button>
        )}
        <button
          onClick={onDownloadSheet}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Export grid sheet + horizontal strip + JSON manifest"
        >
          <Download size={14} />
          Sheets + manifest
        </button>
        <button
          onClick={onDownloadZip}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Export individual frame PNGs + grid sheet + strip + manifest as a ZIP"
        >
          <Layers size={14} />
          ZIP
        </button>
        <button
          onClick={onClear}
          disabled={(!hasAny && !anchor) || generating}
          className={ghostBtn}
          title="Clear frames, character anchor, and prompt"
        >
          <Trash2 size={14} />
          Clear
        </button>
        <div className="border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {filledCount}/{SPRITE_FRAME_COUNT} frames
          {progressMessage ? ` · ${progressMessage}` : ""}
        </div>
      </div>

      {/* Player + frame grid */}
      <div className="grid w-full flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <SpriteAnimationPlayer
            frames={sheet.frames}
            fps={fps}
            loop={spec.loop}
            playing={playing}
            setPlaying={setPlaying}
            anchorImageUrl={anchor?.imageUrl ?? null}
            anchorUploaded={anchor?.uploaded}
          />
          <div className="flex items-center gap-2 border border-zinc-300 dark:border-zinc-700 px-3 py-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              FPS
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="flex-1"
              aria-label="Playback FPS"
            />
            <span className="w-9 text-right font-mono text-[12px] text-muted-foreground">{fps}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <span>Frame sheet (4×2)</span>
            <span className="font-mono normal-case tracking-normal">
              {SPRITE_SHEET_W}×{SPRITE_SHEET_H} export
            </span>
          </div>
          <div
            className="grid w-full gap-1.5"
            style={{ gridTemplateColumns: `repeat(${SPRITE_FRAME_COUNT}, 1fr)` }}
          >
            {sheet.frames.map((frame, i) => (
              <SpriteFrameCell
                key={i}
                frame={frame}
                loading={generating && !frame.imageUrl}
                onToggle={onToggleFrame}
              />
            ))}
          </div>
          <div className="text-[10px] uppercase text-muted-foreground">
            Click a frame to exclude it from the animation and all exports.
            {excludedCount > 0 && (
              <span className="text-destructive">
                {" "}
                {excludedCount} excluded · {activeCount} active.
              </span>
            )}{" "}
            Row-major order: top-left is frame 1.
          </div>

          {/* Character rail */}
          <div className="mt-1 flex w-full flex-col gap-2">
            <div className="flex flex-col gap-2.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Character
              </label>

              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadCharacter(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => !generating && uploadInputRef.current?.click()}
                disabled={generating}
                onDragOver={(e) => {
                  if (generating) return;
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (generating) return;
                  const file = e.dataTransfer.files?.[0];
                  if (file) onUploadCharacter(file);
                }}
                className={cn(
                  "group flex w-full items-center gap-3 border-2 border-dashed px-3.5 py-3 text-left transition-colors rounded-none disabled:opacity-50",
                  dragOver
                    ? "border-zinc-950 dark:border-white bg-zinc-100 dark:bg-zinc-900"
                    : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-500",
                )}
                title="Upload your own character image and animate it instead of generating one"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center border-2 border-zinc-950 dark:border-zinc-700">
                  <Upload size={15} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12px] font-bold uppercase">
                    {anchor?.uploaded ? "Replace uploaded character" : "Upload your own character"}
                  </span>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Drag &amp; drop or click · transparent PNG works best
                  </span>
                </span>
              </button>

              {anchor?.uploaded && (
                <button
                  type="button"
                  onClick={onRemoveUploadedCharacter}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 self-start border border-destructive px-2.5 py-1 text-[10px] font-bold uppercase text-destructive rounded-none disabled:opacity-50"
                  title="Remove the uploaded character and use a prompt instead"
                >
                  <Trash2 size={12} />
                  Remove uploaded character
                </button>
              )}

              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  or pick a starter
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {BODY_PLANS[bodyPlan].presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPrompt(preset.prompt)}
                    disabled={generating}
                    className={chip(prompt.trim() === preset.prompt, generating)}
                    title={preset.prompt}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex w-full items-stretch gap-2 border-2 border-zinc-950 dark:border-zinc-700 bg-background p-1.5">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={generating}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canGenerate && !generating) {
                    e.preventDefault();
                    onGenerate();
                  }
                }}
                placeholder={
                  anchor?.uploaded
                    ? "Optional: describe the character to refine results"
                    : "Describe the character — or pick a starter above"
                }
                className="flex-1 bg-transparent px-3 py-2.5 text-[13px] focus:outline-none"
              />
              <div className="hidden items-center border-l border-border sm:flex">
                <select
                  value={artStyle}
                  onChange={(e) => setArtStyle(e.target.value)}
                  disabled={generating}
                  className="cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[12px] uppercase font-bold text-muted-foreground focus:outline-none"
                  title="Art style for the sprite"
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
      </div>
    </div>
  );
}
