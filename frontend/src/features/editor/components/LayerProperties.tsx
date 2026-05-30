"use client";

import { Trash2 } from "lucide-react";
import type { BoundingBox } from "@/types";

interface Props {
  box: BoundingBox;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onUpdate: (id: string, patch: Partial<BoundingBox>) => void;
  onDelete: (id: string) => void;
}

// LiveCropThumbnail: dynamic CSS-based preview of the bounding box area in real-time
function LiveCropThumbnail({
  imageUrl,
  box,
  imageWidth,
  imageHeight,
  size = 64
}: {
  imageUrl: string;
  box: BoundingBox;
  imageWidth: number;
  imageHeight: number;
  size?: number;
}) {
  const scale = Math.min(size / (box.width || 1), size / (box.height || 1));
  const w = box.width * scale;
  const h = box.height * scale;

  return (
    <div 
      className="relative bg-zinc-950 border border-zinc-800 rounded overflow-hidden flex items-center justify-center shrink-0 select-none shadow-[inset_0_0_10px_rgba(0,0,0,0.8)]"
      style={{ width: size, height: size }}
    >
      <div 
        className="relative overflow-hidden" 
        style={{ width: w, height: h }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img 
          src={imageUrl} 
          alt={box.label || "crop preview"} 
          className="absolute max-w-none origin-top-left"
          style={{
            left: -box.x * scale,
            top: -box.y * scale,
            width: imageWidth * scale,
            height: imageHeight * scale,
          }}
        />
      </div>
    </div>
  );
}

export function LayerProperties({
  box,
  imageUrl,
  imageWidth,
  imageHeight,
  onUpdate,
  onDelete
}: Props) {
  return (
    <div className="p-4 space-y-5 bg-black/10 select-none">
      
      {/* Real-time large image crop viewport */}
      <div className="flex justify-center py-6 border border-zinc-900 bg-zinc-950/65 rounded-md relative group">
        <div className="absolute top-2 left-3 text-[8px] text-zinc-500 font-black uppercase tracking-widest select-none">
          Live Viewport
        </div>
        <LiveCropThumbnail
          imageUrl={imageUrl}
          box={box}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          size={160}
        />
      </div>

      {/* Layer Name Input */}
      <div className="space-y-1.5 font-mono">
        <span className="text-[9.5px] text-zinc-400 font-bold uppercase tracking-wider block">Layer Label</span>
        <input
          type="text"
          value={box.label || (box as any).name || box.id.slice(0, 8)}
          onChange={(e) => onUpdate(box.id, { label: e.target.value })}
          className="block w-full text-[11px] font-mono border border-zinc-850 rounded bg-zinc-950 text-white px-3 py-2 focus:outline-none focus:border-[#ff7c00] transition-colors"
          placeholder="layer_label"
        />
      </div>

      {/* Grid coordinates editor */}
      <div className="space-y-2 font-mono">
        <span className="text-[9.5px] text-zinc-400 font-bold uppercase tracking-wider block font-sans">Bounds Matrix</span>
        <div className="grid grid-cols-2 gap-3 text-[10px]">
          
          {/* Coordinate X */}
          <div className="flex items-center gap-2 border border-zinc-850 bg-zinc-950 px-2.5 py-1.5 rounded">
            <span className="text-zinc-500 font-black select-none">X</span>
            <input
              type="number"
              value={Math.round(box.x)}
              onChange={(e) => onUpdate(box.id, { x: Number(e.target.value) })}
              className="w-full bg-transparent border-none text-white focus:outline-none text-right font-mono"
            />
          </div>

          {/* Coordinate Y */}
          <div className="flex items-center gap-2 border border-zinc-850 bg-zinc-950 px-2.5 py-1.5 rounded">
            <span className="text-zinc-500 font-black select-none">Y</span>
            <input
              type="number"
              value={Math.round(box.y)}
              onChange={(e) => onUpdate(box.id, { y: Number(e.target.value) })}
              className="w-full bg-transparent border-none text-white focus:outline-none text-right font-mono"
            />
          </div>

          {/* Bounds Width */}
          <div className="flex items-center gap-2 border border-zinc-850 bg-zinc-950 px-2.5 py-1.5 rounded">
            <span className="text-zinc-500 font-black select-none">W</span>
            <input
              type="number"
              value={Math.round(box.width)}
              onChange={(e) => onUpdate(box.id, { width: Number(e.target.value) })}
              className="w-full bg-transparent border-none text-white focus:outline-none text-right font-mono"
            />
          </div>

          {/* Bounds Height */}
          <div className="flex items-center gap-2 border border-zinc-850 bg-zinc-950 px-2.5 py-1.5 rounded">
            <span className="text-zinc-500 font-black select-none">H</span>
            <input
              type="number"
              value={Math.round(box.height)}
              onChange={(e) => onUpdate(box.id, { height: Number(e.target.value) })}
              className="w-full bg-transparent border-none text-white focus:outline-none text-right font-mono"
            />
          </div>

        </div>
      </div>

      {/* Delete layer action trigger */}
      <div className="pt-2">
        <button
          onClick={() => onDelete(box.id)}
          className="w-full py-2.5 border border-red-950/60 bg-red-950/10 hover:bg-red-950/20 text-red-400 hover:text-red-300 font-bold uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5 transition-colors duration-150 cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Layer
        </button>
      </div>

    </div>
  );
}
