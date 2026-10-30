"use client";

import { useRef } from "react";
import { Hand, MousePointer2, SquareDashed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tool } from "../hooks/useCanvasEditor";

const TOOLS: { id: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", key: "V" },
  { id: "hand", icon: Hand, label: "Hand", key: "H" },
  { id: "draw", icon: SquareDashed, label: "Draw box", key: "R" },
];

/** Floating tool bar at the bottom centre of the canvas. Arrow keys move between tools. */
export function Toolbar({
  activeTool,
  onToolChange,
  className,
}: {
  activeTool: Tool;
  onToolChange: (t: Tool) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Keep the arrow from nudging selected boxes.
    e.preventDefault();
    e.stopPropagation();
    const current = refs.current.findIndex((el) => el === document.activeElement);
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = (Math.max(current, 0) + step + TOOLS.length) % TOOLS.length;
    refs.current[next]?.focus();
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
      {TOOLS.map((tool, i) => {
        const Icon = tool.icon;
        const active = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
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
    </div>
  );
}
