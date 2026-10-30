"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Extender: form panel (source image, what to add, art style) and a stage
// with an extend button on each edge and a floating review bar. Keyboard
// first: arrows extend; with a result ←/→ cycle, Enter accept, Esc discard,
// R regenerate.

import { useEffect, useId, useRef } from "react";
import { Expand, ImagePlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/controls";
import { Checker } from "@/components/ui/feedback";
import type { Direction } from "@/features/studio/lib/app";
import { EXTENSION_PERCENT } from "@/features/studio/lib/app";
import { findStyleLabel } from "@/features/studio/lib/artStyles";
import { useExtender } from "@/features/studio/hooks/useExtender";
import { EDGE_NAME, Workspace } from "@/features/studio/components/Workspace";
import { CommandBar } from "@/features/studio/components/CommandBar";
import { UploadDropZone } from "@/features/studio/components/EmptyState";
import { VariantSelector } from "@/features/studio/components/VariantSelector";
import {
  GeneratorLayout,
  PanelSection,
  RunFooter,
  shouldIgnoreShortcut,
  useRunHint,
} from "@/features/studio/components/GeneratorLayout";

export function ExtenderScreen() {
  const ext = useExtender();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceId = useId();
  const runHint = useRunHint(1);

  const isResult = !!ext.activeCandidate;
  const variantCount = ext.extendedCandidates.length;
  const displayImage = ext.activeCandidate?.imageUrl ?? ext.selectedImage;
  const displayDimensions = ext.activeCandidate
    ? (ext.candidateDims[ext.selectedCandidateIdx] ?? null)
    : ext.currentImageDimensions;

  // Keyboard shortcuts: arrows extend; with a result: ←/→ cycle, Enter accept,
  // Esc discard, R regenerate. Skipped while typing or on focused buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      if (!ext.selectedImage || ext.loading) return;
      if (ext.activeCandidate) {
        if (e.key === "Enter") ext.handleAccept();
        else if (e.key === "Escape") ext.handleDiscard();
        else if (e.key === "r" || e.key === "R") void ext.handleRegenerate();
        else if (e.key === "ArrowLeft" && variantCount > 1) {
          e.preventDefault();
          ext.cycleVariant(-1);
        } else if (e.key === "ArrowRight" && variantCount > 1) {
          e.preventDefault();
          ext.cycleVariant(1);
        }
        return;
      }
      const mapping: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const dir = mapping[e.key];
      if (dir) {
        e.preventDefault();
        void ext.handleExtend(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ext, variantCount]);

  const pickFile = () => fileInputRef.current?.click();

  const form = (
    <>
      <PanelSection>
        <span id={sourceId} className="oa-field-label">
          Source image
        </span>
        {ext.selectedImage ? (
          <div className="flex items-center gap-2.5" role="group" aria-labelledby={sourceId}>
            <Checker className="flex size-14 flex-none items-center justify-center overflow-hidden border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ext.selectedImage} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
            </Checker>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="oa-value text-ink-2">
                {ext.currentImageDimensions
                  ? `${ext.currentImageDimensions.width} × ${ext.currentImageDimensions.height} px`
                  : "Loading"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="self-start px-1.5"
                onClick={ext.handleNewImage}
              >
                <ImagePlus aria-hidden />
                New image
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-[18px] text-ink-2">
            Upload a PNG, JPEG or WebP to start. Each extension adds {EXTENSION_PERCENT}% of the
            current size on the edge you pick.
          </p>
        )}
      </PanelSection>
      {ext.selectedImage && (
        <CommandBar
          prompt={ext.customPrompt}
          setPrompt={ext.setCustomPrompt}
          artStyle={ext.artStyle}
          setArtStyle={ext.setArtStyle}
          loading={ext.loading || isResult}
          hint={
            ext.artStyle !== "none"
              ? `${findStyleLabel(ext.artStyle)}: describe what to add`
              : undefined
          }
        />
      )}
      {ext.selectedImage && (
        <PanelSection className="border-b-0">
          <p className="text-xs leading-[20px] text-ink-2">
            Each extension adds {EXTENSION_PERCENT}% of the current size. Pick an edge on the stage
            or press <Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>←</Kbd> <Kbd>→</Kbd>. Accept and extend again
            for more.
          </p>
        </PanelSection>
      )}
    </>
  );

  const footer = (
    <RunFooter
      running={ext.loading}
      message={ext.progressMsg || (ext.activeDirection ? `Extending ${EDGE_NAME[ext.activeDirection]}` : "Working")}
      hint={!ext.selectedImage || isResult ? undefined : runHint}
      announce={isResult ? "Extension ready. Review it on the stage." : undefined}
    >
      {!ext.selectedImage ? (
        <Button variant="primary" size="lg" block onClick={pickFile}>
          <Upload aria-hidden />
          Upload image
        </Button>
      ) : isResult ? (
        <p className="text-xs leading-[20px] text-ink-2">
          Review the extension on the stage. <Kbd>←</Kbd> <Kbd>→</Kbd> compare, <Kbd>Enter</Kbd>{" "}
          use it, <Kbd>Esc</Kbd> discard, <Kbd>R</Kbd> regenerate.
        </p>
      ) : (
        <p className="flex items-center justify-center gap-2 text-xs leading-[18px] text-ink-2">
          <Expand aria-hidden className="size-4 flex-none" />
          Pick an edge on the stage to extend.
        </p>
      )}
    </RunFooter>
  );

  return (
    <>
      <GeneratorLayout
        formLabel="Extender settings"
        form={form}
        footer={footer}
        resultsLabel="Extender stage"
        resultsClassName={displayImage ? "p-0 md:p-0" : undefined}
      >
        {!displayImage ? (
          <div className="m-auto w-full max-w-2xl">
            <UploadDropZone
              title="Drop an image to begin"
              description="PNG, JPEG or WebP. Click to browse."
              onPickFile={pickFile}
              onDropFile={ext.handleFile}
              className="py-20"
            />
          </div>
        ) : (
          <Workspace
            image={displayImage}
            dimensions={displayDimensions}
            onExtend={(d) => void ext.handleExtend(d)}
            activeDirection={ext.activeDirection}
            loading={ext.loading}
            isResult={isResult}
            overlay={
              isResult ? (
                <VariantSelector
                  index={ext.selectedCandidateIdx}
                  total={variantCount}
                  isBest={ext.selectedCandidateIdx === 0}
                  score={ext.debugMode ? ext.activeCandidate?.score : undefined}
                  onPrev={() => ext.cycleVariant(-1)}
                  onNext={() => ext.cycleVariant(1)}
                  onAccept={ext.handleAccept}
                  onRegenerate={() => void ext.handleRegenerate()}
                  onDiscard={ext.handleDiscard}
                  onDownload={ext.handleDownload}
                  loading={ext.loading}
                />
              ) : undefined
            }
          />
        )}
      </GeneratorLayout>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) ext.handleFile(file);
          e.target.value = "";
        }}
        className="hidden"
      />
    </>
  );
}
