"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Layer list for the parallax form panel: one row per layer (thumbnail,
// status, clear) with its scroll speed, plus front-to-back guidance.

import { cn } from "@/lib/utils";
import { useId } from "react";
import { Check, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Range } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import {
  LAYER_ROLES,
  getRecommendedLayerIndex,
  getWorkflowPrerequisite,
  getWorkflowStep,
} from "@/features/studio/lib/parallax";
import type { ParallaxLayer } from "@/features/studio/lib/parallax";
import { PanelSection } from "@/features/studio/components/GeneratorLayout";

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
  const headingId = useId();
  const recommendedIdx = getRecommendedLayerIndex(layers);
  const completedCount = layers.filter((l) => l.imageUrl).length;

  return (
    <PanelSection>
      <div className="oa-field-label">
        <h2 id={headingId}>Layers</h2>
        <span className="oa-value text-ink-3">Back to front</span>
      </div>

      <ul aria-labelledby={headingId} className="-mx-1.5 flex flex-col gap-1">
        {layers.map((layer, idx) => {
          const spec = LAYER_ROLES[layer.role];
          const isActive = idx === activeIdx;
          const isEmpty = !layer.imageUrl;
          const isRecommended = idx === recommendedIdx;
          const prerequisite = isEmpty ? getWorkflowPrerequisite(layers, layer.role) : null;
          const step = getWorkflowStep(layer.role);
          const meta = isEmpty
            ? prerequisite
              ? `Needs ${LAYER_ROLES[prerequisite.role].short} first`
              : spec.hint
            : `${layer.width} × ${layer.height}${spec.isOpaque ? "" : ", transparent"}`;
          return (
            <li key={layer.id} className="flex flex-col">
              <div className="oa-layer h-auto min-h-[40px] py-1 pr-1" data-selected={isActive}>
                <button
                  type="button"
                  onClick={() => onSelect(idx)}
                  aria-pressed={isActive}
                  title={spec.hint}
                  className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left"
                >
                  <span className="oa-checker relative flex h-7 w-11 flex-none items-center justify-center overflow-hidden border border-line">
                    {layer.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={layer.imageUrl} alt="" draggable={false} className="block h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden className="text-[10.5px] font-bold text-ink-3">
                        {step}
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold">{spec.label}</span>
                      {!isEmpty && (
                        <>
                          <Check aria-hidden className="size-3.5 flex-none text-success" />
                          <span className="sr-only">, done</span>
                        </>
                      )}
                    </span>
                    <span className={cn("truncate text-[11px] leading-4", isActive ? "text-ink-2" : "text-ink-3")}>{meta}</span>
                  </span>
                  {isRecommended && <Badge className="flex-none">Next</Badge>}
                </button>
                {!isEmpty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => onClearLayer(idx)}
                    aria-label={`Clear ${spec.short} layer`}
                    title={`Clear ${spec.short}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 py-1 pl-2.5 pr-2">
                <span aria-hidden className="oa-label w-[44px] flex-none text-ink-3">
                  Speed
                </span>
                <Range
                  min={0}
                  max={150}
                  value={Math.round(layer.scrollSpeed * 100)}
                  onChange={(e) => onScrollSpeedChange(idx, Number(e.target.value) / 100)}
                  aria-label={`${spec.label} scroll speed`}
                  aria-valuetext={`${layer.scrollSpeed.toFixed(2)} times camera speed`}
                  className="min-w-0 flex-1"
                />
                <span className="oa-value w-11 flex-none text-right text-ink-2">
                  {layer.scrollSpeed.toFixed(2)}×
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {completedCount < layers.length && recommendedIdx !== null ? (
        <Notice tone="info">
          <strong className="font-semibold">
            Step {getWorkflowStep(layers[recommendedIdx].role)}: {LAYER_ROLES[layers[recommendedIdx].role].short}.
          </strong>{" "}
          Build front to back (Near, Mid, Far, then Sky) so each layer matches the one in front of
          it. Sky is opaque; the others are transparent over it.
        </Notice>
      ) : (
        <p className="text-xs leading-[18px] text-ink-2">
          Sky is opaque; the other layers are transparent over it.
        </p>
      )}
    </PanelSection>
  );
}
