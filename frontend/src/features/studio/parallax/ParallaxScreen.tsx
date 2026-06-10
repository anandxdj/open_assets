"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Parallax workspace: LayerRail + live composite preview + active-layer
// canvas (extend/review) + target bar (auto-extend, export).

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Direction } from "@/features/studio/lib/app";
import {
  LAYER_ROLES,
  WORKFLOW_ORDER,
  getLayerIndexByRole,
  getWorkflowPrerequisite,
  getWorkflowStep,
} from "@/features/studio/lib/parallax";
import { findStyleLabel } from "@/features/studio/lib/artStyles";
import { useParallax } from "@/features/studio/hooks/useParallax";
import { LayerRail } from "@/features/studio/parallax/LayerRail";
import { ParallaxPreview } from "@/features/studio/parallax/ParallaxPreview";
import { ParallaxTargetBar } from "@/features/studio/parallax/ParallaxTargetBar";
import { GenerateModal } from "@/features/studio/components/GenerateModal";
import { CommandBar } from "@/features/studio/components/CommandBar";
import { StatusPill } from "@/features/studio/components/StatusPill";
import { VariantSelector, ResultActions } from "@/features/studio/components/VariantSelector";

function ParallaxEdgeHandle({
  direction,
  onClick,
  active,
  disabled,
}: {
  direction: "left" | "right";
  onClick: () => void;
  active: boolean;
  disabled: boolean;
}) {
  const Icon = direction === "left" ? ArrowLeft : ArrowRight;
  const position: React.CSSProperties =
    direction === "left"
      ? { left: 8, top: "50%", transform: "translateY(-50%)" }
      : { right: 8, top: "50%", transform: "translateY(-50%)" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={`Extend ${direction}`}
      aria-label={`Extend ${direction}`}
      style={position}
      className={cn(
        "absolute z-20 flex h-12 w-12 items-center justify-center border-2 rounded-none transition-all",
        active
          ? "border-zinc-950 dark:border-white bg-zinc-950 text-white dark:bg-white dark:text-black animate-pulse"
          : "border-zinc-950 dark:border-zinc-700 bg-background text-muted-foreground hover:bg-zinc-950 hover:text-white dark:hover:bg-white dark:hover:text-black",
        disabled && !active && "opacity-40",
        disabled && "cursor-not-allowed",
      )}
    >
      <Icon size={20} />
    </button>
  );
}

export function ParallaxScreen() {
  const px = useParallax();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);

  const isResult = !!px.activeCandidate;
  const variantCount = px.candidates.length;
  const activeImage = px.activeCandidate?.imageUrl ?? px.activeLayer?.imageUrl ?? null;
  const activeDimensions = px.activeCandidate
    ? (px.candidateDims[px.selectedCandidateIdx] ??
      (px.activeLayer?.width && px.activeLayer?.height
        ? { width: px.activeLayer.width, height: px.activeLayer.height }
        : null))
    : px.activeLayer?.width && px.activeLayer?.height
      ? { width: px.activeLayer.width, height: px.activeLayer.height }
      : null;

  // Auto-scroll to the most recent edit (right-extend → end of strip).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isResult && (px.activeDirection === "right" || px.activeDirection === null)) {
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    } else if (isResult && px.activeDirection === "left") {
      el.scrollTo({ left: 0, behavior: "smooth" });
    }
  }, [activeImage, isResult, px.activeDirection]);

  // Keyboard: ←/→ extend (horizontal only — vertical would warp game height);
  // with result: cycle/accept/discard/regenerate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!px.activeLayer?.imageUrl || px.loading || px.autoExtending) return;
      if (px.activeCandidate) {
        if (e.key === "Enter") px.handleAccept();
        else if (e.key === "Escape") px.handleDiscard();
        else if (e.key === "r" || e.key === "R") void px.handleRegenerate();
        else if (e.key === "ArrowLeft" && variantCount > 1) {
          e.preventDefault();
          px.cycleVariant(-1);
        } else if (e.key === "ArrowRight" && variantCount > 1) {
          e.preventDefault();
          px.cycleVariant(1);
        }
        return;
      }
      const mapping: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right" };
      const dir = mapping[e.key];
      if (dir) {
        e.preventDefault();
        void px.handleExtend(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [px, variantCount]);

  const MAX_DISPLAY_HEIGHT = 320;
  const displayHeight = activeDimensions
    ? Math.min(activeDimensions.height, MAX_DISPLAY_HEIGHT)
    : MAX_DISPLAY_HEIGHT;
  const displayScale =
    activeDimensions && activeDimensions.height > 0 ? displayHeight / activeDimensions.height : 1;
  const displayWidth = activeDimensions ? activeDimensions.width * displayScale : 0;

  const widthProgress =
    activeDimensions && px.targetWidth && px.targetWidth > 0
      ? Math.min(1, activeDimensions.width / px.targetWidth)
      : 0;
  const remainingPx =
    activeDimensions && px.targetWidth ? Math.max(0, px.targetWidth - activeDimensions.width) : 0;
  const targetReached =
    !!activeDimensions && !!px.targetWidth && activeDimensions.width >= px.targetWidth;

  const populatedCount = px.layers.filter((l) => l.imageUrl).length;
  const hasAnchorLayer = px.layers.some((l) => l.role === WORKFLOW_ORDER[0] && !!l.imageUrl);
  const showSceneDirection = hasAnchorLayer || !!px.sceneBrief.trim() || px.sceneBriefLoading;
  const isEmpty = !activeImage;
  const activeLayer = px.activeLayer;

  const variantSelectorEl =
    isResult && variantCount > 1 ? (
      <VariantSelector
        index={px.selectedCandidateIdx}
        total={variantCount}
        isBest={px.selectedCandidateIdx === 0}
        score={px.debugMode ? px.activeCandidate?.score : undefined}
        onPrev={() => px.cycleVariant(-1)}
        onNext={() => px.cycleVariant(1)}
      />
    ) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 font-mono">
      <LayerRail
        layers={px.layers}
        activeIdx={px.activeIdx}
        onSelect={px.setActiveIdx}
        onClearLayer={px.clearLayer}
        onScrollSpeedChange={px.setLayerScrollSpeed}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3 sm:px-6">
        <div className="flex items-center justify-between">
          <ParallaxPreview layers={px.layers} previewHeight={140} />
        </div>
        {populatedCount > 0 && (
          <div className="flex justify-end">
            <button
              onClick={px.handleNewProject}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground hover:text-foreground"
            >
              <Plus size={12} />
              New project
            </button>
          </div>
        )}

        {isEmpty && activeLayer ? (
          (() => {
            const spec = LAYER_ROLES[activeLayer.role];
            const prerequisite = getWorkflowPrerequisite(px.layers, activeLayer.role);
            const prerequisiteIdx = prerequisite
              ? getLayerIndexByRole(px.layers, prerequisite.role)
              : -1;
            const step = getWorkflowStep(activeLayer.role);
            return (
              <div className="flex flex-1 items-center justify-center px-6 py-8">
                <div className="w-full max-w-xl">
                  {prerequisite && prerequisiteIdx >= 0 && (
                    <div className="mb-4 border-2 border-zinc-950 dark:border-zinc-700 px-4 py-3 text-[12px] leading-relaxed">
                      <p className="mb-2 font-black uppercase">
                        Step {step}: build {spec.short.toLowerCase()} after{" "}
                        {LAYER_ROLES[prerequisite.role].short.toLowerCase()}
                      </p>
                      <p className="mb-3 text-muted-foreground">
                        Parallax layers stack back-to-front in the game, but we build them
                        front-to-back. Finish <strong>{LAYER_ROLES[prerequisite.role].label}</strong>{" "}
                        first so this layer matches the same palette, lighting, and art direction.
                      </p>
                      <button
                        type="button"
                        onClick={() => px.setActiveIdx(prerequisiteIdx)}
                        className="inline-flex items-center gap-1.5 bg-zinc-950 text-white dark:bg-white dark:text-black px-3 py-1.5 text-[11px] font-black uppercase rounded-none"
                      >
                        Go to {LAYER_ROLES[prerequisite.role].short} (step{" "}
                        {getWorkflowStep(prerequisite.role)})
                      </button>
                    </div>
                  )}

                  <div className="mb-4 flex items-center justify-center gap-2 text-[12px]">
                    <span className="bg-zinc-950 text-white dark:bg-white dark:text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                      {spec.label}
                    </span>
                    <span className="uppercase text-muted-foreground text-[10px]">{spec.hint}</span>
                  </div>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file && file.type.startsWith("image/")) px.handleFile(file);
                    }}
                    className={cn(
                      "group relative cursor-pointer border-2 border-dashed px-6 py-12 text-center transition-all rounded-none",
                      drag
                        ? "border-zinc-950 dark:border-white bg-zinc-100 dark:bg-zinc-900"
                        : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-500",
                    )}
                  >
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center border-2 border-zinc-950 dark:border-zinc-700 transition-transform group-hover:scale-110">
                      <Upload size={20} />
                    </div>
                    <p className="mb-1 text-sm font-black uppercase tracking-wider">
                      Drop a {spec.short.toLowerCase()} layer
                    </p>
                    <p className="text-[11px] uppercase text-muted-foreground">
                      {spec.isOpaque
                        ? "PNG, JPG, or WEBP — opaque image at this game height"
                        : "PNG with transparency works best"}
                    </p>
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-2 text-[11px] uppercase">
                    <span className="text-muted-foreground">or</span>
                    <button
                      onClick={px.openGenerateModal}
                      className="inline-flex items-center gap-1.5 font-black underline underline-offset-4"
                    >
                      <Sparkles size={13} />
                      generate this layer with AI
                    </button>
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <>
            <div className="relative flex-1">
              <div
                ref={scrollRef}
                className="overflow-x-auto border-2 border-zinc-950 dark:border-zinc-700 bg-[repeating-conic-gradient(#80808033_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                style={{ height: `${displayHeight + 4}px` }}
              >
                {activeImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeImage}
                    alt=""
                    draggable={false}
                    className="block"
                    style={{
                      height: `${displayHeight}px`,
                      width: `${displayWidth}px`,
                      maxWidth: "none",
                      objectFit: "contain",
                    }}
                  />
                )}
              </div>
              {!isResult && !px.autoExtending && (
                <>
                  <ParallaxEdgeHandle
                    direction="left"
                    onClick={() => void px.handleExtend("left")}
                    active={px.activeDirection === "left"}
                    disabled={px.loading}
                  />
                  <ParallaxEdgeHandle
                    direction="right"
                    onClick={() => void px.handleExtend("right")}
                    active={px.activeDirection === "right"}
                    disabled={px.loading}
                  />
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {activeLayer && (
                <div className="border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                  {LAYER_ROLES[activeLayer.role].short}
                  {activeDimensions
                    ? ` · ${activeDimensions.width} × ${activeDimensions.height}`
                    : ""}
                </div>
              )}
              {isResult && variantSelectorEl}
              {isResult && (
                <StatusPill
                  status="ok"
                  message={
                    variantCount > 1
                      ? "Cycle variants with ← →, then accept"
                      : "New extension ready — accept, regenerate, or discard"
                  }
                />
              )}
              {!isResult && !px.loading && !px.autoExtending && activeLayer && (
                <span className="text-[11px] uppercase text-muted-foreground">
                  Click an edge to extend the {LAYER_ROLES[activeLayer.role].short.toLowerCase()}{" "}
                  layer, or set a target and auto-extend
                </span>
              )}
              {(px.loading || px.autoExtending) && (
                <StatusPill
                  status="working"
                  message={
                    px.progressMsg ||
                    (px.activeDirection ? `Extending ${px.activeDirection}…` : "Working…")
                  }
                />
              )}
            </div>

            {isResult && (
              <div className="flex justify-center">
                <ResultActions
                  onAccept={px.handleAccept}
                  onRegenerate={() => void px.handleRegenerate()}
                  onDiscard={px.handleDiscard}
                  onDownload={px.handleDownloadActiveLayerPng}
                  loading={px.loading}
                />
              </div>
            )}

            {!isResult && (
              <ParallaxTargetBar
                dimensions={activeDimensions}
                targetWidth={px.targetWidth}
                setTargetWidth={px.setTargetWidth}
                progress={widthProgress}
                remainingPx={remainingPx}
                targetReached={targetReached}
                autoExtending={px.autoExtending}
                loading={px.loading}
                onAutoExtend={() => void px.handleAutoExtend()}
                onStopAutoExtend={px.handleStopAutoExtend}
                onMakeTileable={() => void px.handleMakeActiveLayerTileable()}
                makeTileableDisabled={!activeImage}
                onHarmonize={() => void px.handleHarmonizeActiveLayer()}
                harmonizeDisabled={!activeImage}
                onDownloadFull={px.handleDownloadActiveLayerPng}
                onExportZip={() => void px.handleExportZip()}
                exportZipDisabled={populatedCount === 0}
                exportZipTitle={`Export project: ${populatedCount}/${px.layers.length} populated layers + manifest`}
              />
            )}
          </>
        )}

        {!!activeLayer?.imageUrl && !isResult && !px.autoExtending && (
          <CommandBar
            prompt={px.customPrompt}
            setPrompt={px.setCustomPrompt}
            artStyle={px.artStyle}
            setArtStyle={px.setArtStyle}
            loading={px.loading}
            hint={
              px.artStyle !== "none"
                ? `Style: ${findStyleLabel(px.artStyle)} — describe what to extend in the ${LAYER_ROLES[activeLayer.role].short.toLowerCase()} layer`
                : `Optional: describe what should appear further along the ${LAYER_ROLES[activeLayer.role].short.toLowerCase()} layer…`
            }
            sceneBrief={showSceneDirection ? px.sceneBrief : undefined}
            setSceneBrief={showSceneDirection ? px.setSceneBrief : undefined}
            sceneBriefLoading={px.sceneBriefLoading}
          />
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) px.handleFile(file);
          e.target.value = "";
        }}
        className="hidden"
      />

      {px.generateOpen && activeLayer && (
        <GenerateModal
          onClose={() => px.setGenerateOpen(false)}
          prompt={px.generatePrompt}
          setPrompt={px.setGeneratePrompt}
          width={px.generateWidth}
          setWidth={px.setGenerateWidth}
          height={px.generateHeight}
          setHeight={px.setGenerateHeight}
          artStyle={px.artStyle}
          setArtStyle={px.setArtStyle}
          generating={px.generating}
          onGenerate={() => void px.handleGenerateImage()}
          workflowNote={
            !activeLayer.imageUrl
              ? (() => {
                  const prereq = getWorkflowPrerequisite(px.layers, activeLayer.role);
                  if (!prereq) return null;
                  return `Tip: ${LAYER_ROLES[prereq.role].label} isn't built yet. Layers work best when generated front-to-back (Near → Mid → Far → Sky) so palette and art direction stay consistent. You can still generate now if you're bringing your own matching assets.`;
                })()
              : null
          }
          showSceneBrief={activeLayer.role !== WORKFLOW_ORDER[0]}
          sceneBrief={px.sceneBrief}
          setSceneBrief={px.setSceneBrief}
          sceneBriefLoading={px.sceneBriefLoading}
          layerLabel={LAYER_ROLES[activeLayer.role].short}
        />
      )}
    </div>
  );
}
