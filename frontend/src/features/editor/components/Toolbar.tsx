"use client";

import { Hand, MousePointer2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tool } from "../hooks/useCanvasEditor";

interface Props {
  activeTool: Tool;
  onToolChange: (t: Tool) => void;
  excludeDraw?: boolean;
}

const TOOLS: { id: Tool; icon: React.ElementType; label: string; key: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", key: "V" },
  { id: "hand",   icon: Hand,          label: "Hand",   key: "H" },
  { id: "draw",   icon: Square,        label: "Draw box", key: "R" },
];

export function Toolbar({ activeTool, onToolChange, excludeDraw = false }: Props) {
  const toolsToRender = excludeDraw ? TOOLS.filter((t) => t.id !== "draw") : TOOLS;

  return (
    <div className="flex items-center gap-1 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 rounded-full px-2 py-2 shadow-xl">
      {toolsToRender.map((tool) => {
        const Icon = tool.icon;
        const active = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            title={`${tool.label} (${tool.key})`}
            onClick={() => onToolChange(tool.id)}
            className={cn(
              "w-8 h-8 rounded-md flex items-center justify-center transition-colors",
              active
                ? "bg-indigo-500/20 text-indigo-400"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

