"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Image workspace: checkerboard frame, clickable edge handles per direction,
// dimension pill, status, and result actions.

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Direction } from "@/features/studio/lib/app";
import { StatusPill } from "@/features/studio/components/StatusPill";

export function EdgeHandle({
  direction,
  onClick,
  active,
  disabled,
}: {
  direction: Direction;
  onClick: (d: Direction) => void;
  active: boolean;
  disabled: boolean;
}) {
  const Icon = {
    up: ArrowUp,
    down: ArrowDown,
    left: ArrowLeft,
    right: ArrowRight,
  }[direction];

  const position: React.CSSProperties = {
    up: { top: -22, left: "50%", transform: "translateX(-50%)" },
    down: { bottom: -22, left: "50%", transform: "translateX(-50%)" },
    left: { left: -22, top: "50%", transform: "translateY(-50%)" },
    right: { right: -22, top: "50%", transform: "translateY(-50%)" },
  }[direction];

  return (
    <button
      onClick={() => onClick(direction)}
      disabled={disabled}
      title={`Extend ${direction}`}
      aria-label={`Extend ${direction}`}
      style={position}
      className={cn(
        "absolute z-10 flex h-11 w-11 items-center justify-center border-2 rounded-none transition-all duration-150",
        active
          ? "border-zinc-950 dark:border-white bg-zinc-950 text-white dark:bg-white dark:text-black animate-pulse"
          : "border-zinc-950 dark:border-zinc-700 bg-background text-muted-foreground hover:bg-zinc-950 hover:text-white dark:hover:bg-white dark:hover:text-black",
        disabled && !active && "opacity-40 cursor-not-allowed",
        disabled && "cursor-not-allowed",
      )}
    >
      <Icon size={18} />
    </button>
  );
}

export function Workspace({
  image,
  dimensions,
  onExtend,
  activeDirection,
  loading,
  progressMessage,
  isResult,
  resultMessage,
  variantSelector,
  resultActions,
}: {
  image: string;
  dimensions: { width: number; height: number } | null;
  onExtend: (d: Direction) => void;
  activeDirection: Direction | null;
  loading: boolean;
  progressMessage?: string | null;
  isResult: boolean;
  resultMessage?: string;
  variantSelector?: React.ReactNode;
  resultActions?: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-6 pt-2 font-mono">
      <div className="relative max-h-[calc(100vh-280px)] max-w-[min(1200px,calc(100vw-96px))]">
        <div className="relative overflow-hidden border-2 border-zinc-950 dark:border-zinc-700 bg-[repeating-conic-gradient(#80808033_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt=""
            className="block max-h-[calc(100vh-280px)] max-w-[min(1200px,calc(100vw-96px))] object-contain"
            draggable={false}
          />
        </div>

        {!isResult && (
          <>
            <EdgeHandle direction="up" onClick={onExtend} active={activeDirection === "up"} disabled={loading} />
            <EdgeHandle direction="down" onClick={onExtend} active={activeDirection === "down"} disabled={loading} />
            <EdgeHandle direction="left" onClick={onExtend} active={activeDirection === "left"} disabled={loading} />
            <EdgeHandle direction="right" onClick={onExtend} active={activeDirection === "right"} disabled={loading} />
          </>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        {dimensions && (
          <div className="border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
            {dimensions.width} × {dimensions.height}
          </div>
        )}
        {isResult && variantSelector}
        {isResult && resultMessage && <StatusPill status="ok" message={resultMessage} />}
        {!isResult && !loading && (
          <span className="text-[11px] uppercase text-muted-foreground">
            Click an edge to extend · arrow keys work too
          </span>
        )}
        {loading && (
          <StatusPill
            status="working"
            message={progressMessage || (activeDirection ? `Extending ${activeDirection}…` : "Working…")}
          />
        )}
      </div>

      {isResult && resultActions && <div className="mt-4">{resultActions}</div>}
    </div>
  );
}
