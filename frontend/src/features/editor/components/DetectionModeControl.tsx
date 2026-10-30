"use client";

import { Segmented } from "@/components/ui/controls";
import type { DetectionMode } from "@/features/upload/services/uploadApi";
import { cn } from "@/lib/utils";

/**
 * Background choice for re-detection: Auto, Dark, Light or a picked colour.
 * Shared by the review notice on the canvas and the Properties panel.
 */
export function DetectionModeControl({
  mode,
  onModeChange,
  colour,
  onColourChange,
  block,
  pickLabel = "Pick colour",
  disabled,
  className,
}: {
  mode: DetectionMode;
  onModeChange: (mode: DetectionMode) => void;
  colour: string;
  onColourChange: (colour: string) => void;
  block?: boolean;
  pickLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", block && "flex-col items-stretch", className)}>
      <Segmented<DetectionMode>
        ariaLabel="Sheet background"
        value={mode}
        onChange={onModeChange}
        block={block}
        options={[
          { value: "auto", label: "Auto", disabled },
          { value: "dark", label: "Dark", disabled },
          { value: "light", label: "Light", disabled },
          {
            value: "sampled",
            label: pickLabel,
            disabled,
            icon: <span aria-hidden className="size-2.5 flex-none border border-line-strong" style={{ background: colour }} />,
          },
        ]}
      />
      {mode === "sampled" && (
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input
            type="color"
            value={colour}
            disabled={disabled}
            onChange={(e) => onColourChange(e.target.value)}
            className="h-7 w-9 flex-none cursor-pointer border-[1.5px] border-line-strong bg-surface p-0.5"
          />
          <span>
            Background colour <span className="oa-value text-ink">{colour.toUpperCase()}</span>
          </span>
        </label>
      )}
    </div>
  );
}
