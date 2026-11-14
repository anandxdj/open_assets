"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Zoom group: out, current percentage (click to fit), in. */
export function ZoomControls({
  zoom,
  onZoom,
  onFit,
  className,
}: {
  zoom: number;
  onZoom: (newZoom: number) => void;
  onFit: () => void;
  className?: string;
}) {
  const pct = Math.round(zoom * 100);

  return (
    <div role="group" aria-label="Zoom" data-canvas-controls className={cn("oa-float p-0.5", className)}>
      <button type="button" className="oa-tool" aria-label="Zoom out" title="Zoom out" onClick={() => onZoom(zoom * 0.8)}>
        <Minus aria-hidden />
      </button>
      <button
        type="button"
        className="oa-btn oa-btn-ghost oa-btn-sm min-w-14 px-1.5 tabular-nums"
        aria-label={`Zoom ${pct}%. Fit to screen (Ctrl+0)`}
        title="Fit to screen (Ctrl+0)"
        onClick={onFit}
      >
        {pct}%
      </button>
      <button type="button" className="oa-tool" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(zoom * 1.25)}>
        <Plus aria-hidden />
      </button>
    </div>
  );
}
