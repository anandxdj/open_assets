"use client";

import { Download, Check, AlertTriangle, RotateCcw, Layers, Sparkles, Scissors, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

type ExportState = "idle" | "naming" | "cropping" | "cropped" | "finalizing" | "ready" | "failed";

interface PipelineSectionProps {
  exportState: ExportState;
  logs: string[];
  croppedAssets: any[];
  selectedAssetIds: Set<string>;
  zipDownloadUrl: string;
  errorMsg: string;
  onStartExport: () => void;
  onFinalizeExport: () => void;
  onToggleAsset: (id: string) => void;
  onToggleAllAssets: () => void;
  onReset: () => void;
  logContainerRef: React.RefObject<HTMLDivElement | null>;
}

const PIPELINE_STEPS = [
  { n: "01", icon: Sparkles, label: "Name", desc: "Gemini maps names to each bound" },
  { n: "02", icon: Scissors, label: "Crop", desc: "OpenCV segments every region" },
  { n: "03", icon: Eye,      label: "Preview", desc: "See each asset individually" },
  { n: "04", icon: Check,    label: "Select", desc: "Pick the ones you like" },
];

export function PipelineSection({
  exportState,
  logs,
  croppedAssets,
  selectedAssetIds,
  zipDownloadUrl,
  errorMsg,
  onStartExport,
  onFinalizeExport,
  onToggleAsset,
  onToggleAllAssets,
  onReset,
  logContainerRef,
}: PipelineSectionProps) {
  return (
    <div className="flex-1 flex flex-col justify-between overflow-hidden min-h-[250px] bg-black/10">

      {/* 1: IDLE — pipeline overview */}
      {exportState === "idle" && (
        <div className="flex-1 flex flex-col p-4 gap-3 min-h-[250px]">
          <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-mono font-bold select-none">
            pipeline
          </p>

          <div className="flex flex-col gap-1.5">
            {PIPELINE_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.n}
                  className="flex items-center gap-3 px-3 py-2.5 border border-zinc-800/60 bg-zinc-950/40 rounded"
                >
                  <span className="text-[8px] text-zinc-700 font-black font-mono w-4 shrink-0">
                    {step.n}
                  </span>
                  <Icon size={11} className="text-zinc-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10.5px] text-zinc-300 font-black font-mono uppercase tracking-wide leading-none">
                      {step.label}
                    </p>
                    <p className="text-[9px] text-zinc-600 font-mono mt-0.5 leading-none">
                      {step.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex-1" />

          <button
            onClick={onStartExport}
            className="w-full py-3.5 bg-white text-black font-black uppercase tracking-widest text-[10.5px] flex items-center justify-center gap-1.5 hover:bg-[#00ff66] hover:shadow-[0_0_20px_rgba(0,255,102,0.4)] border border-white hover:border-[#00ff66] transition-all duration-200 cursor-pointer font-mono"
          >
            Launch Process Engine
          </button>
        </div>
      )}

      {/* 2: ACTIVE PROCESSING — console log */}
      {(exportState === "naming" || exportState === "cropping" || exportState === "finalizing") && (
        <div className="flex-1 flex flex-col justify-between overflow-hidden min-h-[250px]">
          {/* Step indicator */}
          <div className="flex items-center gap-0 border-b border-zinc-800 shrink-0">
            {(["naming", "cropping", "finalizing"] as const).map((phase, i) => {
              const active = exportState === phase;
              const done =
                (phase === "naming" && (exportState === "cropping" || exportState === "finalizing")) ||
                (phase === "cropping" && exportState === "finalizing");
              return (
                <div
                  key={phase}
                  className={cn(
                    "flex-1 py-2 text-center text-[8px] font-black uppercase tracking-widest font-mono border-b-2 transition-colors",
                    active
                      ? "border-[#ff7c00] text-[#ff7c00]"
                      : done
                      ? "border-zinc-700 text-zinc-500"
                      : "border-transparent text-zinc-700"
                  )}
                >
                  {phase}
                </div>
              );
            })}
          </div>

          {/* Scrollable terminal */}
          <div
            ref={logContainerRef}
            className="flex-1 bg-black p-4 m-3.5 border border-zinc-800 rounded overflow-y-auto scrollbar-none flex flex-col gap-2.5 font-mono text-[10.5px] leading-relaxed text-zinc-300 shadow-inner"
          >
            {logs.map((log, i) => {
              let colorClass = "text-zinc-400";
              if (log.startsWith("[SUCCESS]")) colorClass = "text-[#00ff66] font-extrabold";
              if (log.startsWith("[AI_LABELER]")) colorClass = "text-amber-400 font-bold";
              if (log.startsWith("[OPENCV]")) colorClass = "text-sky-400 font-bold";
              if (log.startsWith("[INIT]") || log.startsWith("[PIPELINE]") || log.startsWith("[CONFIG]"))
                colorClass = "text-zinc-500 font-bold";
              return (
                <div key={i} className={colorClass}>
                  {log}
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-950/60 space-y-3.5 shrink-0 select-none">
            <div className="flex items-center justify-between text-[10.5px] font-bold font-mono tracking-wider">
              <span className="text-zinc-400">PROCESSING QUEUE</span>
              <span className="text-[#ff7c00] font-black uppercase animate-pulse">{exportState}</span>
            </div>
            <div className="h-1.5 bg-zinc-900 rounded-none overflow-hidden">
              <div
                className="h-full bg-[#ff7c00] transition-all duration-500 shadow-[0_0_10px_rgba(255,124,0,0.5)]"
                style={{
                  width:
                    exportState === "naming" ? "30%" : exportState === "cropping" ? "70%" : "90%",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 3: CROPPED — visual grid, choose which you like */}
      {exportState === "cropped" && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-[250px]">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-black/30 select-none">
            <span className="text-[10px] font-black text-zinc-200 uppercase tracking-widest font-mono">
              choose which you like
            </span>
            <button
              onClick={onToggleAllAssets}
              className="text-[9px] text-zinc-400 hover:text-white uppercase font-bold tracking-tighter cursor-pointer transition-colors font-mono"
            >
              {selectedAssetIds.size === croppedAssets.length ? "None" : "All"}
            </button>
          </div>

          {/* 2-column asset grid */}
          <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 content-start">
            {croppedAssets.map((asset: any) => {
              const isSelected = selectedAssetIds.has(asset.id);
              return (
                <button
                  key={asset.id}
                  onClick={() => onToggleAsset(asset.id)}
                  className={cn(
                    "flex flex-col gap-1.5 p-2 border rounded transition-all duration-150 cursor-pointer text-left",
                    isSelected
                      ? "border-[#00ff66]/60 bg-emerald-950/15 shadow-[0_0_10px_rgba(0,255,102,0.08)]"
                      : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                  )}
                >
                  {/* Thumbnail with checkerboard transparency bg */}
                  <div
                    className="relative w-full aspect-square rounded overflow-hidden flex items-center justify-center"
                    style={{
                      backgroundImage:
                        "linear-gradient(45deg,#1a1a1a 25%,transparent 25%),linear-gradient(-45deg,#1a1a1a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1a 75%),linear-gradient(-45deg,transparent 75%,#1a1a1a 75%)",
                      backgroundSize: "8px 8px",
                      backgroundPosition: "0 0,0 4px,4px -4px,-4px 0",
                      backgroundColor: "#111",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.cropped_url}
                      alt={asset.name}
                      className="max-h-full max-w-full object-contain"
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-[#00ff66]/8 pointer-events-none" />
                    )}
                    {isSelected && (
                      <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-[#00ff66] flex items-center justify-center shadow-[0_0_8px_#00ff66]">
                        <Check size={9} className="text-black" strokeWidth={3} />
                      </div>
                    )}
                  </div>

                  {/* Name below image */}
                  <p
                    className={cn(
                      "text-[10px] font-black truncate font-mono text-center leading-tight",
                      isSelected ? "text-zinc-100" : "text-zinc-400"
                    )}
                    title={asset.name}
                  >
                    {asset.name}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Sticky bottom — download trigger */}
          <div className="p-3 border-t border-zinc-800 bg-zinc-950/70 space-y-2 shrink-0">
            <button
              onClick={onFinalizeExport}
              disabled={selectedAssetIds.size === 0}
              className="w-full py-3.5 bg-[#00ff66] text-black font-black uppercase tracking-widest text-[10.5px] flex items-center justify-center gap-1.5 hover:bg-[#00e55b] hover:shadow-[0_0_20px_rgba(0,255,102,0.4)] border border-[#00ff66] transition-all duration-200 cursor-pointer font-mono disabled:bg-zinc-900 disabled:border-zinc-900 disabled:text-zinc-600 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Download className="h-3.5 w-3.5" />
              Download {selectedAssetIds.size > 0 ? `(${selectedAssetIds.size})` : ""}
            </button>
            <button
              onClick={onReset}
              className="w-full py-2 bg-transparent text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition-colors text-[9.5px] uppercase font-bold tracking-wider font-mono cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 4: READY — download compiled ZIP */}
      {exportState === "ready" && (
        <div className="flex-1 p-6 flex flex-col justify-between min-h-[250px]">
          <div className="space-y-6 text-center pt-8 select-none">
            <div className="flex justify-center">
              <div className="h-12 w-12 rounded-full bg-emerald-950/40 border border-[#00ff66] flex items-center justify-center text-[#00ff66] shadow-[0_0_20px_rgba(0,255,102,0.25)] animate-bounce">
                <Check className="h-6 w-6" />
              </div>
            </div>
            <div className="space-y-2 px-2">
              <h4 className="text-zinc-200 font-black uppercase text-[11px] tracking-widest font-mono">
                ZIP Package Compiled
              </h4>
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                Assets are AI-labeled, upscaled, and packaged.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 pb-2">
            <a
              href={zipDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-4 bg-[#00ff66] text-black font-black uppercase tracking-widest text-[10.5px] flex items-center justify-center gap-1.5 hover:bg-[#00e55b] hover:shadow-[0_0_20px_rgba(0,255,102,0.4)] border border-[#00ff66] transition-all duration-200 font-mono text-center"
            >
              <Download className="h-4 w-4" />
              Download ZIP
            </a>
            <button
              onClick={onReset}
              className="w-full py-2.5 bg-transparent text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-colors text-[10.5px] uppercase font-bold flex items-center justify-center gap-1.5 font-mono cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Return to Editor
            </button>
          </div>
        </div>
      )}

      {/* 5: FAIL */}
      {exportState === "failed" && (
        <div className="flex-1 p-6 flex flex-col justify-between min-h-[250px]">
          <div className="space-y-6 text-center pt-8">
            <div className="flex justify-center">
              <div className="h-12 w-12 rounded-full bg-red-950/40 border border-red-500 flex items-center justify-center text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.25)]">
                <AlertTriangle className="h-6 w-6" />
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-zinc-200 font-black uppercase text-[11px] tracking-widest font-mono text-red-500">
                Pipeline Failed
              </h4>
              <p className="text-[10px] text-red-300 leading-relaxed px-2.5 text-left bg-black border border-zinc-800 p-3.5 rounded max-h-[140px] overflow-y-auto break-words">
                {errorMsg}
              </p>
            </div>
          </div>

          <button
            onClick={onReset}
            className="w-full py-3.5 bg-white text-black font-black uppercase tracking-widest text-[10.5px] flex items-center justify-center gap-1.5 hover:bg-zinc-200 transition-colors border border-white font-mono cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset & Retry
          </button>
        </div>
      )}
    </div>
  );
}
