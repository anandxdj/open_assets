"use client";

import { Minus, Plus, Maximize2 } from "lucide-react";

interface Props {
  zoom: number;
  onZoom: (newZoom: number) => void;
  onFit: () => void;
}

export function ZoomControls({ zoom, onZoom, onFit }: Props) {
  const pct = Math.round(zoom * 100);

  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 rounded-lg px-1.5 py-1 shadow-lg">
      <button
        title="Zoom out"
        onClick={() => onZoom(zoom * 0.8)}
        className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
      >
        <Minus size={12} />
      </button>

      <span className="text-xs text-zinc-400 tabular-nums w-9 text-center select-none">
        {pct}%
      </span>

      <button
        title="Zoom in"
        onClick={() => onZoom(zoom * 1.25)}
        className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
      >
        <Plus size={12} />
      </button>

      <div className="w-px h-3 bg-zinc-700 mx-0.5" />

      <button
        title="Fit to screen"
        onClick={onFit}
        className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
      >
        <Maximize2 size={12} />
      </button>
    </div>
  );
}
