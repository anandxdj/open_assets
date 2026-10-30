"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Sprite Studio: form panel (body plan, character, art style, animation,
// advanced) and results (run header, live player, 4 × 2 frame grid with
// per-frame skip, earlier runs for the current body plan).

import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileArchive,
  LoaderCircle,
  Lock,
  LockOpen,
  Pause,
  PersonStanding,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Range } from "@/components/ui/controls";
import { Checker, EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { findStyleLabel } from "@/features/studio/lib/artStyles";
import { MODELS, getModelConfig } from "@/features/studio/lib/models";
import {
  SPRITE_ANIMATIONS,
  SPRITE_FRAME_COUNT,
  SPRITE_FRAME_SIZE,
  SPRITE_GRID_COLS,
  SPRITE_GRID_ROWS,
} from "@/features/studio/lib/sprite";
import type { SpriteAnimType, SpriteFrame, SpriteSheet } from "@/features/studio/lib/sprite";
import { BODY_PLANS, BODY_PLAN_ORDER } from "@/features/studio/lib/bodyPlans";
import type { BodyPlan } from "@/features/studio/lib/bodyPlans";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import {
  ChipGroup,
  GeneratorLayout,
  PanelSection,
  RunFooter,
  RunHeader,
  ToggleChip,
  formatSeconds,
  useRunHint,
} from "@/features/studio/components/GeneratorLayout";
import {
  ArtStyleField,
  PresetSelect,
  PromptField,
  matchPreset,
} from "@/features/studio/components/fields";

const FPS_MIN = 1;
const FPS_MAX = 30;

export function SpriteAnimationPlayer({
  frames,
  fps,
  setFps,
  loop,
  playing,
  setPlaying,
  anchorImageUrl,
  anchorUploaded,
}: {
  frames: SpriteFrame[];
  fps: number;
  setFps: (v: number) => void;
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
  const fpsId = useId();

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

  const shownIdx = Math.min(currentIdx, Math.max(0, frameCount - 1));
  const activeFrame = populated[shownIdx] ?? populated[0] ?? null;

  return (
    <section
      aria-label="Animation preview"
      className="flex min-w-0 flex-[1_1_260px] flex-col border-[1.5px] border-line bg-surface sm:max-w-[300px]"
    >
      <Checker className="flex aspect-square w-full items-center justify-center overflow-hidden">
        {activeFrame?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activeFrame.imageUrl}
            alt={`Frame ${activeFrame.index + 1}`}
            draggable={false}
            className="h-full w-full object-contain [image-rendering:pixelated]"
          />
        ) : anchorImageUrl ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-5 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={anchorImageUrl}
              alt={anchorUploaded ? "Uploaded character" : "Locked character"}
              draggable={false}
              className="max-h-[58%] max-w-[58%] object-contain [image-rendering:pixelated]"
            />
            <Badge className="bg-surface">{anchorUploaded ? "Uploaded character" : "Character ready"}</Badge>
            <p className="bg-surface px-1 text-xs leading-[18px] text-ink-2">
              Pick an animation and generate to bring it to life.
            </p>
          </div>
        ) : (
          <p className="bg-surface px-2 text-center text-xs leading-[18px] text-ink-2">
            Generate a sheet to see the animation play.
          </p>
        )}
      </Checker>

      <div className="flex items-center gap-2 border-t-[1.5px] border-line px-2.5 py-2">
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={handleTogglePlay}
          disabled={!hasFrames}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Range
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={shownIdx}
          onChange={(e) => {
            setPlaying(false);
            setCurrentIdx(Number(e.target.value));
          }}
          disabled={!hasFrames}
          aria-label="Scrub frames"
          aria-valuetext={hasFrames ? `Frame ${shownIdx + 1} of ${frameCount}` : "No frames"}
          className="min-w-0 flex-1"
        />
        <label htmlFor={fpsId} className="oa-unit-input w-[72px] flex-none focus-within:shadow-[4px_4px_0_var(--oa-accent)]">
          <input
            id={fpsId}
            type="number"
            inputMode="numeric"
            min={FPS_MIN}
            max={FPS_MAX}
            value={fps}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (!Number.isFinite(n) || e.target.value === "") return;
              setFps(Math.min(FPS_MAX, Math.max(FPS_MIN, n)));
            }}
            aria-label="Playback speed, frames per second"
            className="tabular-nums"
          />
          <span aria-hidden>fps</span>
        </label>
      </div>
    </section>
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
  const n = frame.index + 1;
  const hasImage = !!frame.imageUrl;
  const skipped = !!frame.disabled;
  const interactive = hasImage && !!onToggle && !loading;
  return (
    <li className="oa-checker relative flex aspect-square items-center justify-center">
      {hasImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame.imageUrl as string}
          alt={interactive ? "" : `Frame ${n}`}
          draggable={false}
          className={cn(
            "block h-full w-full object-contain [image-rendering:pixelated]",
            skipped && "opacity-30"
          )}
        />
      )}
      {interactive && (
        <button
          type="button"
          onClick={() => onToggle!(frame.index)}
          aria-pressed={skipped}
          aria-label={`Skip frame ${n}`}
          title={skipped ? `Frame ${n} is skipped. Click to include it.` : `Click to skip frame ${n}`}
          className="absolute inset-0 cursor-pointer hover:bg-hover/40 focus-visible:outline-offset-[-3px]"
        />
      )}
      {loading && !hasImage && <LoaderCircle aria-hidden className="size-4 animate-spin text-ink-3" />}
      <span aria-hidden className="pointer-events-none absolute left-1.5 top-1.5 text-[11px] leading-none text-ink-2">
        {n}
      </span>
      {skipped && (
        <Badge aria-hidden className="pointer-events-none absolute right-1.5 top-1.5 bg-surface">
          Skipped
        </Badge>
      )}
    </li>
  );
}

/** "Serpent / Fish" → "Serpent" for the compact body-plan grid. */
function shortPlanLabel(label: string) {
  return label.split(" / ")[0];
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
  const { selectedModel, setSelectedModel } = useStudioSettings();
  const [playing, setPlaying] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const ids = { preset: useId(), model: useId(), advanced: useId(), run: useId(), earlier: useId() };

  const plan = BODY_PLANS[bodyPlan];
  const spec = SPRITE_ANIMATIONS[selectedAnim];
  const animLabel = spec.label.toLowerCase();
  const filledCount = sheet.frames.filter((f) => !!f.imageUrl).length;
  const activeCount = sheet.frames.filter((f) => !!f.imageUrl && !f.disabled).length;
  const skippedCount = filledCount - activeCount;
  const hasAny = filledCount > 0;
  const canGenerate = !!prompt.trim() || !!anchor?.uploaded;
  const showRun = hasAny || !!anchor || generating;
  const model = getModelConfig(selectedModel);
  // No anchor yet: pass 1 locks the character, pass 2 paints the sheet.
  const runHint = useRunHint(anchor ? 1 : 2);

  const preset = matchPreset(plan.presets, prompt);
  const characterName = anchor?.uploaded
    ? "Uploaded character"
    : (preset?.label ?? (prompt.trim() ? "Custom character" : "Character"));
  const earlierAnims = plan.anims.filter((a) => a !== selectedAnim && generatedAnims.has(a));

  // Auto-resume playback whenever a fresh generation arrives.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional auto-play on new sheet
    if (hasAny) setPlaying(true);
  }, [hasAny, sheet.anim, sheet.gridSheetUrl]);

  const form = (
    <>
      <PanelSection>
        <ChipGroup label="Body plan" className="grid grid-cols-3">
          {BODY_PLAN_ORDER.map((planId) => {
            const p = BODY_PLANS[planId];
            return (
              <ToggleChip
                key={planId}
                pressed={bodyPlan === planId}
                onClick={() => setBodyPlan(planId)}
                disabled={generating}
                title={p.hint}
                className="px-1.5"
              >
                {shortPlanLabel(p.label)}
              </ToggleChip>
            );
          })}
        </ChipGroup>
      </PanelSection>

      <PanelSection>
        <div className="oa-field">
          <span className="oa-field-label">
            <label htmlFor={ids.preset}>Character</label>
          </span>
          <div
            className={cn("-m-1 flex items-center gap-2.5 p-1", dragOver && "bg-brand-soft")}
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
          >
            <Checker className="flex size-14 flex-none items-center justify-center border border-line">
              {anchor ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={anchor.imageUrl}
                  alt={anchor.uploaded ? "Uploaded character" : "Locked character"}
                  draggable={false}
                  className="size-[42px] object-contain [image-rendering:pixelated]"
                />
              ) : (
                <PersonStanding aria-hidden className="size-5 text-ink-3" />
              )}
            </Checker>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <PresetSelect
                id={ids.preset}
                size="sm"
                presets={plan.presets}
                prompt={prompt}
                setPrompt={setPrompt}
                disabled={generating}
                customLabel={anchor?.uploaded ? "Uploaded character" : "Describe your own"}
              />
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-1.5"
                  onClick={() => !generating && uploadInputRef.current?.click()}
                  disabled={generating}
                  title="Upload a character image to animate. Drop a file here too. Transparent PNG works best."
                >
                  <Upload aria-hidden />
                  {anchor?.uploaded ? "Replace upload" : "Upload your own"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-1.5"
                  onClick={onRerollCharacter}
                  disabled={!anchor || !prompt.trim() || generating}
                  title="Discard this character and lock a fresh one, then redraw the sheet"
                >
                  <RefreshCw aria-hidden />
                  Re-roll
                </Button>
                {anchor?.uploaded && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-1.5"
                    onClick={onRemoveUploadedCharacter}
                    disabled={generating}
                    title="Remove the uploaded character and use a description instead"
                  >
                    <X aria-hidden />
                    Remove upload
                  </Button>
                )}
              </div>
            </div>
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadCharacter(file);
              e.target.value = "";
            }}
          />
        </div>
        <PromptField
          value={prompt}
          onChange={setPrompt}
          onSubmit={onGenerate}
          canSubmit={canGenerate && !generating}
          disabled={generating}
          optional={!!anchor?.uploaded}
          placeholder={
            anchor?.uploaded
              ? "Describe the character to refine results"
              : "A knight in silver armour with a blue tabard"
          }
        />
        <ArtStyleField value={artStyle} onChange={setArtStyle} disabled={generating} />
      </PanelSection>

      <PanelSection>
        <ChipGroup label="Animation">
          {plan.anims.map((animType) => {
            const animSpec = SPRITE_ANIMATIONS[animType];
            const saved = generatedAnims.has(animType) && animType !== selectedAnim;
            return (
              <ToggleChip
                key={animType}
                pressed={selectedAnim === animType}
                onClick={() => setSelectedAnim(animType)}
                disabled={generating}
                title={saved ? `${animSpec.hint}. Saved, click to view.` : animSpec.hint}
              >
                {animSpec.label}
                {saved && (
                  <>
                    <span aria-hidden className="size-1.5 bg-current" />
                    <span className="sr-only">, saved</span>
                  </>
                )}
              </ToggleChip>
            );
          })}
        </ChipGroup>
        <p className="text-xs leading-[18px] text-ink-2">
          {SPRITE_FRAME_COUNT} frames at {SPRITE_FRAME_SIZE} px, laid out as a {SPRITE_GRID_COLS} ×{" "}
          {SPRITE_GRID_ROWS} sheet.
        </p>
      </PanelSection>

      <PanelSection className="border-b-0">
        <Button
          variant="ghost"
          size="sm"
          className="self-start px-1"
          aria-expanded={advancedOpen}
          aria-controls={ids.advanced}
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          Advanced: model, two-pass lock
        </Button>
        <div id={ids.advanced} hidden={!advancedOpen} className="flex flex-col gap-3.5">
          <Field
            label="Model"
            htmlFor={ids.model}
            help={`${model.hint ? `${model.hint} · ` : ""}about ${formatSeconds(model.approxSecondsPerCall)} a call`}
          >
            <Select
              id={ids.model}
              value={model.value}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={generating}
              aria-describedby={`${ids.model}-note`}
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="oa-field-label items-center">
              Two-pass lock
              {anchor ? (
                <Badge tone="success">
                  <Lock aria-hidden />
                  Locked
                </Badge>
              ) : (
                <Badge>
                  <LockOpen aria-hidden />
                  Not locked
                </Badge>
              )}
            </span>
            <p className="text-xs leading-[18px] text-ink-2">
              Pass 1 locks a character. Pass 2 paints all {SPRITE_FRAME_COUNT} frames onto a fixed
              pose map, so every animation keeps the same character. Re-roll or clear to unlock it.
            </p>
          </div>
        </div>
      </PanelSection>
    </>
  );

  const footer = (
    <RunFooter running={generating} message={progressMessage} onStop={onStop} hint={`${runHint}${anchor ? "" : " · 2 passes"}`}>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={onGenerate}
        disabled={!canGenerate}
        title={
          anchor
            ? `Draw the ${animLabel} sheet for the locked character`
            : `Lock the character, then draw the ${animLabel} sheet`
        }
      >
        <Sparkles aria-hidden />
        {anchor && hasAny ? `Regenerate ${animLabel}` : `Generate ${animLabel}`}
      </Button>
    </RunFooter>
  );

  return (
    <GeneratorLayout formLabel="Sprite settings" form={form} footer={footer} resultsLabel="Sprite results">
      {showRun ? (
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-7">
          <section aria-labelledby={ids.run} className="flex flex-col gap-3">
            <RunHeader
              id={ids.run}
              title={`${characterName} · ${spec.label}`}
              meta={
                <>
                  {artStyle !== "none" && <Badge>{findStyleLabel(artStyle)}</Badge>}
                  <span className="text-xs text-ink-3">
                    {filledCount}/{SPRITE_FRAME_COUNT} frames
                  </span>
                </>
              }
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClear}
                    disabled={(!hasAny && !anchor) || generating}
                    title="Clear frames, the locked character and the description"
                  >
                    <Trash2 aria-hidden />
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    onClick={onDownloadZip}
                    disabled={!hasAny || generating}
                    aria-label="Download ZIP"
                    title="Frame PNGs, grid sheet, strip and JSON manifest"
                  >
                    <FileArchive aria-hidden />
                    ZIP
                  </Button>
                  <Button
                    size="sm"
                    onClick={onDownloadSheet}
                    disabled={!hasAny || generating}
                    aria-label="Download sheet PNG and manifest"
                    title="Grid sheet, horizontal strip and JSON manifest"
                  >
                    <Download aria-hidden />
                    Sheet PNG
                  </Button>
                </>
              }
            />
            <div className="flex flex-wrap items-start gap-4">
              <SpriteAnimationPlayer
                frames={sheet.frames}
                fps={fps}
                setFps={setFps}
                loop={spec.loop}
                playing={playing}
                setPlaying={setPlaying}
                anchorImageUrl={anchor?.imageUrl ?? null}
                anchorUploaded={anchor?.uploaded}
              />
              <ol
                aria-label={`Frames, ${SPRITE_GRID_COLS} by ${SPRITE_GRID_ROWS}`}
                className="grid min-w-0 flex-[999_1_420px] gap-px border-[1.5px] border-line bg-line"
                style={{ gridTemplateColumns: `repeat(${SPRITE_GRID_COLS}, minmax(0, 1fr))` }}
              >
                {sheet.frames.map((frame) => (
                  <SpriteFrameCell
                    key={frame.index}
                    frame={frame}
                    loading={generating && !frame.imageUrl}
                    onToggle={onToggleFrame}
                  />
                ))}
              </ol>
            </div>
            <p className="text-xs leading-[18px] text-ink-2">
              Click a frame to skip it in the preview and export. Frame 1 is top left.
              {skippedCount > 0 && (
                <span className="text-ink">
                  {" "}
                  {skippedCount} skipped, {activeCount} in use.
                </span>
              )}
            </p>
          </section>

          {earlierAnims.length > 0 && (
            <section
              aria-labelledby={ids.earlier}
              className="flex flex-col gap-3 border-t-[1.5px] border-line pt-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id={ids.earlier} className="oa-section">
                  Earlier runs
                </h2>
                <span className="text-xs text-ink-3">{plan.label}</span>
              </div>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {earlierAnims.map((a) => (
                  <li key={a}>
                    <button
                      type="button"
                      onClick={() => setSelectedAnim(a)}
                      disabled={generating}
                      className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="oa-tile oa-checker w-full group-hover:border-line-strong">
                        {anchor?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={anchor.imageUrl}
                            alt=""
                            draggable={false}
                            className="h-3/4 w-3/4 object-contain [image-rendering:pixelated]"
                          />
                        ) : (
                          <PersonStanding aria-hidden className="size-6 text-ink-3" />
                        )}
                      </span>
                      <span className="flex justify-between gap-1.5 text-xs">
                        <span className="truncate font-medium">{characterName}</span>
                        <span className="flex-none text-ink-3">{SPRITE_ANIMATIONS[a].label}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <EmptyState
          className="m-auto w-full max-w-xl"
          icon={<PersonStanding aria-hidden className="size-5" />}
          title="No sprite sheet yet"
          description={`Pick a body plan and a character, then generate an animation. Frames appear here as a ${SPRITE_GRID_COLS} × ${SPRITE_GRID_ROWS} sheet you can preview, trim and export.`}
        />
      )}
    </GeneratorLayout>
  );
}
