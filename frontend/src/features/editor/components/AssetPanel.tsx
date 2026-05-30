"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, X, Zap, Scissors } from "lucide-react";
import type { BoundingBox } from "@/types";
import { cn } from "@/lib/utils";

// Service & Component Imports
import { startExport } from "@/features/editor/services/exportApi";
import { exportBoxesAsZip } from "@/features/editor/services/localExport";
import { DetectionsSection } from "./DetectionsSection";

interface Props {
  jobId: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  boxes: BoundingBox[];
  selectedIds: Set<string>;
  jobStatus: string;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BoundingBox>) => void;
  onDelete: (id: string) => void;
  onDeleteSelected: () => void;
}

export function AssetPanel({
  jobId,
  imageUrl,
  boxes,
  selectedIds,
  onToggle,
  onUpdate,
  onDelete,
  onDeleteSelected,
}: Props) {
  const router = useRouter();

  // Collapsible Accordion Section States
  const [isDetectionsOpen, setIsDetectionsOpen] = useState(true);

  // Modal Dialog States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Raw = cut every bound locally in the browser → download a real ZIP (no cloud).
  // AI  = run the cloud pipeline, then hand off to the review/export screen.
  const handleTriggerExport = async (isRaw: boolean) => {
    if (boxes.length === 0 || exporting) return;
    try {
      setExporting(true);
      if (isRaw) {
        await exportBoxesAsZip(imageUrl, boxes, `assets_${jobId}.zip`);
        setIsModalOpen(false);
        setExporting(false);
      } else {
        await startExport(jobId, boxes, false);
        setIsModalOpen(false);
        router.push(`/editor/${jobId}/export`);
      }
    } catch (err) {
      console.error("Export error:", err);
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-80 flex-shrink-0 border-r border-zinc-800 bg-[#070708] font-mono text-zinc-300 overflow-hidden select-none">

      {/* 1: Scrollable Detections Accordion Widget Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <button
          onClick={() => setIsDetectionsOpen(!isDetectionsOpen)}
          className={cn(
            "w-full flex items-center justify-between px-4 py-3 bg-black/40 hover:bg-black/60 transition-colors border-b border-transparent select-none shrink-0 cursor-pointer",
            isDetectionsOpen && "border-zinc-800 bg-black/50"
          )}
        >
          <span className="text-[10px] font-black tracking-widest text-zinc-200">
            [ 01_DET ] DETECTIONS
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-[#ff7c00] font-black border border-[#ff7c00]/20 bg-[#ff7c00]/5 px-1.5 py-0.5 rounded">
              {boxes.length} DETECTED
            </span>
            {isDetectionsOpen ? <ChevronUp size={11} className="text-zinc-500" /> : <ChevronDown size={11} className="text-zinc-500" />}
          </div>
        </button>
        
        {isDetectionsOpen && (
          <div className="flex-1 overflow-y-auto flex flex-col min-h-0 bg-black/10">
            <DetectionsSection
              boxes={boxes}
              selectedIds={selectedIds}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onDeleteSelected={onDeleteSelected}
            />
          </div>
        )}
      </div>

      {/* 2: Docked Footer containing the primary popup trigger button */}
      <div className="p-4 border-t border-zinc-850 bg-black/40 shrink-0 select-none">
        <button
          onClick={() => setIsModalOpen(true)}
          disabled={boxes.length === 0 || exporting}
          className="w-full py-3.5 bg-white text-black hover:bg-[#00ff66] hover:text-black font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 hover:shadow-[0_0_18px_rgba(0,255,102,0.35)] border border-white hover:border-[#00ff66] transition-all duration-200 cursor-pointer font-mono disabled:bg-zinc-900 disabled:border-zinc-900 disabled:text-zinc-650 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {exporting ? "Exporting..." : "Export"}
        </button>
      </div>

      {/* 3: Premium Glassmorphism Terminal-Style Popup Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-[4px] transition-all duration-300">
          <div className="bg-[#0b0c0e]/95 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-[0_0_50px_rgba(0,0,0,0.85)] relative flex flex-col font-mono text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-200">
            
            {/* Close Button */}
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 transition-colors p-1 cursor-pointer"
            >
              <X size={18} />
            </button>

            {/* Sub-Header */}
            <div className="text-[9.5px] font-black text-[#ff7c00] uppercase tracking-widest mb-1.5">
              [ EXPORT PROTOCOL DETECTED ]
            </div>
            
            {/* Title */}
            <h2 className="text-[16px] font-bold text-white uppercase tracking-wider mb-5">
              Select Export Pipeline
            </h2>

            {/* Choice Cards Container */}
            <div className="grid grid-cols-1 gap-4 mb-6">
              
              {/* Option 01: Raw Export */}
              <button
                onClick={() => handleTriggerExport(true)}
                className="flex flex-col text-left p-4 border border-zinc-800/80 bg-zinc-900/20 hover:bg-emerald-950/15 hover:border-emerald-500/50 rounded transition-all duration-200 group cursor-pointer hover:shadow-[0_0_15px_rgba(16,185,129,0.06)]"
              >
                <div className="flex items-center justify-between w-full mb-1.5">
                  <span className="text-[12px] font-black text-zinc-100 group-hover:text-emerald-400 uppercase tracking-wide">
                    01: Raw Export
                  </span>
                  <Scissors size={14} className="text-zinc-500 group-hover:text-emerald-400" />
                </div>
                <p className="text-[10px] text-zinc-400 leading-relaxed font-sans font-medium">
                  Cut locally in your browser. Original sheet background is retained, skips cloud naming/upscale. Downloads a ZIP instantly.
                </p>
              </button>

              {/* Option 02: AI Export */}
              <button
                onClick={() => handleTriggerExport(false)}
                className="flex flex-col text-left p-4 border border-zinc-800/80 bg-zinc-900/20 hover:bg-orange-950/15 hover:border-orange-500/50 rounded transition-all duration-200 group cursor-pointer hover:shadow-[0_0_15px_rgba(249,115,22,0.06)]"
              >
                <div className="flex items-center justify-between w-full mb-1.5">
                  <span className="text-[12px] font-black text-zinc-100 group-hover:text-orange-400 uppercase tracking-wide">
                    02: Smart AI Export
                  </span>
                  <Zap size={14} className="text-zinc-500 group-hover:text-orange-400" />
                </div>
                <p className="text-[10px] text-zinc-400 leading-relaxed font-sans font-medium">
                  Parallel cloud sequence: automatically removes backgrounds to produce alpha transparency, and resolves asset naming via AI model.
                </p>
              </button>

            </div>

            {/* Footer metadata info */}
            <div className="text-[8.5px] text-zinc-500 uppercase tracking-wider text-center pt-3 border-t border-zinc-900/80">
              Target: {boxes.length} isolated asset sheets
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
