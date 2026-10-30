"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Parallax workspace: form panel (layer rail, extend prompt, target width,
// finishing tools) and results (live composite preview, active-layer stage
// with edge buttons and the variant review bar).

import { useEffect, useId, useRef } from "react";
import { Download, FileArchive, Plus, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
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
import { UploadDropZone } from "@/features/studio/components/EmptyState";
import { VariantSelector } from "@/features/studio/components/VariantSelector";
import { EDGE_NAME, EdgeHandle } from "@/features/studio/components/Workspace";
import {
  GeneratorLayout,
  RunFooter,
  RunHeader,
  scrollBehavior,
  shouldIgnoreShortcut,
  useRunHint,
} from "@/features/studio/components/GeneratorLayout";

export function ParallaxScreen() {
  const px = useParallax();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ids = { scene: useId(), layer: useId() };
  const runHint = useRunHint(1);

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
      el.scrollTo({ left: el.scrollWidth, behavior: scrollBehavior() });
    } else if (isResult && px.activeDirection === "left") {
      el.scrollTo({ left: 0, behavior: scrollBehavior() });
    }
  }, [activeImage, isResult, px.activeDirection]);

  // Keyboard: ←/→ extend (horizontal only — vertical would warp game height);
  // with result: ←/→ cycle, Enter accept, Esc discard, R regenerate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
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
  const activeSpec = activeLayer ? LAYER_ROLES[activeLayer.role] : null;
  const busy = px.loading || px.autoExtending;
  const canAutoExtend =
    !px.loading && !!px.targetWidth && !!activeDimensions && activeDimensions.width < px.targetWidth;
  const runningMessage =
    px.progressMsg || (px.activeDirection ? `Extending ${EDGE_NAME[px.activeDirection]}` : "Working");

  const form = (
    <>
      <LayerRail
        layers={px.layers}
        activeIdx={px.activeIdx}
        onSelect={px.setActiveIdx}
        onClearLayer={px.clearLayer}
        onScrollSpeedChange={px.setLayerScrollSpeed}
      />
      {!!activeLayer?.imageUrl && activeSpec && (
        <CommandBar
          prompt={px.customPrompt}
          setPrompt={px.setCustomPrompt}
          artStyle={px.artStyle}
          setArtStyle={px.setArtStyle}
          loading={busy || isResult}
          hint={
            px.artStyle !== "none"
              ? `${findStyleLabel(px.artStyle)}: what to add further along the ${activeSpec.short.toLowerCase()} layer`
              : `What should appear further along the ${activeSpec.short.toLowerCase()} layer?`
          }
          sceneBrief={showSceneDirection ? px.sceneBrief : undefined}
          setSceneBrief={showSceneDirection ? px.setSceneBrief : undefined}
          sceneBriefLoading={px.sceneBriefLoading}
        />
      )}
      {!isEmpty && !isResult && (
        <ParallaxTargetBar
          dimensions={activeDimensions}
          targetWidth={px.targetWidth}
          setTargetWidth={px.setTargetWidth}
          progress={widthProgress}
          remainingPx={remainingPx}
          targetReached={targetReached}
          autoExtending={px.autoExtending}
          loading={px.loading}
          onMakeTileable={() => void px.handleMakeActiveLayerTileable()}
          makeTileableDisabled={!activeImage}
          onHarmonize={() => void px.handleHarmonizeActiveLayer()}
          harmonizeDisabled={!activeImage}
        />
      )}
    </>
  );

  const footer = (
    <RunFooter
      running={busy}
      message={runningMessage}
      onStop={px.autoExtending ? px.handleStopAutoExtend : undefined}
      stopLabel="Stop auto-extend"
      hint={isResult ? undefined : isEmpty ? runHint : `${runHint} a step`}
      announce={isResult ? "Extension ready. Review it on the stage." : undefined}
    >
      {isResult ? (
        <p className="text-xs leading-[20px] text-ink-2">
          Review the extension on the stage. <Kbd>←</Kbd> <Kbd>→</Kbd> compare, <Kbd>Enter</Kbd>{" "}
          use it, <Kbd>Esc</Kbd> discard, <Kbd>R</Kbd> regenerate.
        </p>
      ) : isEmpty ? (
        <>
          <Button variant="primary" size="lg" block onClick={px.openGenerateModal} disabled={!activeLayer}>
            <Sparkles aria-hidden />
            Generate {activeSpec ? activeSpec.short.toLowerCase() : ""} layer
          </Button>
          <Button block onClick={() => fileInputRef.current?.click()}>
            <Upload aria-hidden />
            Upload image
          </Button>
        </>
      ) : (
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => void px.handleAutoExtend()}
          disabled={!canAutoExtend}
          title="Extend right until the layer reaches the target width"
        >
          <Sparkles aria-hidden />
          {px.targetWidth ? `Auto-extend to ${px.targetWidth} px` : "Auto-extend"}
        </Button>
      )}
    </RunFooter>
  );

  const emptyLayerView = (() => {
    if (!activeLayer || !activeSpec) return null;
    const prerequisite = getWorkflowPrerequisite(px.layers, activeLayer.role);
    const prerequisiteIdx = prerequisite ? getLayerIndexByRole(px.layers, prerequisite.role) : -1;
    const step = getWorkflowStep(activeLayer.role);
    return (
      <div className="flex flex-col gap-3">
        {prerequisite && prerequisiteIdx >= 0 && (
          <Notice tone="warning">
            <p>
              <strong className="font-semibold">
                Step {step}: build {activeSpec.short.toLowerCase()} after{" "}
                {LAYER_ROLES[prerequisite.role].short.toLowerCase()}.
              </strong>{" "}
              Layers stack back to front in the game, but you build them front to back. Finish{" "}
              {LAYER_ROLES[prerequisite.role].label} first so this layer matches its palette,
              lighting and art direction.
            </p>
            <Button size="sm" className="mt-2" onClick={() => px.setActiveIdx(prerequisiteIdx)}>
              Go to {LAYER_ROLES[prerequisite.role].short} (step {getWorkflowStep(prerequisite.role)})
            </Button>
          </Notice>
        )}
        <UploadDropZone
          title={`Drop a ${activeSpec.short.toLowerCase()} layer`}
          description={
            activeSpec.isOpaque
              ? "PNG, JPG or WEBP: an opaque image at your game height. Click to browse."
              : "PNG with transparency works best. Click to browse."
          }
          onPickFile={() => fileInputRef.current?.click()}
          onDropFile={px.handleFile}
        />
        <div className="flex items-center justify-center gap-2 text-xs text-ink-2">
          <span>or</span>
          <Button variant="ghost" size="sm" onClick={px.openGenerateModal}>
            <Sparkles aria-hidden />
            Generate this layer
          </Button>
        </div>
      </div>
    );
  })();

  return (
    <>
      <GeneratorLayout
        formLabel="Parallax settings"
        form={form}
        footer={footer}
        resultsLabel="Parallax scene"
      >
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-7">
          <section aria-labelledby={ids.scene} className="flex flex-col gap-3">
            <RunHeader
              id={ids.scene}
              title="Scene"
              meta={
                <span className="text-xs text-ink-3">
                  {populatedCount}/{px.layers.length} layers
                </span>
              }
              actions={
                <>
                  {populatedCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={px.handleNewProject}>
                      <Plus aria-hidden />
                      New project
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => void px.handleExportZip()}
                    disabled={busy || !activeDimensions || populatedCount === 0}
                    aria-label="Download project ZIP"
                    title={`Export project: ${populatedCount}/${px.layers.length} populated layers and a manifest`}
                  >
                    <FileArchive aria-hidden />
                    ZIP
                  </Button>
                </>
              }
            />
            <ParallaxPreview layers={px.layers} previewHeight={160} />
          </section>

          {activeLayer && activeSpec && (
            <section
              aria-labelledby={ids.layer}
              className="flex flex-col gap-3 border-t-[1.5px] border-line pt-5"
            >
              <RunHeader
                id={ids.layer}
                title={`${activeSpec.label} layer`}
                meta={
                  activeDimensions ? (
                    <Badge>
                      <span className="oa-value">
                        {activeDimensions.width} × {activeDimensions.height}
                      </span>
                    </Badge>
                  ) : undefined
                }
                actions={
                  !isEmpty && !isResult ? (
                    <Button size="sm" onClick={px.handleDownloadActiveLayerPng} disabled={busy}>
                      <Download aria-hidden />
                      Download PNG
                    </Button>
                  ) : undefined
                }
              />

              {isEmpty ? (
                emptyLayerView
              ) : (
                <>
                  <div className="oa-stage border-[1.5px] border-line p-3">
                    <div
                      ref={scrollRef}
                      className="oa-checker overflow-x-auto border-[1.5px] border-line-strong"
                    >
                      {activeImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeImage}
                          alt={
                            isResult
                              ? `${activeSpec.short} layer with the new extension`
                              : `${activeSpec.short} layer`
                          }
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
                        <EdgeHandle
                          direction="left"
                          onClick={(d) => void px.handleExtend(d)}
                          active={px.activeDirection === "left"}
                          disabled={px.loading}
                          className="absolute left-5 top-1/2 z-10 -translate-y-1/2"
                        />
                        <EdgeHandle
                          direction="right"
                          onClick={(d) => void px.handleExtend(d)}
                          active={px.activeDirection === "right"}
                          disabled={px.loading}
                          className="absolute right-5 top-1/2 z-10 -translate-y-1/2"
                        />
                      </>
                    )}
                  </div>

                  {isResult ? (
                    <div className="flex justify-center">
                      <VariantSelector
                        index={px.selectedCandidateIdx}
                        total={variantCount}
                        isBest={px.selectedCandidateIdx === 0}
                        score={px.debugMode ? px.activeCandidate?.score : undefined}
                        onPrev={() => px.cycleVariant(-1)}
                        onNext={() => px.cycleVariant(1)}
                        onAccept={px.handleAccept}
                        onRegenerate={() => void px.handleRegenerate()}
                        onDiscard={px.handleDiscard}
                        onDownload={px.handleDownloadActiveLayerPng}
                        loading={px.loading}
                      />
                    </div>
                  ) : (
                    !busy && (
                      <p className="text-xs leading-[18px] text-ink-2">
                        Extend left or right from the stage (or press <Kbd>←</Kbd> <Kbd>→</Kbd>), or
                        set a target width and auto-extend.
                      </p>
                    )
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </GeneratorLayout>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden
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
                  return `${LAYER_ROLES[prereq.role].label} isn't built yet. Layers match best when generated front to back (Near, Mid, Far, then Sky) so palette and art direction stay consistent. You can still generate now if you're bringing your own matching assets.`;
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
    </>
  );
}
