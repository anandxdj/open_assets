"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Extender mode screen: empty state ↔ workspace + command bar, keyboard-first.

import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import type { Direction } from "@/features/studio/lib/app";
import { findStyleLabel } from "@/features/studio/lib/artStyles";
import { useExtender } from "@/features/studio/hooks/useExtender";
import { Workspace } from "@/features/studio/components/Workspace";
import { CommandBar } from "@/features/studio/components/CommandBar";
import { EmptyState } from "@/features/studio/components/EmptyState";
import { VariantSelector, ResultActions } from "@/features/studio/components/VariantSelector";

export function ExtenderScreen() {
  const ext = useExtender();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isResult = !!ext.activeCandidate;
  const variantCount = ext.extendedCandidates.length;
  const displayImage = ext.activeCandidate?.imageUrl ?? ext.selectedImage;
  const displayDimensions = ext.activeCandidate
    ? (ext.candidateDims[ext.selectedCandidateIdx] ?? null)
    : ext.currentImageDimensions;

  // Keyboard shortcuts: arrows extend; with a result: ←/→ cycle, Enter accept,
  // Esc discard, R regenerate. Skipped while typing in inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

  const variantSelectorEl =
    isResult && variantCount > 1 ? (
      <VariantSelector
        index={ext.selectedCandidateIdx}
        total={variantCount}
        isBest={ext.selectedCandidateIdx === 0}
        score={ext.debugMode ? ext.activeCandidate?.score : undefined}
        onPrev={() => ext.cycleVariant(-1)}
        onNext={() => ext.cycleVariant(1)}
      />
    ) : undefined;

  const resultActionsEl = isResult ? (
    <ResultActions
      onAccept={ext.handleAccept}
      onRegenerate={() => void ext.handleRegenerate()}
      onDiscard={ext.handleDiscard}
      onDownload={ext.handleDownload}
      loading={ext.loading}
    />
  ) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {ext.selectedImage && (
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-zinc-200 dark:border-zinc-800 px-4 font-mono">
          <button
            onClick={ext.handleNewImage}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground"
          >
            <Plus size={13} />
            New image
          </button>
        </div>
      )}

      {!displayImage ? (
        <EmptyState
          title="Drop an image to begin"
          subtitle="PNG, JPG, or WEBP — click anywhere in this area to browse"
          onPickFile={() => fileInputRef.current?.click()}
          onDropFile={ext.handleFile}
        />
      ) : (
        <Workspace
          image={displayImage}
          dimensions={displayDimensions}
          onExtend={(d) => void ext.handleExtend(d)}
          activeDirection={ext.activeDirection}
          loading={ext.loading}
          progressMessage={ext.progressMsg}
          isResult={isResult}
          resultMessage={
            isResult
              ? variantCount > 1
                ? "Cycle variants with ← →, then accept"
                : "New extension ready — accept, regenerate, or discard"
              : undefined
          }
          variantSelector={variantSelectorEl}
          resultActions={resultActionsEl}
        />
      )}

      {!!ext.selectedImage && !isResult && (
        <CommandBar
          prompt={ext.customPrompt}
          setPrompt={ext.setCustomPrompt}
          artStyle={ext.artStyle}
          setArtStyle={ext.setArtStyle}
          loading={ext.loading}
          hint={
            ext.artStyle !== "none"
              ? `Style: ${findStyleLabel(ext.artStyle)} — describe what to add (optional)`
              : undefined
          }
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) ext.handleFile(file);
          e.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
