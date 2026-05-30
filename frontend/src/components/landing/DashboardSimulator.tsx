"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Terminal, Cpu, Download, CheckCircle2, ShieldAlert, Sparkles, Layers } from "lucide-react";

// Types
type Item = {
  id: number;
  name: string;
  predictedName: string;
  color: string;
  svgPath: React.ReactNode;
};

// Raw Sprite Sheet Simulated Items
const SIMULATED_ITEMS: Item[] = [
  {
    id: 1,
    name: "sword",
    predictedName: "sword_knight_gold.png",
    color: "#fbbf24", // Gold
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
    predictedName: "potion_mana_elixir.png",
    color: "#3b82f6", // Blue
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
    predictedName: "key_dungeon_rusty.png",
    color: "#f59e0b", // Amber
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
    predictedName: "shield_valkyrie_steel.png",
    color: "#94a3b8", // Steel Blue/Gray
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
    predictedName: "crown_royal_ruby.png",
    color: "#ef4444", // Ruby Red
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
    predictedName: "gem_flawless_emerald.png",
    color: "#10b981", // Emerald Green
    svgPath: (
      <path
        d="M20 0L40 16 20 40 0 16 20 0zm0 6L6 17l14 17 14-17L20 6z"
        fill="currentColor"
      />
    ),
  },
];

export function DashboardSimulator() {
  const [step, setStep] = useState(0); // 0: Idle, 1: Scanning Contours, 2: AI Naming, 3: Exporting, 4: Complete/Loop Ready
  const [logs, setLogs] = useState<string[]>([]);
  const [activeItemIndex, setActiveItemIndex] = useState<number>(-1);
  const [scannedItems, setScannedItems] = useState<number[]>([]);
  const [namedItems, setNamedItems] = useState<number[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs inside container only (prevents hijacking the main window viewport)
  useEffect(() => {
    const container = logContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [logs]);

  // Main Loop Controller
  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (step === 0) {
      setLogs(["[READY] Awaiting input asset sheet...", "[STATUS] System idle. Ready for upload."]);
      setScannedItems([]);
      setNamedItems([]);
      setActiveItemIndex(-1);
      timer = setTimeout(() => setStep(1), 2500);
    } else if (step === 1) {
      // Step 1: Scanning contours (sweeping line)
      setLogs((prev) => [
        ...prev,
        "[EVENT] Received sprite_sheet_rpg.png (256x256)",
        "[EXEC] Initializing OpenCV engine...",
        "[EXEC] cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)",
        "[EXEC] cv2.adaptiveThreshold(gray, 255, ...)",
        "[OPENCV] Running contour extraction...",
      ]);

      // Scan items one by one
      let idx = 0;
      const interval = setInterval(() => {
        if (idx < SIMULATED_ITEMS.length) {
          const currentIdx = idx;
          const currentItem = SIMULATED_ITEMS[currentIdx];
          setActiveItemIndex(currentIdx);
          setScannedItems((prev) => [...prev, currentItem.id]);
          setLogs((prev) => [
            ...prev,
            `[OPENCV] Contour extracted: isolated item_${currentIdx + 1} at bounding box [x:${currentIdx * 40}, y:16]`,
          ]);
          idx++;
        } else {
          clearInterval(interval);
          setActiveItemIndex(-1);
          setStep(2);
        }
      }, 700);

      return () => clearInterval(interval);
    } else if (step === 2) {
      // Step 2: Gemini AI labeling
      setLogs((prev) => [
        ...prev,
        "[EXEC] OpenCV segmentation successful. Isolated 6 assets.",
        "[AI_ENGINE] Initiating AI vision request...",
        "[AI_ENGINE] Prompt: 'Identify sprite items, label semantic filenames.'",
      ]);

      let idx = 0;
      const interval = setInterval(() => {
        if (idx < SIMULATED_ITEMS.length) {
          const currentIdx = idx;
          const currentItem = SIMULATED_ITEMS[currentIdx];
          setActiveItemIndex(currentIdx);
          setNamedItems((prev) => [...prev, currentItem.id]);
          setLogs((prev) => [
            ...prev,
            `[AI_LABEL] AI predicted item_${currentIdx + 1} ➔ '${currentItem.predictedName}' (confidence: 99.${9 - currentIdx}%)`,
          ]);
          idx++;
        } else {
          clearInterval(interval);
          setActiveItemIndex(-1);
          setStep(3);
        }
      }, 800);

      return () => clearInterval(interval);
    } else if (step === 3) {
      // Step 3: Packing & Preparing export
      setLogs((prev) => [
        ...prev,
        "[EXPORT] All items mapped & labeled successfully.",
        "[EXPORT] Packing structured assets/ folder...",
        "[EXPORT] Injecting transparent paddings & scaling PNGs...",
        "[SUCCESS] open_assets_pack.zip created (24.8 KB).",
      ]);
      timer = setTimeout(() => setStep(4), 1500);
    } else if (step === 4) {
      // Step 4: Complete state, hold, then loop
      timer = setTimeout(() => {
        setStep(0);
      }, 6000);
    }

    return () => clearTimeout(timer);
  }, [step]);

  return (
    <div className="w-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 relative font-mono text-xs text-zinc-300">
      
      {/* SVG Pathways (Connecting Lines) */}
      <div className="absolute inset-0 hidden md:block pointer-events-none z-0">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          {/* Connector 1: Panel 1 to Panel 2 */}
          <path
            d="M 310 160 H 350"
            fill="none"
            stroke="#27272a"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          {/* Glowing particle 1 */}
          {step > 0 && step < 3 && (
            <motion.circle
              r="3"
              fill="#ff7c00"
              initial={{ cx: 310, cy: 160 }}
              animate={{ cx: 350 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            />
          )}

          {/* Connector 2: Panel 2 to Panel 3 */}
          <path
            d="M 660 160 H 700"
            fill="none"
            stroke="#27272a"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          {/* Glowing particle 2 */}
          {step >= 2 && (
            <motion.circle
              r="3"
              fill="#00ff66"
              initial={{ cx: 660, cy: 160 }}
              animate={{ cx: 700 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            />
          )}
        </svg>
      </div>

      {/* PANEL 1: RAW_SPRITE_SHEET */}
      <div className="bg-[#09090b] border border-zinc-800 rounded-lg p-4 flex flex-col h-[340px] relative z-10 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
            <span className="text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
              01 // INPUT_SHEET
            </span>
          </div>
          <span className="text-zinc-600 text-[10px]">rpg_pack_v1.png</span>
        </div>

        {/* Grid representing Sprite Sheet */}
        <div className="flex-1 grid grid-cols-3 gap-3 items-center justify-center p-2 relative bg-black/60 rounded border border-zinc-900 overflow-hidden">
          
          {/* Subtle grid lines in background */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f1f23_1px,transparent_1px),linear-gradient(to_bottom,#1f1f23_1px,transparent_1px)] bg-[size:33.33%_50%] pointer-events-none opacity-40" />

          {SIMULATED_ITEMS.map((item, idx) => {
            const isScanned = scannedItems.includes(item.id);
            const isNamed = namedItems.includes(item.id);
            const isActive = activeItemIndex === idx;

            return (
              <div
                key={item.id}
                className={`aspect-square flex flex-col items-center justify-center rounded border transition-all duration-300 relative ${
                  isActive
                    ? "border-[#ff7c00] bg-orange-950/20 shadow-[0_0_15px_rgba(255,124,0,0.15)]"
                    : isNamed
                    ? "border-[#00ff66] bg-emerald-950/10"
                    : isScanned
                    ? "border-orange-500/50 bg-orange-950/5"
                    : "border-zinc-800 bg-zinc-950/40"
                }`}
              >
                <div
                  style={{ color: item.color }}
                  className={`w-10 h-10 flex items-center justify-center transition-transform duration-300 ${
                    isActive ? "scale-110" : ""
                  }`}
                >
                  <svg viewBox="0 0 40 40" className="w-8 h-8 fill-current">
                    {item.svgPath}
                  </svg>
                </div>

                {/* AI Predicted name overlay banner */}
                {isNamed && (
                  <motion.span
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute -bottom-1.5 px-1 bg-[#00ff66] text-black text-[7px] font-bold tracking-tight rounded-sm max-w-[90%] truncate text-center shadow-md scale-90"
                  >
                    {item.name}
                  </motion.span>
                )}

                {/* Tracking cursor effect */}
                {isActive && (
                  <span className="absolute -top-1 -left-1 text-[8px] text-[#ff7c00] font-black leading-none">
                    ┌
                  </span>
                )}
                {isActive && (
                  <span className="absolute -bottom-1 -right-1 text-[8px] text-[#ff7c00] font-black leading-none">
                    ┘
                  </span>
                )}
              </div>
            );
          })}

          {/* Radar Sweep Effect (Step 1) */}
          {step === 1 && (
            <motion.div
              initial={{ y: "-100%" }}
              animate={{ y: "100%" }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="absolute inset-x-0 h-1 bg-[#ff7c00]/60 shadow-[0_0_12px_#ff7c00] z-20 pointer-events-none"
            />
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-[9px] text-zinc-500">
          <span>PIXELS: 256x256</span>
          <span>FORMAT: RGBA_8888</span>
        </div>
      </div>

      {/* PANEL 2: CORE PIPELINE ENGINE */}
      <div className="bg-[#09090b] border border-zinc-800 rounded-lg p-4 flex flex-col h-[340px] relative z-10 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <Cpu className={`h-3 w-3 ${step > 0 && step < 4 ? "text-[#ff7c00] animate-spin" : "text-zinc-500"}`} />
            <span className="text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
              02 // ENGINE_PROCESSOR
            </span>
          </div>
          <span className="text-zinc-600 text-[10px]">AI</span>
        </div>

        {/* Code Logs Screen */}
        <div ref={logContainerRef} className="flex-1 bg-black rounded p-3 overflow-y-auto border border-zinc-900 scrollbar-none flex flex-col gap-1.5">
          <AnimatePresence>
            {logs.map((log, i) => {
              let colorClass = "text-zinc-400";
              if (log.startsWith("[OK]") || log.startsWith("[SUCCESS]")) colorClass = "text-[#00ff66]";
              if (log.startsWith("[ERROR]")) colorClass = "text-red-500";
              if (log.startsWith("[AI_LABEL]") || log.startsWith("[AI]")) colorClass = "text-amber-400";
              if (log.startsWith("[EXEC]")) colorClass = "text-zinc-500";

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`text-[9px] leading-relaxed break-all ${colorClass}`}
                >
                  {log}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Processing Indicator bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1 text-[9px] text-zinc-500">
            <span>PIPELINE CAPACITY</span>
            <span>{step === 4 ? "100%" : step === 3 ? "90%" : step === 2 ? "60%" : step === 1 ? "30%" : "0%"}</span>
          </div>
          <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
            <motion.div
              className={`h-full ${step === 4 ? "bg-[#00ff66]" : "bg-[#ff7c00]"}`}
              initial={{ width: "0%" }}
              animate={{
                width:
                  step === 4
                    ? "100%"
                    : step === 3
                    ? "90%"
                    : step === 2
                    ? "60%"
                    : step === 1
                    ? "30%"
                    : "0%",
              }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      </div>

      {/* PANEL 3: OUTPUT TREE & DOWNLOAD */}
      <div className="bg-[#09090b] border border-zinc-800 rounded-lg p-4 flex flex-col h-[340px] relative z-10 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${step === 4 ? "bg-[#00ff66] animate-pulse" : "bg-zinc-700"}`} />
            <span className="text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
              03 // STRUCTURED_ZIP
            </span>
          </div>
          <span className="text-zinc-600 text-[10px]">rpg_assets.zip</span>
        </div>

        {/* Structured Files list display */}
        <div className="flex-1 bg-black/50 rounded border border-zinc-900 p-3 flex flex-col justify-between overflow-hidden">
          
          <div className="space-y-1 overflow-y-auto">
            <div className="text-zinc-500 text-[9px] select-none">├── assets/</div>
            
            {SIMULATED_ITEMS.map((item) => {
              const isRendered = namedItems.includes(item.id) || step >= 3;
              return (
                <div key={item.id} className="h-5 flex items-center justify-between pl-4">
                  {isRendered ? (
                    <motion.div
                      initial={{ opacity: 0, x: 5 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-1.5"
                    >
                      <span className="text-zinc-500 font-mono text-[9px]">│   ├──</span>
                      <span className="text-zinc-300 font-mono text-[9px] hover:text-white transition-colors">
                        {item.predictedName}
                      </span>
                    </motion.div>
                  ) : (
                    <span className="text-zinc-800 font-mono text-[9px]">│   ├── [ awaiting... ]</span>
                  )}
                  {isRendered && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="text-[#00ff66]"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                    </motion.div>
                  )}
                </div>
              );
            })}
            {step >= 3 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-zinc-500 text-[9px] select-none"
              >
                └── export_package.zip
              </motion.div>
            )}
          </div>

          {/* Glowing CTA inside Panel */}
          <div className="pt-2">
            {step === 4 ? (
              <motion.button
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full py-2.5 rounded bg-[#00ff66] text-black font-bold uppercase tracking-wider text-[10px] flex items-center justify-center gap-2 hover:bg-[#00e55b] transition-all cursor-pointer shadow-[0_0_20px_rgba(0,255,102,0.3)] border border-[#00ff66]"
              >
                <Download className="h-3.5 w-3.5" />
                Download Zip
              </motion.button>
            ) : (
              <button
                disabled
                className="w-full py-2.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-600 font-bold uppercase tracking-wider text-[10px] flex items-center justify-center gap-2 cursor-not-allowed"
              >
                {step === 3 ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping mr-1" />
                    Packing zip...
                  </>
                ) : (
                  <>
                    <Terminal className="h-3.5 w-3.5" />
                    Awaiting compiler
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
