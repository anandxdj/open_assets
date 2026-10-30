"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Floating review bar for a fresh extension: cycle variants, then discard,
// regenerate, download or use it as the new base image.

import { Check, ChevronLeft, ChevronRight, Download, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function VariantSelector({
  index,
  total,
  isBest,
  score,
  onPrev,
  onNext,
  onAccept,
  onRegenerate,
  onDiscard,
  onDownload,
  loading,
  className,
}: {
  index: number;
  total: number;
  /** True when the current variant is the algorithm-picked best blend. */
  isBest: boolean;
  /** Optional raw seam score, only passed in debug mode. */
  score?: number;
  onPrev: () => void;
  onNext: () => void;
  onAccept: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
  onDownload: () => void;
  loading: boolean;
  className?: string;
}) {
  const multi = total > 1;
  return (
    <div
      role="group"
      aria-label="Review extension"
      className={cn("oa-float max-w-[calc(100%-24px)] flex-wrap justify-center gap-y-1", className)}
    >
      {multi && (
        // Own row, so the bar never wraps with a divider stranded mid-line.
        <div className="flex basis-full flex-wrap items-center justify-center gap-x-1.5 border-b border-rule pb-1">
          <div role="group" aria-label="Variants" className="flex items-center gap-0.5">
            <button
              type="button"
              className="oa-tool disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onPrev}
              disabled={loading}
              aria-label="Previous variant"
              title="Previous variant (←)"
            >
              <ChevronLeft aria-hidden />
            </button>
            <span className="oa-value whitespace-nowrap px-1 text-ink-2" aria-live="polite">
              Variant {index + 1} of {total}
            </span>
            <button
              type="button"
              className="oa-tool disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onNext}
              disabled={loading}
              aria-label="Next variant"
              title="Next variant (→)"
            >
              <ChevronRight aria-hidden />
            </button>
          </div>
          {isBest && (
            <Badge tone="success" title="Lowest seam difference of the variants">
              <Check aria-hidden />
              Algorithm&apos;s pick
            </Badge>
          )}
          {typeof score === "number" && (
            <span
              className="oa-value px-1 text-ink-3"
              title="Mean colour difference at the seam. Lower is better."
            >
              Seam {score.toFixed(1)}
            </span>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={onDiscard} disabled={loading} title="Discard (Esc)">
        <X aria-hidden />
        Discard
      </Button>
      <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={loading} title="Regenerate (R)">
        {loading ? <LoaderCircle aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
        Regenerate
      </Button>
      <Button variant="ghost" size="sm" onClick={onDownload} disabled={loading}>
        <Download aria-hidden />
        Download PNG
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={onAccept}
        disabled={loading}
        title="Use as new base (Enter)"
        className="ml-1"
      >
        <Check aria-hidden />
        Use as new base
      </Button>
    </div>
  );
}
