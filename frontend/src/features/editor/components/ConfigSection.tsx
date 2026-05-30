"use client";

import { Sliders, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfigSectionProps {
  upscaleModel: "1x" | "2x" | "4x";
  setUpscaleModel: (model: "1x" | "2x" | "4x") => void;
  marginPadding: number;
  setMarginPadding: (padding: number) => void;
  namingPattern: string;
  setNamingPattern: (pattern: string) => void;
}

export function ConfigSection({
  upscaleModel,
  setUpscaleModel,
  marginPadding,
  setMarginPadding,
  namingPattern,
  setNamingPattern,
}: ConfigSectionProps) {
  return (
    <div className="flex-1 p-4 flex flex-col justify-between overflow-y-auto space-y-6 bg-black/10">
      
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-zinc-400 select-none pb-2 border-b border-zinc-800 font-mono">
          <Sliders className="h-4 w-4" />
          <span className="text-[10.5px] font-black uppercase tracking-widest">[ engine configs ]</span>
        </div>

        {/* 1: Upscaling Resolution Group */}
        <div className="space-y-2.5 font-mono">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Upscaling Model</span>
            {upscaleModel === "4x" && (
              <span className="text-[8px] text-[#ff7c00] font-black border border-[#ff7c00] px-1.5 py-0.5 rounded animate-pulse bg-orange-950/20">
                PRO_ONLY
              </span>
            )}
          </div>
          
          <div className="w-full flex border border-zinc-800 bg-zinc-950 rounded overflow-hidden text-[10px] font-black">
            {(["1x", "2x", "4x"] as const).map((model) => (
              <button
                key={model}
                onClick={() => setUpscaleModel(model)}
                className={cn(
                  "flex-1 py-2.5 text-center transition-colors cursor-pointer border-r border-zinc-800/80 last:border-none",
                  upscaleModel === model
                    ? "bg-[#ff7c00] text-black font-black"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
                )}
              >
                {model.toUpperCase()}
              </button>
            ))}
          </div>
          
          <p className="text-[10px] text-zinc-400 leading-relaxed select-none">
            {upscaleModel === "1x" 
              ? "Standard crop size. Fast execution, no resolution enhancements." 
              : upscaleModel === "2x" 
              ? "Cleans pixel bounds and upscales dimensions by 200% using neural models." 
              : "Super-Resolution neural upscale (400% size) with smart edge antialiasing."}
          </p>
        </div>

        {/* 2: Bounding Box Padding Margin Slider */}
        <div className="space-y-2.5 font-mono">
          <div className="flex items-center justify-between text-[10.5px] font-bold">
            <span className="text-zinc-400 uppercase tracking-wider">Margin Padding Buffer</span>
            <span className="text-white bg-[#ff7c00]/15 border border-[#ff7c00]/20 px-2 py-0.5 rounded text-[11px] font-black">{marginPadding}px</span>
          </div>
          <input
            type="range"
            min="0"
            max="16"
            step="2"
            value={marginPadding}
            onChange={(e) => setMarginPadding(Number(e.target.value))}
            className="w-full h-1.5 bg-zinc-950 rounded-lg appearance-none cursor-pointer accent-[#ff7c00] border border-zinc-800"
          />
          <p className="text-[10px] text-zinc-400 leading-relaxed select-none">
            Adds a solid transparent pixel spacing margin surrounding all extracted bounding boxes.
          </p>
        </div>

        {/* 3: Custom Systematic Naming Suffix */}
        <div className="space-y-2.5 font-mono">
          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider block">Naming Template Pattern</span>
          <input
            type="text"
            value={namingPattern}
            onChange={(e) => setNamingPattern(e.target.value)}
            placeholder="asset_[label]_[idx]"
            className="block w-full text-[11.5px] font-mono border border-zinc-800 rounded bg-zinc-950 text-white px-3 py-2 focus:outline-none focus:border-[#ff7c00] transition-colors"
          />
          
          <div className="p-3 border border-zinc-800 bg-zinc-950/60 rounded space-y-1.5 select-none">
            <span className="text-[8.5px] text-zinc-500 font-black block uppercase tracking-wider">// Suffix Preview Slices:</span>
            {/* Highly readable color preview for high contrast */}
            <span className="text-[12px] text-[#ff7c00] font-black block font-mono">
              {namingPattern
                .replace("[label]", "sprite_item")
                .replace("[idx]", "001")}.png
            </span>
          </div>
        </div>

        {/* 4: Hardware CUDA status meters */}
        <div className="pt-3 border-t border-zinc-800 space-y-2.5 font-mono select-none">
          <span className="text-[9px] text-zinc-500 font-black uppercase tracking-widest block">// Hardware Status Matrix</span>
          <div className="grid grid-cols-2 gap-2.5 text-[8.5px] font-bold">
            <div className="p-2 bg-black border border-zinc-800 rounded flex items-center justify-between">
              <span className="text-zinc-500">CV_ENGINE:</span>
              <span className="text-[#00ff66] font-black">CUDA_OK</span>
            </div>
            <div className="p-2 bg-black border border-zinc-800 rounded flex items-center justify-between">
              <span className="text-zinc-500">LLM_CORES:</span>
              <span className="text-[#00ff66] font-black">FLASH_OK</span>
            </div>
          </div>
        </div>

      </div>

      <div className="pt-6 select-none shrink-0 font-mono">
        <span className="inline-flex items-start gap-2 text-[10px] text-zinc-400 leading-relaxed">
          <Shield className="h-3.5 w-3.5 text-[#ff7c00] shrink-0 mt-0.5" />
          <span>Config details are compiled locally and saved to active worker thread.</span>
        </span>
      </div>

    </div>
  );
}
