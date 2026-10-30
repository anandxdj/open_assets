"use client";

import { useState } from "react";
import { Check, CircleAlert, Download, LoaderCircle, MoveHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress, Range, Segmented } from "@/components/ui/controls";
import type { AiPhase, AiRunResult } from "@/features/enhance/hooks/useAiEnhance";
import { formatSize, type Size } from "@/features/enhance/lib/aiLimits";

type View = "side" | "slider";

const VIEW_OPTIONS = [
  { value: "side" as const, label: "Side by side" },
  { value: "slider" as const, label: "Slider" },
];

function naturalSize(image: HTMLImageElement): Size {
  return { width: image.naturalWidth, height: image.naturalHeight };
}

const STAGE_PHASES: Record<"uploading" | "storing" | "working", string> = {
  uploading: "Uploading",
  storing: "Storing the image",
  working: "Enhancing",
};

export function AiComparePane({
  sourceUrl,
  sourceSize,
  onSourceSize,
  phase,
  uploadProgress,
  elapsed,
  result,
  resultSize,
  onResultSize,
  onCancel,
  downloadName,
}: {
  sourceUrl: string;
  sourceSize: Size | null;
  onSourceSize: (size: Size) => void;
  phase: AiPhase;
  uploadProgress: number;
  elapsed: number;
  result: AiRunResult | null;
  resultSize: Size | null;
  onResultSize: (size: Size) => void;
  onCancel: () => void;
  downloadName: string;
}) {
  const [view, setView] = useState<View>("side");
  const [position, setPosition] = useState(50);
  const ready = phase === "ready" && result !== null;
  const busy = phase === "uploading" || phase === "storing" || phase === "working";

  return (
    <>
      {ready && (
        <div className="flex min-h-11 flex-none flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-1.5">
          <Segmented ariaLabel="Compare view" value={view} options={VIEW_OPTIONS} onChange={setView} />
          <Button asChild variant="primary" size="sm">
            <a href={result.url} download={downloadName}>
              <Download aria-hidden />
              Download PNG
            </a>
          </Button>
        </div>
      )}

      {ready && view === "slider" ? (
        <figure className="flex min-h-[380px] flex-1 flex-col bg-page">
          <figcaption className="flex h-10 flex-none items-center justify-between gap-3 px-4">
            <span className="flex items-center gap-2">
              <span className="oa-label text-ink">Compare</span>
              <Badge tone="success">
                <Check aria-hidden />
                Done
              </Badge>
            </span>
            <span className="oa-value text-ink-3">
              {[formatSize(sourceSize), formatSize(resultSize)].filter(Boolean).join(" → ")}
            </span>
          </figcaption>
          <div className="oa-checker relative mx-4 mb-4 min-h-[320px] flex-1 overflow-hidden border border-line focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceUrl}
              alt="Original artwork"
              onLoad={(event) => onSourceSize(naturalSize(event.currentTarget))}
              className="absolute inset-0 size-full object-contain p-6"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.url}
              alt="Enhanced artwork"
              onLoad={(event) => onResultSize(naturalSize(event.currentTarget))}
              className="absolute inset-0 size-full object-contain p-6"
              style={{ clipPath: `inset(0 0 0 ${position}%)` }}
            />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand" style={{ left: `${position}%` }} />
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center border-[1.5px] border-line-strong bg-brand text-brand-fg"
              style={{ left: `${position}%` }}
            >
              <MoveHorizontal className="size-4" />
            </span>
            <Badge className="absolute left-2 top-2 bg-surface text-ink">Original</Badge>
            <Badge className="absolute right-2 top-2 bg-surface text-ink">Enhanced</Badge>
            {/* A transparent full-size slider: drag anywhere, or use the arrow keys. */}
            <Range
              aria-label="Compare original and enhanced"
              aria-valuetext={`${position} percent original`}
              min={0}
              max={100}
              step={1}
              value={position}
              onChange={(event) => setPosition(Number(event.target.value))}
              className="absolute inset-0 size-full cursor-ew-resize touch-pan-y opacity-0"
            />
          </div>
        </figure>
      ) : (
        <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-px bg-line">
          <figure className="flex min-h-[340px] flex-col bg-page">
            <figcaption className="flex h-10 flex-none items-center justify-between gap-3 px-4">
              <span className="oa-label text-ink">Original</span>
              <span className="oa-value text-ink-3">{formatSize(sourceSize)}</span>
            </figcaption>
            <div className="oa-checker relative mx-4 mb-4 min-h-[300px] flex-1 overflow-hidden border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceUrl}
                alt="Original artwork"
                onLoad={(event) => onSourceSize(naturalSize(event.currentTarget))}
                className="absolute inset-0 size-full object-contain p-6"
              />
            </div>
          </figure>

          <figure className="flex min-h-[340px] flex-col bg-page">
            <figcaption className="flex h-10 flex-none items-center justify-between gap-3 px-4">
              <span className="flex items-center gap-2">
                <span className="oa-label text-ink">Enhanced</span>
                {ready && (
                  <Badge tone="success">
                    <Check aria-hidden />
                    Done
                  </Badge>
                )}
              </span>
              <span className="oa-value text-ink-3">{ready ? formatSize(resultSize) : ""}</span>
            </figcaption>
            <div className="oa-checker relative mx-4 mb-4 flex min-h-[300px] flex-1 items-center justify-center overflow-hidden border border-line">
              {busy ? (
                <div className="flex w-full max-w-[260px] flex-col items-center gap-3 bg-surface px-4 py-5 text-center">
                  <LoaderCircle aria-hidden className="size-8 animate-spin text-ink" />
                  <span className="text-xs leading-[18px] text-ink">
                    {STAGE_PHASES[phase as keyof typeof STAGE_PHASES]}
                    {phase === "uploading" ? ` · ${uploadProgress}%` : "…"}
                  </span>
                  {phase === "uploading" ? (
                    <Progress value={uploadProgress} label="Upload progress" className="w-full" />
                  ) : (
                    <span className="text-[11px] leading-4 text-ink-3">
                      {elapsed} s · large images can take a minute or two
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={onCancel}>
                    {phase === "uploading" ? "Cancel" : "Stop waiting"}
                  </Button>
                </div>
              ) : ready ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.url}
                  alt="Enhanced artwork"
                  onLoad={(event) => onResultSize(naturalSize(event.currentTarget))}
                  className="absolute inset-0 size-full object-contain p-6"
                />
              ) : phase === "failed" ? (
                <p className="flex max-w-[240px] flex-col items-center gap-2 bg-surface px-4 py-3 text-center text-xs leading-[18px] text-ink-2">
                  <CircleAlert aria-hidden className="size-5 text-danger" />
                  That did not work. The reason is next to the Enhance button.
                </p>
              ) : (
                <p className="max-w-[240px] bg-surface px-4 py-3 text-center text-xs leading-[18px] text-ink-2">
                  Choose your options, then press Enhance image to see the result here.
                </p>
              )}
            </div>
          </figure>
        </div>
      )}
    </>
  );
}
