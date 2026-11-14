"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Form-panel sections for the active layer: target width with presets and
// progress (auto-extend runs from the panel footer), then the finishing
// tools (make tileable, harmonize).

import { useId } from "react";
import { Check, Repeat, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/controls";
import { PARALLAX_TARGET_PRESETS } from "@/features/studio/lib/parallax";
import { ChipGroup, PanelSection } from "@/features/studio/components/GeneratorLayout";

export function ParallaxTargetBar({
  dimensions,
  targetWidth,
  setTargetWidth,
  progress,
  remainingPx,
  targetReached,
  autoExtending,
  loading,
  onMakeTileable,
  makeTileableDisabled,
  onHarmonize,
  harmonizeDisabled,
}: {
  dimensions: { width: number; height: number } | null;
  targetWidth: number | null;
  setTargetWidth: (n: number | null) => void;
  progress: number;
  remainingPx: number;
  targetReached: boolean;
  autoExtending: boolean;
  loading: boolean;
  onMakeTileable: () => void;
  makeTileableDisabled?: boolean;
  onHarmonize: () => void;
  harmonizeDisabled?: boolean;
}) {
  const inputId = useId();
  const helpId = useId();
  const busy = loading || autoExtending;

  return (
    <>
      <PanelSection>
        <div className="oa-field">
          <span className="oa-field-label">
            <label htmlFor={inputId}>Target width</label>
            {dimensions && <span className="oa-value text-ink-3">Now {dimensions.width} px</span>}
          </span>
          <div className="oa-unit-input h-8 focus-within:shadow-[4px_4px_0_var(--oa-accent)]">
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={dimensions?.width ?? 0}
              max={20000}
              step={64}
              value={targetWidth ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setTargetWidth(v === "" ? null : Math.max(0, Number(v)));
              }}
              placeholder="7680"
              disabled={busy}
              aria-describedby={helpId}
            />
            <span aria-hidden>px</span>
          </div>
          <span id={helpId} className="oa-field-help">
            Auto-extend keeps extending to the right until the layer is this wide.
          </span>
        </div>
        <ChipGroup label="Presets">
          {PARALLAX_TARGET_PRESETS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              aria-pressed={targetWidth === p.value}
              onClick={() => setTargetWidth(p.value)}
              disabled={busy}
              title={p.hint}
              className="aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-text"
            >
              <span className="oa-value">{p.label}</span>
            </Button>
          ))}
        </ChipGroup>
        <div className="flex flex-col gap-1.5">
          <Progress value={progress * 100} label="Progress to target width" />
          {targetReached ? (
            <Badge tone="success" className="self-start">
              <Check aria-hidden />
              Target reached
            </Badge>
          ) : (
            <span className="oa-value text-ink-2">
              {remainingPx > 0 ? `${remainingPx} px to go` : "Set a target width to auto-extend"}
            </span>
          )}
        </div>
      </PanelSection>

      <PanelSection className="border-b-0">
        <span className="oa-field-label">Finish the layer</span>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            onClick={onMakeTileable}
            disabled={busy || !!makeTileableDisabled}
            title="Heal the loop seam so repeat-x scrolling has no visible joint"
          >
            <Repeat aria-hidden />
            Make tileable
          </Button>
          <Button
            size="sm"
            onClick={onHarmonize}
            disabled={busy || !!harmonizeDisabled}
            title="Even out colour and brightness drift across many extensions"
          >
            <Waves aria-hidden />
            Harmonize
          </Button>
        </div>
        <p className="text-xs leading-[18px] text-ink-2">
          Make tileable heals the loop seam for repeat-x scrolling. Harmonize evens out colour drift
          after many extensions.
        </p>
      </PanelSection>
    </>
  );
}
