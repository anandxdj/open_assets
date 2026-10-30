"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Extender stage: the image on a checkerboard with an extend button on each
// edge, the size badge, and a slot for the floating review bar.

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Direction } from "@/features/studio/lib/app";

export const EDGE_NAME: Record<Direction, string> = {
  up: "top",
  down: "bottom",
  left: "left",
  right: "right",
};

const EDGE_ICON = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight } as const;

const EDGE_KEY: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };

export function EdgeHandle({
  direction,
  onClick,
  active,
  disabled,
  className,
}: {
  direction: Direction;
  onClick: (d: Direction) => void;
  active: boolean;
  disabled: boolean;
  className?: string;
}) {
  const Icon = EDGE_ICON[direction];
  const label = `Extend ${EDGE_NAME[direction]}`;
  return (
    <Button
      variant="secondary"
      icon
      onClick={() => onClick(direction)}
      disabled={disabled}
      aria-label={label}
      title={`${label} (${EDGE_KEY[direction]})`}
      className={cn(active && "bg-inverse text-inverse-fg disabled:opacity-100", className)}
    >
      {active ? <LoaderCircle aria-hidden className="animate-spin" /> : <Icon aria-hidden />}
    </Button>
  );
}

export function Workspace({
  image,
  dimensions,
  onExtend,
  activeDirection,
  loading,
  isResult,
  overlay,
}: {
  image: string;
  dimensions: { width: number; height: number } | null;
  onExtend: (d: Direction) => void;
  activeDirection: Direction | null;
  loading: boolean;
  isResult: boolean;
  /** Floating bar pinned to the bottom of the stage (variant review). */
  overlay?: React.ReactNode;
}) {
  const handle = (d: Direction) =>
    isResult ? null : (
      <EdgeHandle direction={d} onClick={onExtend} active={activeDirection === d} disabled={loading} />
    );

  return (
    <div className="oa-stage flex min-h-[420px] flex-1 flex-col items-center justify-center px-4 pb-24 pt-12 md:px-6">
      {dimensions && (
        <Badge className="absolute left-3 top-3 bg-surface">
          <span className="oa-value">
            {dimensions.width} × {dimensions.height}
          </span>
        </Badge>
      )}
      <div className="grid max-w-full grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)_auto] items-center justify-items-center gap-2">
        <div className="col-start-2 row-start-1 h-8">{handle("up")}</div>
        <div className="col-start-1 row-start-2 w-8">{handle("left")}</div>
        <div className="oa-checker col-start-2 row-start-2 max-w-full border-[1.5px] border-line-strong">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={isResult ? "Extended image preview" : "Current image"}
            draggable={false}
            className="block max-h-[max(220px,calc(100dvh-320px))] max-w-full object-contain"
          />
        </div>
        <div className="col-start-3 row-start-2 w-8">{handle("right")}</div>
        <div className="col-start-2 row-start-3 h-8">{handle("down")}</div>
      </div>
      {overlay && (
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">{overlay}</div>
      )}
    </div>
  );
}
