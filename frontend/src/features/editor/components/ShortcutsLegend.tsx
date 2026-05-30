"use client";

import { useState, useRef, useEffect } from "react";
import { Keyboard, X, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export function ShortcutsLegend() {
  const [isOpen, setIsOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (isOpen && legendRef.current && !legendRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const shortcuts = [
    { keys: ["V"], desc: "Select Tool" },
    { keys: ["R"], desc: "Draw bounding box Tool" },
    { keys: ["H"], desc: "Hand Tool (Pan canvas)" },
    { keys: ["Space", "Drag"], desc: "Temporary Pan canvas" },
    { keys: ["Alt", "Drag Box"], desc: "Duplicate Bounding Box" },
    { keys: ["Ctrl", "A"], desc: "Select All boxes" },
    { keys: ["Delete"], desc: "Delete selected boxes" },
    { keys: ["Ctrl", "Z"], desc: "Undo last change" },
    { keys: ["Ctrl", "Y"], desc: "Redo change" },
    { keys: ["Ctrl", "0"], desc: "Fit canvas to screen" },
    { keys: ["Scroll / Pinch"], desc: "Zoom & Pan camera" },
  ];

  return (
    <div className="absolute bottom-4 right-4 z-20 font-mono select-none" ref={legendRef}>
      {/* Floating Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Keyboard Shortcuts"
        className="w-8 h-8 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 backdrop-blur-sm border border-zinc-800 text-zinc-400 hover:text-zinc-100 flex items-center justify-center shadow-lg transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95"
      >
        <Keyboard size={15} />
      </button>

      {/* Shortcuts Cheat Sheet Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className="absolute bottom-10 right-0 w-80 bg-zinc-950/95 backdrop-blur-md border border-zinc-800 rounded-xl p-4 shadow-2xl space-y-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
              <span className="text-[10px] font-black tracking-widest text-[#ff7c00] uppercase flex items-center gap-1.5">
                <Info size={12} className="text-[#ff7c00]" />
                [ 00_KEYS ] WORKSPACE COMMANDS
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 hover:scale-105 transition-all duration-150 cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>

            {/* Keys grid */}
            <div className="space-y-2 max-h-75 overflow-y-auto pr-1">
              {shortcuts.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-[10px] text-zinc-400 font-medium">{s.desc}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {s.keys.map((k, kIdx) => (
                      <span key={kIdx} className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] font-black uppercase text-zinc-300 shadow-[1.5px_1.5px_0px_rgba(255,255,255,0.04)] select-none">
                          {k}
                        </kbd>
                        {kIdx < s.keys.length - 1 && <span className="text-[8px] text-zinc-600 font-bold">+</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Technical Sub-label */}
            <div className="pt-2 border-t border-zinc-900 text-[8px] text-zinc-600 uppercase flex items-center justify-between">
              <span>Status: Active_Listener</span>
              <span>Version: 0.1.0</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
