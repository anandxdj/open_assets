"use client";

import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DetectionModeControl } from "./DetectionModeControl";
import type { DetectionControls } from "./PropertiesPanel";

/** Floating warning at the top of the canvas when detection needs a second try. */
export function ReviewNotice({
  wholeSheet,
  warning,
  detection,
  onDismiss,
  className,
}: {
  /** The detector returned one box covering the whole sheet. */
  wholeSheet: boolean;
  /** Warning text from the detector, if any. */
  warning?: string;
  detection: DetectionControls;
  onDismiss: () => void;
  className?: string;
}) {
  const title = wholeSheet ? "The whole sheet came back as one box" : "Check these boxes";
  const body = wholeSheet
    ? "The background probably blends with the art. Tell us what it is and detect again."
    : warning;

  return (
    <div
      role="region"
      aria-label="Detection review"
      className={cn("oa-float w-[min(560px,calc(100%-32px))] items-start gap-3 py-3.5 pl-4 pr-2", className)}
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 flex-none text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div role="alert" className="flex flex-col gap-0.5">
          <p className="text-xs font-medium">{title}</p>
          {body && <p className="text-[11px] leading-4 text-ink-2">{body}</p>}
          {wholeSheet && warning && <p className="text-[11px] leading-4 text-ink-2">{warning}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DetectionModeControl
            mode={detection.mode}
            onModeChange={detection.onModeChange}
            colour={detection.colour}
            onColourChange={detection.onColourChange}
            disabled={detection.redetecting}
          />
          <Button
            variant="secondary"
            size="sm"
            aria-disabled={detection.redetecting || undefined}
            aria-busy={detection.redetecting || undefined}
            onClick={detection.onRedetect}
          >
            {detection.redetecting && <LoaderCircle aria-hidden className="animate-spin" />}
            {detection.redetecting ? "Detecting" : "Detect again"}
          </Button>
        </div>
      </div>
      <Button variant="ghost" size="sm" icon aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
