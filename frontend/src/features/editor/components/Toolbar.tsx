"use client";

import { SquareDashedMousePointer, Contrast, Hand, MousePointer2, SquareDashed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tool } from "../hooks/useCanvasEditor";

const TOOLS: { id: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", key: "V" },
  { id: "marquee", icon: SquareDashedMousePointer, label: "Select area", key: "M" },
  { id: "hand", icon: Hand, label: "Hand", key: "H" },
  { id: "draw", icon: SquareDashed, label: "Draw box", key: "R" },
];

/** Floating tool bar at the bottom centre of the canvas. Arrow keys move between its buttons. */
export function Toolbar({
  activeTool,
  onToolChange,
  dimOutside,
  onDimOutsideChange,
  extra,
  className,
}: {
  activeTool: Tool;
  onToolChange: (t: Tool) => void;
  /** Shade everything outside the boxes. */
  dimOutside: boolean;
  onDimOutsideChange: (on: boolean) => void;
  /** More buttons at the end of the bar (the Backdrop menu). Keep each one a plain `button` with tabIndex -1. */
  extra?: React.ReactNode;
  className?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Menus open from the bar render elsewhere in the DOM but bubble here; leave their keys alone.
    if (!e.currentTarget.contains(e.target as Node)) return;
    // Keep the arrow from nudging selected boxes.
    e.preventDefault();
    e.stopPropagation();
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const current = buttons.findIndex((el) => el === document.activeElement);
    const step = e.key === "ArrowRight" ? 1 : -1;
    buttons[(Math.max(current, 0) + step + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="horizontal"
      data-canvas-controls
      className={cn("oa-float", className)}
      onKeyDown={onKeyDown}
    >
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            className="oa-tool"
            aria-label={`${tool.label} (${tool.key})`}
            title={`${tool.label} (${tool.key})`}
            aria-pressed={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onToolChange(tool.id)}
          >
            <Icon aria-hidden />
          </button>
        );
      })}
      <span aria-hidden className="oa-vsep" />
      <button
        type="button"
        className="oa-tool"
        aria-label="Dim outside boxes"
        title="Dim outside boxes"
        aria-pressed={dimOutside}
        tabIndex={-1}
        onClick={() => onDimOutsideChange(!dimOutside)}
      >
        <Contrast aria-hidden />
      </button>
      {extra}
    </div>
  );
}
