"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, AlertTriangle, CheckCircle, Zap, ShieldAlert, Sparkles, Download } from "lucide-react";

export function ScreenComparison() {
  const [timer, setTimer] = useState(0);
  const [manualStep, setManualStep] = useState(0); // 0: idle, 1: crop sword, 2: type sword, 3: save sword, 4: crop potion, 5: type potion, 6: save potion...
  const [magicStep, setMagicStep] = useState(0); // 0: idle, 1: file drop, 2: scan, 3: labeled, 4: zip ready
  const [manualText, setManualText] = useState("");
  const [magicProgress, setMagicProgress] = useState(0);

  // General Timer count
  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Manual Slicing Loop (Slow & Tedious)
  useEffect(() => {
    let timerId: NodeJS.Timeout;

    const runManual = () => {
      // Step 0: Move cursor to Sword
      setManualStep(0);
      setManualText("");
      
      // Step 1: Selecting Sword
      timerId = setTimeout(() => {
        setManualStep(1); // Crop sword select
        
        // Step 2: Typing Sword Name
        timerId = setTimeout(() => {
          setManualStep(2);
          let txt = "sword_knight_gold_final_v3.png";
          let charIdx = 0;
          const typer = setInterval(() => {
            if (charIdx <= txt.length) {
              setManualText(txt.slice(0, charIdx));
              charIdx++;
            } else {
              clearInterval(typer);
              
              // Step 3: Click Save Sword
              timerId = setTimeout(() => {
                setManualStep(3); // Saved!
                
                // Step 4: Move cursor to Potion
                timerId = setTimeout(() => {
                  setManualStep(4); // Crop potion select
                  setManualText("");
                  
                  // Step 5: Typing Potion Name
                  timerId = setTimeout(() => {
                    setManualStep(5);
                    let potTxt = "potion_blue_mana_revised_temp.png";
                    let pCharIdx = 0;
                    const pTyper = setInterval(() => {
                      if (pCharIdx <= potTxt.length) {
                        setManualText(potTxt.slice(0, pCharIdx));
                        pCharIdx++;
                      } else {
                        clearInterval(pTyper);
                        
                        // Step 6: Click Save Potion
                        timerId = setTimeout(() => {
                          setManualStep(6); // Saved!
                          
                          // Restart loop after delay
                          timerId = setTimeout(() => {
                            runManual();
                          }, 3000);
                        }, 1000);
                      }
                    }, 80);
                  }, 1200);
                }, 1500);
              }, 1200);
            }
          }, 80);
        }, 1500);
      }, 1500);
    };

    runManual();
    return () => clearTimeout(timerId);
  }, []);

  // Magic open_assets Loop (Blazing Fast)
  useEffect(() => {
    let timerId: NodeJS.Timeout;

    const runMagic = () => {
      setMagicStep(0);
      setMagicProgress(0);

      // Step 1: Drop file
      timerId = setTimeout(() => {
        setMagicStep(1);

        // Step 2: Sweep Scan OpenCV
        timerId = setTimeout(() => {
          setMagicStep(2);

          // Animate progress bar to 100% in 400ms
          let prog = 0;
          const progressInterval = setInterval(() => {
            if (prog < 100) {
              prog += 10;
              setMagicProgress(prog);
            } else {
              clearInterval(progressInterval);
              setMagicStep(3); // Naming labeled complete

              // Step 4: Zip export completed
              timerId = setTimeout(() => {
                setMagicStep(4);

                // Restart magic loop
                timerId = setTimeout(() => {
                  runMagic();
                }, 8000);
              }, 1500);
            }
          }, 40);
        }, 800);
      }, 1200);
    };

    runMagic();
    return () => clearTimeout(timerId);
  }, []);

  // Helper formatting for timer
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <section className="bg-background border-t border-zinc-200 dark:border-zinc-900 py-24 px-6 relative font-mono text-xs text-zinc-600 dark:text-zinc-300">
      
      <div className="w-full max-w-5xl mx-auto relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-20 space-y-4">
          <span className="text-[10px] font-bold text-[#ff7c00] uppercase tracking-widest block">
            [ COMPARATIVE_STUDY ]
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl">
            Manual labor ➔ Instant magic
          </h2>
          <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
            Witness how the traditional asset-slicing chore compares side-by-side to open_assets' bulk-extraction pipeline.
          </p>
        </div>

        {/* Panels Wrapper */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          
          {/* LEFT: MANUAL_PANEL */}
          <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 flex flex-col justify-between h-[380px] shadow-2xl relative overflow-hidden group">
            
            {/* Red header border */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-red-600/60" />

            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5 text-red-500 animate-pulse" />
                <span className="text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                  01 // MANUAL_SLICING_PAIN
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-red-500 text-[10px] font-bold">
                <Clock className="h-3 w-3" />
                <span>ELAPSED: {formatTime(timer)}</span>
              </div>
            </div>

            {/* Simulated Desktop Workspace */}
            <div className="flex-1 bg-white/60 dark:bg-black/60 rounded border border-zinc-200 dark:border-zinc-900 p-4 relative overflow-hidden flex flex-col justify-between">
              
              {/* Asset grid in figma */}
              <div className="grid grid-cols-4 gap-3 relative">
                
                {/* Simulated Figma selection boxes */}
                {[
                  { id: 1, name: "sword", color: "text-amber-500" },
                  { id: 2, name: "potion", color: "text-blue-500" },
                  { id: 3, name: "key", color: "text-orange-500" },
                  { id: 4, name: "shield", color: "text-zinc-500" },
                ].map((item, idx) => {
                  const isSwordActive = (manualStep === 1 || manualStep === 2) && idx === 0;
                  const isSwordSaved = manualStep >= 3 && idx === 0;
                  const isPotionActive = (manualStep === 4 || manualStep === 5) && idx === 1;
                  const isPotionSaved = manualStep >= 6 && idx === 1;
                  
                  return (
                    <div
                      key={item.id}
                      className={`aspect-square flex items-center justify-center border rounded relative transition-all duration-200 ${
                        isSwordActive || isPotionActive
                          ? "border-red-500 bg-red-50 dark:bg-red-950/5 shadow-[0_0_10px_rgba(239,68,68,0.15)]"
                          : isSwordSaved || isPotionSaved
                          ? "border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950/20 opacity-40"
                          : "border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/40"
                      }`}
                    >
                      <span className={`text-[9px] uppercase font-bold text-zinc-600 ${isSwordActive || isPotionActive ? "text-red-500" : ""}`}>
                        {item.name}
                      </span>

                      {/* Mock Figma selection dots */}
                      {(isSwordActive || isPotionActive) && (
                        <>
                          <span className="absolute -top-1 -left-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
                          <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
                          <span className="absolute -bottom-1 -left-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
                          <span className="absolute -bottom-1 -right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Simulated slow cursor arrow */}
                <motion.div
                  className="absolute z-30 pointer-events-none text-red-500 drop-shadow-lg font-black"
                  animate={
                    manualStep === 0
                      ? { x: 20, y: 15 } // Over sword
                      : manualStep <= 3
                      ? { x: 30, y: 25 } // Clicking sword
                      : manualStep === 4
                      ? { x: 100, y: 15 } // Over potion
                      : { x: 110, y: 25 } // Clicking potion
                  }
                  transition={{ duration: 1.2, ease: "easeInOut" }}
                >
                  ⬉
                </motion.div>
              </div>

              {/* Mock Photoshop/Figma Save As dialog */}
              <AnimatePresence>
                {(manualStep === 2 || manualStep === 5) && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute inset-x-4 top-1/2 -translate-y-1/2 bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 p-3 rounded shadow-2xl z-20 space-y-2.5 font-sans"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-1.5 text-[8px] text-zinc-500 uppercase tracking-widest font-mono">
                      <span>File_Exporter // Save_As</span>
                      <span className="text-red-500">layer_select_ok</span>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-500 uppercase font-mono">Filename:</label>
                      <div className="h-6 bg-zinc-100 dark:bg-black border border-zinc-300 dark:border-zinc-800 rounded px-2 flex items-center font-mono text-[9px] text-zinc-900 dark:text-white">
                        {manualText}
                        <span className="w-1 h-3 bg-red-500 animate-pulse ml-0.5" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 text-[8px] uppercase font-mono font-bold">
                      <span className="px-2 py-1 border border-zinc-200 dark:border-zinc-800 text-zinc-500 rounded">Cancel</span>
                      <span className="px-2 py-1 bg-red-600/30 border border-red-500 text-red-500 rounded animate-pulse">Save_As</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Manual Progress Log */}
              <div className="mt-4 border-t border-zinc-200 dark:border-zinc-900 pt-3 flex flex-col gap-1 text-[9px] text-zinc-600 dark:text-zinc-500 font-mono">
                <div className="flex items-center justify-between">
                  <span>WORKSPACE FATIGUE LEVEL</span>
                  <span className="text-red-500 font-bold">CRITICAL (85%)</span>
                </div>
                <div className="h-1 bg-zinc-200 dark:bg-zinc-950 rounded-full overflow-hidden border border-zinc-300 dark:border-zinc-900">
                  <div className="h-full bg-red-600 animate-pulse" style={{ width: "85%" }} />
                </div>
                <div className="text-[8px] text-red-600 uppercase mt-1 animate-pulse">
                  ⚠ Slicing remaining: 14 assets · 12 minutes estimated
                </div>
              </div>
            </div>

            <div className="mt-3 text-[9px] text-zinc-400 dark:text-zinc-600 flex justify-between uppercase">
              <span>Tool: Figma/Photoshop Manual Crop</span>
              <span>Uptime: Poor</span>
            </div>
          </div>

          {/* RIGHT: MAGIC_PANEL */}
          <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-880 rounded-lg p-5 flex flex-col justify-between h-[380px] shadow-2xl relative overflow-hidden group">
            
            {/* Green header border */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-[#00ff66]/80" />

            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-[#00ff66] animate-bounce" />
                <span className="text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                  02 // OPEN_ASSETS_MAGIC
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[#00ff66] text-[10px] font-bold">
                <CheckCircle className="h-3 w-3" />
                <span>ELAPSED: 00:00.4</span>
              </div>
            </div>

            {/* Open Assets Cloud Workspace */}
            <div className="flex-1 bg-white/60 dark:bg-black/60 rounded border border-zinc-200 dark:border-zinc-900 p-4 relative overflow-hidden flex flex-col justify-between">
              
              {/* Animation step states */}
              <div className="flex-1 flex flex-col justify-between overflow-hidden">
                
                {magicStep === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950/20 rounded p-6 text-center space-y-2">
                    <Download className="h-6 w-6 text-zinc-700 animate-pulse" />
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wide">
                      DRAG_AND_DROP_SPRITESHEET_HERE
                    </span>
                    <span className="text-[8px] text-zinc-600 font-mono">// supports png, jpg, ui_kits</span>
                  </div>
                )}

                {magicStep === 1 && (
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex-1 flex flex-col items-center justify-center border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950/40 rounded p-6 text-center space-y-1.5"
                  >
                    <span className="h-2 w-2 rounded-full bg-[#ff7c00] animate-ping" />
                    <span className="text-[9px] font-bold text-amber-500 uppercase">
                      FILE_RECEIVED: sprite_sheet_rpg.png
                    </span>
                    <span className="text-[8px] text-zinc-500">// uploading to edge nodes...</span>
                  </motion.div>
                )}

                {magicStep >= 2 && (
                  <div className="flex-1 grid grid-cols-4 gap-3 relative">
                    
                    {/* Items grid instantly lighting up green */}
                    {[
                      { id: 1, label: "sword_knight.png" },
                      { id: 2, label: "potion_mana.png" },
                      { id: 3, label: "key_dungeon.png" },
                      { id: 4, label: "shield_steel.png" },
                    ].map((item, idx) => {
                      const isScanned = magicStep >= 2;
                      const isLabeled = magicStep >= 3;
                      
                      return (
                        <div
                          key={item.id}
                          className={`aspect-square flex flex-col items-center justify-center border rounded relative transition-all duration-300 ${
                            isLabeled
                              ? "border-[#00ff66] bg-emerald-50 dark:bg-emerald-950/10 shadow-[0_0_10px_rgba(0,255,102,0.15)]"
                              : isScanned
                              ? "border-[#ff7c00] bg-orange-50 dark:bg-orange-950/10"
                              : "border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/40"
                          }`}
                        >
                          <span className={`text-[9px] uppercase font-bold ${isLabeled ? "text-[#00ff66]" : "text-amber-500 animate-pulse"}`}>
                            {item.label.split("_")[0]}
                          </span>

                          {/* AI Naming text bubble overlay */}
                          {isLabeled && (
                            <motion.span
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="absolute -bottom-1 px-1 bg-[#00ff66] text-black text-[6px] font-black tracking-tight rounded-sm truncate text-center shadow max-w-[90%] scale-90"
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </div>
                      );
                    })}

                    {/* Blazing fast scanning laser line */}
                    {magicStep === 2 && (
                      <motion.div
                        initial={{ y: "-10%" }}
                        animate={{ y: "100%" }}
                        transition={{ duration: 0.4, ease: "linear" }}
                        className="absolute inset-x-0 h-[2px] bg-[#00ff66] shadow-[0_0_10px_#00ff66] z-20 pointer-events-none"
                      />
                    )}
                  </div>
                )}

                {/* API Output folder compiled box */}
                {magicStep === 4 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 p-2 border border-zinc-200 dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-950/50 rounded flex items-center justify-between font-mono text-[8px] tracking-tight text-zinc-600 dark:text-zinc-400"
                  >
                    <div className="flex items-center gap-1.5 text-zinc-300">
                      <CheckCircle className="h-3.5 w-3.5 text-[#00ff66]" />
                      <span>assets_extracted.zip [COMPILATION SUCCESS]</span>
                    </div>
                    <span className="text-[#00ff66] font-bold uppercase text-[7px] border border-[#00ff66] px-1 rounded animate-pulse">
                      READY
                    </span>
                  </motion.div>
                )}

              </div>

              {/* Cloud Progress indicator */}
              <div className="mt-4 border-t border-zinc-200 dark:border-zinc-900 pt-3 flex flex-col gap-1 text-[9px] text-zinc-600 dark:text-zinc-500 font-mono">
                <div className="flex items-center justify-between">
                  <span>PRODUCTION EDGE PIPELINE</span>
                  <span className={magicStep >= 3 ? "text-[#00ff66] font-bold" : "text-[#ff7c00] font-bold"}>
                    {magicStep === 4 ? "COMPLETE (100%)" : magicStep === 3 ? "LABELED (90%)" : magicStep === 2 ? "SCANNING (40%)" : "STANDBY (0%)"}
                  </span>
                </div>
                <div className="h-1 bg-zinc-200 dark:bg-zinc-950 rounded-full overflow-hidden border border-[#27272a]/20">
                  <motion.div
                    className={`h-full ${magicStep === 4 ? "bg-[#00ff66]" : "bg-[#ff7c00]"}`}
                    initial={{ width: "0%" }}
                    animate={{
                      width:
                        magicStep === 4
                           ? "100%"
                           : magicStep === 3
                           ? "90%"
                           : magicStep === 2
                           ? `${magicProgress}%`
                           : "0%",
                    }}
                    transition={{ duration: 0.15 }}
                  />
                </div>
                <div className={`text-[8px] uppercase mt-1 ${magicStep === 4 ? "text-[#00ff66]" : "text-zinc-600"}`}>
                  {magicStep === 4
                    ? "✓ 4 assets sliced, named, packed · 0.4 seconds total"
                    : "⚡ Waiting for payload injection..."}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[9px] text-zinc-400 dark:text-zinc-600 flex justify-between uppercase">
              <span>Engine: cv2_cuda + AI_vision</span>
              <span>Efficiency: 100%</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
