"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Terminal, Database, Cpu, AlertCircle, RefreshCw } from "lucide-react";

interface LogLine {
  timestamp: string;
  source: "INFO" | "ENGINE" | "GEMINI" | "COMPILER" | "OK";
  text: string;
  assetIdx?: number; // Links log line to a visual box for synchronization
  labelUpdate?: string;
}

const RAW_PIPELINE_LOGS: LogLine[] = [
  { timestamp: "02:18:25", source: "INFO", text: "IPC channel initialization successful. Listening on port 50051." },
  { timestamp: "02:18:25", source: "INFO", text: "Loaded source compilation sprite sheet (2048x2048px, opacity channel detected)." },
  { timestamp: "02:18:25", source: "ENGINE", text: "Executing low-level computer vision contour scan..." },
  { timestamp: "02:18:25", source: "ENGINE", text: "cv2.findContours(threshold=12, mode=RETR_EXTERNAL, method=CHAIN_APPROX_SIMPLE)" },
  { timestamp: "02:18:26", source: "OK", text: "Traced 4 closed asset layer bounding regions successfully." },
  { timestamp: "02:18:26", source: "INFO", text: "Initiating multi-agent semantic labeling pipeline..." },
  { timestamp: "02:18:26", source: "GEMINI", text: "Calling Vision LLM (gemini-2.5-flash) on crop buffer 01...", assetIdx: 0, labelUpdate: "IRON_BROADSWORD" },
  { timestamp: "02:18:26", source: "GEMINI", text: "GEMINI: Crop 01 parsed as RPG Fantasy Item -> 'iron_broadsword_clean'." },
  { timestamp: "02:18:27", source: "GEMINI", text: "Calling Vision LLM (gemini-2.5-flash) on crop buffer 02...", assetIdx: 1, labelUpdate: "STEEL_SHIELD" },
  { timestamp: "02:18:27", source: "GEMINI", text: "GEMINI: Crop 02 parsed as Defense Armor -> 'knight_shield_steel'." },
  { timestamp: "02:18:27", source: "GEMINI", text: "Calling Vision LLM (gemini-2.5-flash) on crop buffer 03...", assetIdx: 2, labelUpdate: "WOOD_CHEST" },
  { timestamp: "02:18:28", source: "GEMINI", text: "GEMINI: Crop 03 parsed as Object Container -> 'wood_chest_closed'." },
  { timestamp: "02:18:28", source: "GEMINI", text: "Calling Vision LLM (gemini-2.5-flash) on crop buffer 04...", assetIdx: 3, labelUpdate: "GOLDEN_KEY" },
  { timestamp: "02:18:28", source: "GEMINI", text: "GEMINI: Crop 04 parsed as Quest Item -> 'gold_key_relic'." },
  { timestamp: "02:18:28", source: "COMPILER", text: "Initiating isolated transparent PNG layer crops..." },
  { timestamp: "02:18:28", source: "COMPILER", text: "Auto-cropping: Asset 01 [240x240] | Asset 02 [180x180] | Asset 03 [200x200] | Asset 04 [120x120]" },
  { timestamp: "02:18:29", source: "COMPILER", text: "Zipping structural assets directory compiled output..." },
  { timestamp: "02:18:29", source: "OK", text: "Archive compilation complete: assets_package_1c0a93b1.zip" },
  { timestamp: "02:18:29", source: "OK", text: "Pipeline run finished cleanly. Process elapsed: 4.12s" }
];

interface VisualBox {
  id: number;
  x: string;
  y: string;
  w: string;
  h: string;
  defaultLabel: string;
  currentLabel: string;
  color: string;
  active: boolean;
}

const INITIAL_BOXES: VisualBox[] = [
  { id: 0, x: "10%", y: "15%", w: "32%", h: "32%", defaultLabel: "ASSET_01", currentLabel: "ASSET_01", color: "bg-[#ff7c00] text-black", active: false },
  { id: 1, x: "55%", y: "10%", w: "28%", h: "28%", defaultLabel: "ASSET_02", currentLabel: "ASSET_02", color: "bg-[#00ff66] text-black", active: false },
  { id: 2, x: "12%", y: "55%", w: "30%", h: "30%", defaultLabel: "ASSET_03", currentLabel: "ASSET_03", color: "bg-blue-600 text-white", active: false },
  { id: 3, x: "58%", y: "50%", w: "24%", h: "24%", defaultLabel: "ASSET_04", currentLabel: "ASSET_04", color: "bg-yellow-500 text-black", active: false }
];

export function BrutalPipelinePanel() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [boxes, setBoxes] = useState<VisualBox[]>(INITIAL_BOXES);
  const [currentLogIdx, setCurrentLogIdx] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const logTerminalEndRef = useRef<HTMLDivElement>(null);

  // Run the stdout streaming process loop
  useEffect(() => {
    if (!isRunning) return;

    if (currentLogIdx === 0) {
      setLogs([]);
      setBoxes(INITIAL_BOXES.map(b => ({ ...b, currentLabel: b.defaultLabel, active: false })));
    }

    const interval = setTimeout(() => {
      const line = RAW_PIPELINE_LOGS[currentLogIdx];
      setLogs(prev => [...prev, line]);

      // Synchronize with visual bounding boxes
      if (line.assetIdx !== undefined && line.labelUpdate) {
        setBoxes(prev => prev.map(b => {
          if (b.id === line.assetIdx) {
            return { ...b, currentLabel: line.labelUpdate!, active: true };
          }
          return b;
        }));
      }

      if (currentLogIdx < RAW_PIPELINE_LOGS.length - 1) {
        setCurrentLogIdx(prev => prev + 1);
      } else {
        setIsRunning(false);
      }
    }, currentLogIdx === 0 ? 500 : RAW_PIPELINE_LOGS[currentLogIdx].assetIdx !== undefined ? 1100 : 400);

    return () => clearTimeout(interval);
  }, [currentLogIdx, isRunning]);

  // Scroll log box automatically
  useEffect(() => {
    logTerminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleReRun = () => {
    setCurrentLogIdx(0);
    setIsRunning(true);
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "INFO": return "bg-zinc-800 text-zinc-400";
      case "ENGINE": return "bg-purple-950 text-purple-400 border border-purple-900";
      case "GEMINI": return "bg-[#ff7c00]/10 text-[#ff7c00] border border-[#ff7c00]/25";
      case "COMPILER": return "bg-blue-950 text-blue-400 border border-blue-900";
      case "OK": return "bg-[#00ff66]/10 text-[#00ff66] border border-[#00ff66]/25";
      default: return "bg-zinc-800 text-zinc-400";
    }
  };

  return (
    <section className="bg-background border-b border-zinc-200 dark:border-zinc-950 py-24 px-6 relative overflow-hidden select-none">
      <div className="mx-auto max-w-5xl">
        
        {/* Stark Unix Window Shell */}
        <div className="border-4 border-black dark:border-white bg-[#0a0a0c] text-white font-mono shadow-[8px_8px_0px_#000] dark:shadow-[8px_8px_0px_#fff] flex flex-col h-[560px] overflow-hidden">
          
          {/* Top UNIX titlebar */}
          <div className="h-11 border-b-4 border-black dark:border-white bg-zinc-900 px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="size-3 border border-black bg-red-600 rounded-none inline-block" />
                <span className="size-3 border border-black bg-yellow-500 rounded-none inline-block" />
                <span className="size-3 border border-black bg-[#00ff66] rounded-none inline-block" />
              </div>
              <span className="text-[10px] sm:text-xs font-black tracking-widest text-zinc-400 dark:text-zinc-300 uppercase">
                [ PIPELINE_MONITOR_CONSOLE_v1.0.4 ]
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
              <span className="flex items-center gap-1">
                <Cpu className="h-3.5 w-3.5 text-[#00ff66]" /> CORES: 12
              </span>
              <span className="flex items-center gap-1">
                <Database className="h-3.5 w-3.5 text-[#ff7c00]" /> SYSTEM_OK
              </span>
            </div>
          </div>

          {/* Body division grid */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0">
            
            {/* Left Column: Bounding Canvas Sheet */}
            <div className="md:col-span-6 border-b-4 md:border-b-0 md:border-r-4 border-black dark:border-white relative overflow-hidden p-6 flex flex-col justify-between bg-zinc-950">
              <span className="absolute top-3 left-3 text-[9px] text-zinc-500 font-bold uppercase tracking-widest">[ 01_SCANNING_GRID ]</span>
              
              {/* Retro Canvas Workspace */}
              <div className="flex-1 border-2 border-dashed border-zinc-800 relative mt-6 bg-[#050506]">
                
                {/* Dot grid pattern overlay */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage: "radial-gradient(circle, #ffffff04 1.5px, transparent 1.5px)",
                    backgroundSize: "24px 24px",
                  }}
                />

                {/* Slicing Bounding boxes */}
                {boxes.map((box) => (
                  <div
                    key={box.id}
                    className={`absolute border-2 transition-all duration-300 ${
                      box.active
                        ? "border-white bg-zinc-900/80 shadow-[0_0_12px_rgba(255,255,255,0.06)]"
                        : "border-dashed border-zinc-800"
                    }`}
                    style={{
                      left: box.x,
                      top: box.y,
                      width: box.w,
                      height: box.h
                    }}
                  >
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-2 text-center">
                      <span className={`text-[8px] sm:text-[9px] font-black px-1.5 py-0.5 border border-black uppercase transition-all duration-300 ${
                        box.active ? box.color : "bg-zinc-900 text-zinc-600 border-zinc-800"
                      }`}>
                        {box.currentLabel}
                      </span>
                    </div>

                    {/* Corner anchors */}
                    <span className="absolute top-[-2px] left-[-2px] size-1 bg-white border border-black" />
                    <span className="absolute top-[-2px] right-[-2px] size-1 bg-white border border-black" />
                    <span className="absolute bottom-[-2px] left-[-2px] size-1 bg-white border border-black" />
                    <span className="absolute bottom-[-2px] right-[-2px] size-1 bg-white border border-black" />
                  </div>
                ))}
              </div>

              {/* Status bar */}
              <div className="mt-4 flex items-center justify-between text-[9px] text-zinc-500 font-bold uppercase tracking-widest border-t border-zinc-900 pt-3">
                <span>Viewport: 2048 x 2048</span>
                <span className="flex items-center gap-1">
                  <span className={`size-1.5 rounded-none ${isRunning ? "bg-[#ff7c00] animate-pulse" : "bg-[#00ff66]"}`} />
                  {isRunning ? "PROCESSING_SHEET" : "PIPELINE_IDLE"}
                </span>
              </div>
            </div>

            {/* Right Column: Real-Time Stdout logs */}
            <div className="md:col-span-6 flex flex-col justify-between bg-zinc-950 p-6">
              <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mb-3">[ 02_STDOUT_PIPE ]</span>
              
              {/* Terminal Viewport */}
              <div className="flex-1 bg-black border-2 border-black dark:border-zinc-900 p-4 font-mono text-[9px] sm:text-[10px] overflow-y-auto leading-relaxed text-zinc-300 space-y-2 border-t-2 select-text">
                {logs.length === 0 ? (
                  <div className="text-zinc-600 uppercase tracking-widest animate-pulse flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5" /> Awaiting pipeline process execution...
                  </div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-2.5">
                      <span className="text-zinc-600 shrink-0 select-none">[{log.timestamp}]</span>
                      <span className={`text-[8px] font-black uppercase px-1 py-0 rounded-sm shrink-0 select-none ${getSourceBadge(log.source)}`}>
                        {log.source}
                      </span>
                      <span className="flex-1 font-mono tracking-tight text-left break-all">{log.text}</span>
                    </div>
                  ))
                )}
                {isRunning && (
                  <div className="flex items-center gap-1.5 text-[#ff7c00]">
                    <span className="size-1.5 bg-[#ff7c00] animate-ping" />
                    <span>_</span>
                  </div>
                )}
                <div ref={logTerminalEndRef} />
              </div>

              {/* Controls bar bottom */}
              <div className="mt-4 border-t border-zinc-900 pt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={handleReRun}
                  disabled={isRunning}
                  className={`px-4 py-2 border-2 border-black dark:border-white font-black text-[10px] uppercase tracking-wider transition-all rounded-none flex items-center gap-1.5 ${
                    isRunning
                      ? "bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed"
                      : "bg-[#ff7c00] text-black hover:bg-[#ff7c00]/95 hover:shadow-[4px_4px_0px_#000] dark:hover:shadow-[4px_4px_0px_#fff] transform hover:-translate-x-1 hover:-translate-y-1 active:translate-x-0 active:translate-y-0"
                  }`}
                >
                  <RefreshCw className={`h-3 w-3 ${isRunning ? "animate-spin" : ""}`} />
                  Re-Run Pipeline
                </button>

                <div className="text-[9px] font-black uppercase text-zinc-500 tracking-wider">
                  Stdout Buffer: <span className="text-zinc-300">{logs.length} / {RAW_PIPELINE_LOGS.length}</span>
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
