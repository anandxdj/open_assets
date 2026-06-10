"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Left sidebar: 4 parallax layer cards (thumbnail, scroll speed, clear) with
// front-to-back workflow guidance.

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LAYER_ROLES,
  getRecommendedLayerIndex,
  getWorkflowPrerequisite,
  getWorkflowStep,
} from "@/features/studio/lib/parallax";
import type { ParallaxLayer } from "@/features/studio/lib/parallax";

export function LayerRail({
  layers,
  activeIdx,
  onSelect,
  onClearLayer,
  onScrollSpeedChange,
}: {
  layers: ParallaxLayer[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  onClearLayer: (idx: number) => void;
  onScrollSpeedChange: (idx: number, speed: number) => void;
}) {
  const recommendedIdx = getRecommendedLayerIndex(layers);
  const completedCount = layers.filter((l) => l.imageUrl).length;

  return (
    <aside
      className="flex w-[230px] shrink-0 flex-col gap-2 border-r-2 border-zinc-950 dark:border-zinc-800 bg-background p-3 font-mono"
      aria-label="Parallax layers"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Layers
        </span>
        <span className="text-[10px] uppercase text-muted-foreground">back → front</span>
      </div>

      {completedCount < layers.length && recommendedIdx !== null && (
        <div className="mb-1 border-2 border-zinc-950 dark:border-zinc-700 px-2.5 py-2 text-[10px] leading-snug">
          <span className="font-black uppercase">
            Step {getWorkflowStep(layers[recommendedIdx].role)} —{" "}
            {LAYER_ROLES[layers[recommendedIdx].role].short}
          </span>
          <br />
          <span className="text-muted-foreground">
            Build layers front-to-back so each step matches the scene in front of it.
          </span>
        </div>
      )}

      {layers.map((layer, idx) => {
        const spec = LAYER_ROLES[layer.role];
        const isActive = idx === activeIdx;
        const isEmpty = !layer.imageUrl;
        const isRecommended = idx === recommendedIdx;
        const prerequisite = isEmpty ? getWorkflowPrerequisite(layers, layer.role) : null;
        const isWaiting = !!prerequisite;
        const step = getWorkflowStep(layer.role);
        return (
          <div
            key={layer.id}
            className={cn(
              "relative border-2 p-2 transition-all",
              isActive
                ? "border-zinc-950 dark:border-white"
                : isRecommended
                  ? "border-zinc-500"
                  : "border-zinc-200 dark:border-zinc-800",
              isWaiting && !isActive && "opacity-70",
            )}
          >
            <button
              onClick={() => onSelect(idx)}
              className="flex w-full items-center gap-2 text-left"
              aria-pressed={isActive}
              title={spec.hint}
            >
              <div className="relative shrink-0">
                <div className="flex h-9 w-14 items-center justify-center overflow-hidden border border-zinc-300 dark:border-zinc-700 bg-[repeating-conic-gradient(#80808033_0%_25%,transparent_0%_50%)] bg-[length:8px_8px]">
                  {layer.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={layer.imageUrl}
                      alt=""
                      className="block h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="text-[9px] uppercase text-muted-foreground">empty</span>
                  )}
                </div>
                <span
                  className={cn(
                    "absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center border text-[9px] font-black",
                    layer.imageUrl || isRecommended
                      ? "border-zinc-950 dark:border-white bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "border-zinc-300 dark:border-zinc-700 bg-background text-muted-foreground",
                  )}
                >
                  {layer.imageUrl ? "✓" : step}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-[11px] font-bold uppercase">{spec.label}</div>
                  {isRecommended && (
                    <span className="shrink-0 bg-zinc-950 text-white dark:bg-white dark:text-black px-1.5 py-px text-[8px] font-black uppercase tracking-wide">
                      Next
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {isEmpty
                    ? isWaiting
                      ? `Needs ${LAYER_ROLES[prerequisite!.role].short} first`
                      : spec.hint
                    : `${layer.width}×${layer.height}${spec.isOpaque ? "" : " · α"}`}
                </div>
              </div>
            </button>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Speed</span>
              <input
                type="range"
                min={0}
                max={150}
                value={Math.round(layer.scrollSpeed * 100)}
                onChange={(e) => onScrollSpeedChange(idx, Number(e.target.value) / 100)}
                className="flex-1"
                aria-label={`${spec.label} scroll speed`}
                title={`${layer.scrollSpeed.toFixed(2)}× camera speed`}
              />
              <span className="min-w-[28px] font-mono text-[10px] tabular-nums text-muted-foreground">
                {layer.scrollSpeed.toFixed(2)}×
              </span>
            </div>
            {!isEmpty && (
              <button
                onClick={() => onClearLayer(idx)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-destructive"
                title={`Clear ${spec.short}`}
                aria-label={`Clear ${spec.short} layer`}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        );
      })}
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        Build front → back: Near, then Mid, Far, Sky. Sky is opaque; the others are
        alpha-keyed over it.
      </p>
    </aside>
  );
}
