"use client";

import { Trash2 } from "lucide-react";
import type { BoundingBox } from "@/types";
import { cn } from "@/lib/utils";

interface DetectionsSectionProps {
  boxes: BoundingBox[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BoundingBox>) => void;
  onDelete: (id: string) => void;
  onDeleteSelected: () => void;
}

export function DetectionsSection({
  boxes,
  selectedIds,
  onToggle,
  onUpdate,
  onDelete,
  onDeleteSelected,
}: DetectionsSectionProps) {
  // Single selection editor block
  const editBox = selectedIds.size === 1
    ? boxes.find((b) => selectedIds.has(b.id)) ?? null
    : null;

  return (
    <div className="flex-1 flex flex-col justify-between overflow-hidden min-h-[250px]">
      
      {/* 1: Header metadata */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2 select-none shrink-0 bg-black/30">
        <div>
          <p className="text-[11px] font-black text-zinc-300 uppercase tracking-widest font-mono">
            {boxes.length} bounds detected
          </p>
          {selectedIds.size > 0 && (
            <p className="text-[10px] text-[#ff7c00] font-black uppercase mt-0.5 animate-pulse font-mono">
              {selectedIds.size} selected
            </p>
          )}
        </div>
        {selectedIds.size > 1 && (
          <button
            onClick={onDeleteSelected}
            className="flex items-center gap-1.5 text-[10px] text-red-400 hover:text-red-300 px-2.5 py-1 rounded border border-red-500/20 hover:bg-red-500/5 transition-colors uppercase font-bold font-mono cursor-pointer"
          >
            <Trash2 size={11} />
            Delete
          </button>
        )}
      </div>

      {/* 2: Scrollable box coordinates list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 bg-black/10">
        {boxes.map((box) => {
          const selected = selectedIds.has(box.id);
          return (
            <div
              key={box.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 border rounded transition-all duration-150 group",
                selected 
                  ? "bg-orange-950/10 border-orange-500/30 shadow-[0_0_8px_rgba(255,124,0,0.05)]" 
                  : "bg-transparent border-transparent hover:bg-zinc-900/60"
              )}
            >
              <button
                className="flex items-center gap-3 flex-1 text-left min-w-0 cursor-pointer"
                onClick={() => onToggle(box.id)}
              >
                {/* Clean, high-visibility styled checkbox */}
                <div
                  className={cn(
                    "w-4 h-4 rounded-none border flex items-center justify-center flex-shrink-0 transition-all duration-100",
                    selected 
                      ? "bg-[#ff7c00] border-[#ff7c00] text-black shadow-[0_0_6px_rgba(255,124,0,0.3)]" 
                      : "border-zinc-600 hover:border-zinc-400 bg-zinc-950"
                  )}
                >
                  {selected && (
                    <div className="w-1.5 h-1.5 bg-black rounded-none" />
                  )}
                </div>

                <div className="min-w-0">
                  {/* Larger text size & brighter color */}
                  <p className={cn(
                    "text-[12.5px] font-black truncate leading-snug font-mono tracking-wide", 
                    selected ? "text-white" : "text-zinc-200"
                  )}>
                    {box.label ?? box.id}
                  </p>
                  {/* Brighter dimension styling for high visibility */}
                  <p className="text-[10px] text-zinc-400 font-bold font-mono tracking-wider mt-0.5">
                    {Math.round(box.width)} × {Math.round(box.height)}px
                  </p>
                </div>
              </button>
              
              <button
                onClick={() => onDelete(box.id)}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all p-1 flex-shrink-0 cursor-pointer"
                aria-label="Delete box"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
        {boxes.length === 0 && (
          <div className="text-[10px] text-zinc-500 text-center py-12 px-4 uppercase leading-relaxed font-mono select-none">
            // No bounds isolated.<br />
            <span className="text-zinc-600 text-[9px] mt-1 block">Use selection box or canvas draw tool.</span>
          </div>
        )}
      </div>





    </div>
  );
}
