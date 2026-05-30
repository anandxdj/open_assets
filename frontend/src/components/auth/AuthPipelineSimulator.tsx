"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Terminal, Cpu, Check, Layers, Scan } from "lucide-react";

type Item = {
  id: number;
  name: string;
  predictedName: string;
  svgPath: React.ReactNode;
};

const RETRO_ITEMS: Item[] = [
  {
    id: 1,
    name: "sword",
    predictedName: "sword_valiant.png",
    svgPath: (
      <path
        d="M32 8l4 4L16 32l-2-2L32 8zm4-4L24 16l-4-4L32 0l4 4zM12 30l-4 4-2-2 4-4 2 2zm-4 4l-4 4H0v-4l4-4 4 4z"
        fill="currentColor"
      />
    ),
  },
  {
    id: 2,
    name: "potion",
    predictedName: "elixir_vitality.png",
    svgPath: (
      <path
        d="M16 4h8v4h-8V4zm-4 8h16v6l-4 12H16L12 18v-6zm8 4a4 4 0 11-4 4 4 4 0 014-4z"
        fill="currentColor"
      />
    ),
  },
  {
    id: 3,
    name: "key",
    predictedName: "key_cryptic.png",
    svgPath: (
      <path
        d="M24 8a8 8 0 100 16 8 8 0 000-16zm0 12a4 4 0 110-8 4 4 0 010 8zM16 14H0v6h4v4h4v-4h4v4h4v-10z"
        fill="currentColor"
      />
    ),
  },
  {
    id: 4,
    name: "shield",
    predictedName: "shield_aegis.png",
    svgPath: (
      <path
        d="M4 4h32v12c0 10-8 18-16 22C12 34 4 26 4 16V4zm16 6v22c6-3 12-10 12-16V8H20z"
        fill="currentColor"
      />
    ),
  },
  {
    id: 5,
    name: "crown",
    predictedName: "crown_sovereign.png",
    svgPath: (
      <path
        d="M0 8l6 14 10-10 10 10 10-10 6 14H0V8zm8 20h24v4H8v-4z"
        fill="currentColor"
      />
    ),
  },
  {
    id: 6,
    name: "gem",
    predictedName: "prism_shard.png",
    svgPath: (
      <path
        d="M20 0L40 16 20 40 0 16 20 0zm0 6L6 17l14 17 14-17L20 6z"
        fill="currentColor"
      />
    ),
  },
];

export function AuthPipelineSimulator() {
  const [step, setStep] = useState(0); // 0: Boot, 1: Loading, 2: Scan, 3: AI Label, 4: Compiled, 5: Loop Delay
  const [logs, setLogs] = useState<string[]>([]);
  const [scannedIds, setScannedIds] = useState<number[]>([]);
  const [labeledIds, setLabeledIds] = useState<number[]>([]);
  const [activeItemIndex, setActiveItemIndex] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (step === 0) {
      setLogs([
        "SYSTEM CORE v1.0.0",
        "------------------------------",
        "INITIALIZING OPEN_ASSETS ENGINE...",
        "[OK] MEMORY ALLOCATION SECURE",
        "[OK] COMPILING VISION SCHEMATIC",
        "READY FOR SECURITY INTERFACE..."
      ]);
      setScannedIds([]);
      setLabeledIds([]);
      setActiveItemIndex(-1);
      timer = setTimeout(() => setStep(1), 2000);
    } else if (step === 1) {
      setLogs((prev) => [
        ...prev,
        "LOADING SPRITE SHEET DATABASE...",
        "STATUS: MOUNTING SOURCE spr_rpg_sheet.png",
        "DIMENSIONS: 384 x 256px [RGBA_8]"
      ]);
      timer = setTimeout(() => setStep(2), 1500);
    } else if (step === 2) {
      setLogs((prev) => [
        ...prev,
        "LAUNCHING CONTOUR DETECTION MODULE...",
        "RUNNING cv2.findContours(threshold, cv2.RETR_EXTERNAL)..."
      ]);

      let idx = 0;
      const interval = setInterval(() => {
        if (idx < RETRO_ITEMS.length) {
          const item = RETRO_ITEMS[idx];
          setActiveItemIndex(idx);
          setScannedIds((prev) => [...prev, item.id]);
          setLogs((prev) => [
            ...prev,
            `[EXTRACTED] Item_${item.id} bounding box found at [w:40, h:40]`
          ]);
          idx++;
        } else {
          clearInterval(interval);
          setActiveItemIndex(-1);
          setStep(3);
        }
      }, 600);
      return () => clearInterval(interval);
    } else if (step === 3) {
      setLogs((prev) => [
        ...prev,
        "SEGMENTATION COMPLETED. SENDING TO AI...",
        "PROMPT: IDENTIFY AND GENERATE SPRITE FILENAME"
      ]);

      let idx = 0;
      const interval = setInterval(() => {
        if (idx < RETRO_ITEMS.length) {
          const item = RETRO_ITEMS[idx];
          setActiveItemIndex(idx);
          setLabeledIds((prev) => [...prev, item.id]);
          setLogs((prev) => [
            ...prev,
            `[AI CLASSIFY] Item_${item.id} -> '${item.predictedName}' (confidence: 99.${9 - idx}%)`
          ]);
          idx++;
        } else {
          clearInterval(interval);
          setActiveItemIndex(-1);
          setStep(4);
        }
      }, 700);
      return () => clearInterval(interval);
    } else if (step === 4) {
      setLogs((prev) => [
        ...prev,
        "------------------------------",
        "ZIP COMPILER PIPELINE INITIATED...",
        "[OK] TRANSPARENT Sprites scaled (2x/4x)",
        "[SUCCESS] open_assets_package.zip generated (18.4KB)",
        "SYSTEM ENTRANCE SECURED."
      ]);
      timer = setTimeout(() => setStep(5), 2500);
    } else if (step === 5) {
      timer = setTimeout(() => setStep(0), 4000);
    }

    return () => clearTimeout(timer);
  }, [step]);

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-6 h-[480px] bg-black text-white border-2 border-black dark:border-zinc-800 p-5 font-mono select-none shadow-[6px_6px_0px_0px_#000] dark:shadow-[6px_6px_0px_0px_#27272a] relative overflow-hidden">
      
      {/* Brutalist Grid Background Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#151515_1px,transparent_1px),linear-gradient(to_bottom,#151515_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none opacity-60 z-0" />
      
      {/* Header status panel */}
      <div className="flex items-center justify-between border-b-2 border-white dark:border-zinc-800 pb-3 relative z-10">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 bg-white border border-black animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-wider">
            [ PIPELINE_MONITOR_v1.0 ]
          </span>
        </div>
        <span className="text-[9px] text-zinc-500 font-bold">
          SYS_SECURE_AUTH
        </span>
      </div>

      {/* Main content grid */}
      <div className="flex-1 grid grid-cols-2 gap-4 relative z-10 overflow-hidden">
        
        {/* Left Side: Sprite Sheet Scan Grid */}
        <div className="border border-white/20 dark:border-zinc-800 bg-black/85 p-3 flex flex-col justify-between overflow-hidden relative">
          <div className="absolute inset-0 bg-[radial-gradient(#ffffff05_1px,transparent_1px)] bg-[size:8px_8px] pointer-events-none" />
          
          <span className="text-[9px] text-zinc-500 block mb-2 uppercase">
            // INPUT_TEXTURES
          </span>

          <div className="grid grid-cols-3 gap-2 flex-1 items-center justify-center p-1 relative border border-white/10">
            {RETRO_ITEMS.map((item, idx) => {
              const isScanned = scannedIds.includes(item.id);
              const isLabeled = labeledIds.includes(item.id);
              const isActive = activeItemIndex === idx;

              return (
                <div
                  key={item.id}
                  className={`aspect-square flex items-center justify-center border transition-all duration-200 relative ${
                    isActive
                      ? "border-white bg-white text-black shadow-[0_0_8px_rgba(255,255,255,0.1)] scale-105 z-10"
                      : isLabeled
                      ? "border-white/80 bg-zinc-900 text-white"
                      : isScanned
                      ? "border-white/40 bg-zinc-950 text-zinc-400"
                      : "border-white/10 bg-black text-zinc-700"
                  }`}
                >
                  <div className="w-7 h-7 flex items-center justify-center">
                    <svg viewBox="0 0 40 40" className="w-5 h-5 fill-current">
                      {item.svgPath}
                    </svg>
                  </div>

                  {isActive && (
                    <span className="absolute -top-1 -left-1 text-[8px] font-black leading-none">
                      +
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute -bottom-1 -right-1 text-[8px] font-black leading-none">
                      +
                    </span>
                  )}
                </div>
              );
            })}

            {/* Sweep laser line for scanning */}
            {step === 2 && (
              <motion.div
                initial={{ y: "-10%" }}
                animate={{ y: "100%" }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                className="absolute inset-x-0 h-[2px] bg-white z-20 pointer-events-none shadow-[0_0_8px_#fff]"
              />
            )}
          </div>

          <div className="mt-2 flex justify-between text-[8px] text-zinc-500 font-bold">
            <span>PACK: RPG_v1</span>
            <span>CELL: 40x40</span>
          </div>
        </div>

        {/* Right Side: Micro Terminal Log Console */}
        <div className="border border-white/20 dark:border-zinc-800 bg-black/90 p-3 flex flex-col overflow-hidden relative">
          <div className="flex items-center gap-1.5 border-b border-white/10 pb-1.5 mb-2">
            <Terminal className="h-3 w-3 text-zinc-400" />
            <span className="text-[8px] text-zinc-400 font-bold uppercase tracking-wider">Console Terminal</span>
          </div>

          {/* Scrolling area */}
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-none"
            style={{ scrollbarWidth: "none" }}
          >
            {logs.map((log, i) => {
              const isOk = log.startsWith("[OK]") || log.startsWith("[SUCCESS]");
              const isHeader = log.includes("SYSTEM CORE") || log.startsWith("---");

              return (
                <div
                  key={i}
                  className={`text-[8px] leading-tight break-all font-mono ${
                    isOk
                      ? "text-white font-extrabold"
                      : isHeader
                      ? "text-zinc-500 font-semibold"
                      : "text-zinc-400"
                  }`}
                >
                  {log}
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Compiler output bar */}
      <div className="border-t-2 border-white dark:border-zinc-800 pt-3 relative z-10 flex items-center justify-between text-[9px] text-zinc-400">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" />
          <span className="font-bold uppercase tracking-wide">
            {step === 4 || step === 5
              ? "COMPILATION_COMPLETE // READY"
              : step === 3
              ? "RUNNING_AI_LABELING..."
              : step === 2
              ? "OPENCV_EXTRACTING_CONTOURS..."
              : "SYSTEM_INITIALIZING..."}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-bold">
          <span className="w-1.5 h-1.5 bg-white rounded-none border border-black animate-ping" />
          <span>SYS_ON</span>
        </div>
      </div>

    </div>
  );
}
