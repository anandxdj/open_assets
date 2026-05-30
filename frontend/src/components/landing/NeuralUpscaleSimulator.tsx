"use client";

import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Cpu, Zap, Sliders, RefreshCw, Layers } from "lucide-react";
import { motion } from "motion/react";

// 16x16 Pixel Art Potion bottle definition
const PIXEL_GRID = [
  "                ",
  "                ",
  "      K K       ",
  "     K C C K    ",
  "      K K       ",
  "     K G G K    ",
  "    K G G G G K ",
  "   K G W W G G K",
  "  K G W P P M G K",
  "  K G P P P M M K",
  "  K G P P P M M K",
  "  K G D D P M M K",
  "  K G D D D M M K",
  "   K G D D M M K",
  "    K K K K K K ",
  "                "
];

const COLOR_MAP: Record<string, string> = {
  "K": "#0e0e11", // Outline
  "C": "#b0754c", // Cork
  "G": "#a3efff", // Glass border
  "W": "#ffffff", // Shine/Highlight
  "P": "#9b5de5", // Bright potion purple
  "M": "#f15bb5", // Potion hot pink
  "D": "#5c3d99", // Dark potion violet
};

export function NeuralUpscaleSimulator() {
  const [sliderPos, setSliderPos] = useState(50); // 0 to 100
  const [scaleFactor, setScaleFactor] = useState(4); // 2 or 4
  const [upscaleMode, setUpscaleMode] = useState<"convolutional" | "nearest">("convolutional");
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(percentage);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      handleMove(e.touches[0].clientX);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (e.buttons === 1 || isDragging) {
      handleMove(e.clientX);
    }
  };

  // Render Low-Res 16-bit SVG Pixel Sprite
  const renderPixelSprite = () => {
    return (
      <svg viewBox="0 0 160 160" className="w-full h-full select-none pointer-events-none">
        {PIXEL_GRID.map((row, rIdx) =>
          row.split("").map((char, cIdx) => {
            const color = COLOR_MAP[char];
            if (!color) return null;
            return (
              <rect
                key={`${rIdx}-${cIdx}`}
                x={cIdx * 10}
                y={rIdx * 10}
                width={10}
                height={10}
                fill={color}
              />
            );
          })
        )}
      </svg>
    );
  };

  // Render High-Res Smooth Upscaled SVG Vector Sprite
  const renderSmoothSprite = () => {
    return (
      <svg viewBox="0 0 160 160" className="w-full h-full select-none pointer-events-none filter drop-shadow-[0_0_12px_rgba(241,91,181,0.25)]">
        {/* Glow behind fluid */}
        <circle cx="80" cy="95" r="32" fill="url(#potionGlow)" opacity="0.45" />

        {/* Cork */}
        <path d="M72,25 L88,25 L86,40 L74,40 Z" fill="#b0754c" stroke="#0e0e11" strokeWidth="2.5" strokeLinejoin="round" />
        <ellipse cx="80" cy="25" rx="8" ry="2.5" fill="#c98a5d" stroke="#0e0e11" strokeWidth="2.5" />
        
        {/* Bottle neck */}
        <path d="M70,40 L90,40 L90,56 L70,56 Z" fill="#e0f9ff" stroke="#0e0e11" strokeWidth="2.5" strokeLinejoin="round" />

        {/* Smooth Glass Bottle body */}
        <path
          d="M70,56 
             C62,56 50,70 50,92 
             C50,118 62,126 80,126 
             C98,126 110,118 110,92 
             C110,70 98,56 90,56 Z"
          fill="none"
          stroke="#0e0e11"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />

        {/* Liquid body */}
        <path
          d="M52.2,92
             C52.2,114.5 63,123.5 80,123.5
             C97,123.5 107.8,114.5 107.8,92
             C107.8,90 102,89 80,89
             C58,89 52.2,90 52.2,92 Z"
          fill="url(#potionLiquid)"
          stroke="#0e0e11"
          strokeWidth="2"
        />

        {/* Liquid Surface Lip */}
        <ellipse cx="80" cy="89.5" rx="27.8" ry="4.5" fill="#f15bb5" opacity="0.85" />
        
        {/* Liquid Highlights (animated bubbles) */}
        <circle cx="68" cy="108" r="3" fill="#ffffff" opacity="0.5" />
        <circle cx="92" cy="102" r="2" fill="#ffffff" opacity="0.6" />
        <circle cx="78" cy="114" r="1.5" fill="#ffffff" opacity="0.4" />

        {/* Glass Highlights / Reflection */}
        <path
          d="M55,84 
             C53.5,92 53.5,102 56,112"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* Gradients declarations */}
        <defs>
          <radialGradient id="potionGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f15bb5" />
            <stop offset="100%" stopColor="#9b5de5" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="potionLiquid" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f15bb5" />
            <stop offset="50%" stopColor="#9b5de5" />
            <stop offset="100%" stopColor="#5c3d99" />
          </linearGradient>
        </defs>
      </svg>
    );
  };

  return (
    <section id="neural-upscale" className="bg-zinc-950 border-b border-zinc-900 py-24 px-6 relative overflow-hidden select-none">
      {/* Background neon blur grid */}
      <div className="absolute top-1/2 left-2/3 -translate-y-1/2 w-[450px] h-[450px] bg-gradient-to-tr from-[#f15bb5]/5 to-[#9b5de5]/5 rounded-full blur-[130px] pointer-events-none z-0" />
      <div className="absolute inset-0 bg-[radial-gradient(#ffffff02_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-40" />

      <div className="mx-auto max-w-5xl relative z-10 space-y-16">
        
        {/* Header Block */}
        <div className="text-center max-w-xl mx-auto space-y-3">
          <span className="text-[10px] font-bold text-[#ff7c00] uppercase tracking-widest block font-mono">
            [ NEURAL_UPSCALE_SIMULATOR ]
          </span>
          <h2 className="text-2xl font-black uppercase tracking-tight text-foreground sm:text-3xl font-mono">
            Super-Resolution Slicing
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 font-mono leading-relaxed max-w-md mx-auto">
            Interact with the neural upscaler. Drag the comparison slider to reveal how convolutional AI reconstructs coarse pixels into smooth, high-fidelity vectorized sprites.
          </p>
        </div>

        {/* Main Grid: Interactive Canvas Left, Dashboard Specs Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Slider Reveal Container */}
          <div className="lg:col-span-6 flex flex-col items-center gap-4">
            <div
              ref={containerRef}
              className="relative w-[280px] h-[280px] sm:w-[360px] sm:h-[360px] bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl cursor-ew-resize select-none backdrop-blur-md"
              onMouseMove={handleMouseMove}
              onTouchMove={handleTouchMove}
              onMouseDown={() => setIsDragging(true)}
              onMouseUp={() => setIsDragging(false)}
              onMouseLeave={() => setIsDragging(false)}
            >
              {/* Dot matrix grid inside canvas */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: "radial-gradient(circle, #ffffff04 1px, transparent 1px)",
                  backgroundSize: "16px 16px",
                }}
              />

              {/* Low-Res Sprite Container (Left Layer) */}
              <div className="absolute inset-0 flex items-center justify-center p-12">
                <div className="w-[180px] h-[180px] sm:w-[220px] sm:h-[220px]">
                  {renderPixelSprite()}
                </div>
              </div>

              {/* High-Res Sprite Container (Right Layer, clipped by width) */}
              <div
                className="absolute inset-0 flex items-center justify-center p-12 bg-zinc-900 border-r border-[#ff7c00]"
                style={{
                  width: `${sliderPos}%`,
                  transition: isDragging ? "none" : "width 0.1s ease-out",
                  overflow: "hidden"
                }}
              >
                {/* Maintain constant width so it overlays exactly */}
                <div className="absolute inset-0 w-[280px] h-[280px] sm:w-[360px] sm:h-[360px] flex items-center justify-center p-12 bg-zinc-900">
                  <div
                    className="w-[180px] h-[180px] sm:w-[220px] sm:h-[220px]"
                    style={{
                      transform: upscaleMode === "nearest" ? "none" : `scale(${scaleFactor === 4 ? 1.05 : 1.01})`,
                      transition: "transform 0.2s"
                    }}
                  >
                    {upscaleMode === "nearest" ? renderPixelSprite() : renderSmoothSprite()}
                  </div>
                </div>
              </div>

              {/* Slider Drag Handle */}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-[#ff7c00] pointer-events-none"
                style={{
                  left: `${sliderPos}%`,
                  transition: isDragging ? "none" : "left 0.1s ease-out",
                }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-8 bg-zinc-950 border-2 border-[#ff7c00] rounded-full shadow-xl flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform duration-200">
                  <Sliders className="h-3.5 w-3.5 text-[#ff7c00]" />
                </div>
              </div>

              {/* Badges labels indicating sides */}
              <div className="absolute bottom-3 left-3 bg-black/60 border border-zinc-800 px-2 py-0.5 rounded text-[8px] font-black uppercase text-zinc-400 tracking-wider font-mono">
                16-Bit Coarse Raster
              </div>
              <div className="absolute bottom-3 right-3 bg-zinc-950 border border-[#ff7c00]/30 px-2 py-0.5 rounded text-[8px] font-black uppercase text-[#ff7c00] tracking-wider font-mono">
                {upscaleMode === "nearest" ? `NEAREST NEIGHBOR ${scaleFactor}X` : `AI CONVNET ${scaleFactor}X`}
              </div>
            </div>

            {/* Slider drag instructional hint */}
            <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest leading-none">
              ← Drag slider to filter layers →
            </span>
          </div>

          {/* Right Column: Convolutional Matrix Visualizer & controls */}
          <div className="lg:col-span-6 space-y-6">
            
            {/* Interactive Control Panel */}
            <div className="border border-zinc-800 bg-zinc-900/40 p-6 rounded-xl space-y-4 font-mono">
              <span className="text-[10px] text-zinc-400 font-black tracking-widest block uppercase">
                [ CONTROLS ] RECONSTRUCTION PRESETS
              </span>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Scale toggle */}
                <div className="space-y-1.5 text-left">
                  <label className="text-[9px] text-zinc-500 uppercase font-black">Upscale Target</label>
                  <div className="flex gap-2 bg-black p-1 rounded border border-zinc-800">
                    <button
                      onClick={() => setScaleFactor(2)}
                      className={`flex-1 py-1 text-[10px] uppercase font-black rounded transition-colors ${
                        scaleFactor === 2
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      2× Neural
                    </button>
                    <button
                      onClick={() => setScaleFactor(4)}
                      className={`flex-1 py-1 text-[10px] uppercase font-black rounded transition-colors ${
                        scaleFactor === 4
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      4× Neural
                    </button>
                  </div>
                </div>

                {/* 2. Filter mode toggle */}
                <div className="space-y-1.5 text-left">
                  <label className="text-[9px] text-zinc-500 uppercase font-black">Processing Kernel</label>
                  <div className="flex gap-2 bg-black p-1 rounded border border-zinc-800">
                    <button
                      onClick={() => setUpscaleMode("nearest")}
                      className={`flex-1 py-1 text-[10px] uppercase font-black rounded transition-colors ${
                        upscaleMode === "nearest"
                          ? "bg-red-950/40 border border-red-900/30 text-red-400"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Nearest
                    </button>
                    <button
                      onClick={() => setUpscaleMode("convolutional")}
                      className={`flex-1 py-1 text-[10px] uppercase font-black rounded transition-colors ${
                        upscaleMode === "convolutional"
                          ? "bg-[#00ff66]/10 border border-[#00ff66]/20 text-[#00ff66]"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      AI SR-CNN
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Neural Net Layer Animation nodes SVG */}
            <div className="border border-zinc-900 bg-black/45 p-6 rounded-xl font-mono text-left space-y-4">
              <span className="text-[9px] text-zinc-500 font-black tracking-widest block uppercase">
                [ VISUALIZER ] CONVOLUTIONAL MATRIX STATUS
              </span>

              <div className="relative w-full h-[100px] flex items-center justify-center">
                {/* SVG Network Connections Graph */}
                <svg className="absolute inset-0 w-full h-full opacity-40">
                  {/* Lines Input to Hidden 1 */}
                  {Array.from({ length: 4 }).map((_, i) =>
                    Array.from({ length: 5 }).map((_, j) => (
                      <line
                        key={`i-h1-${i}-${j}`}
                        x1="12.5%"
                        y1={`${20 + i * 20}%`}
                        x2="37.5%"
                        y2={`${10 + j * 20}%`}
                        stroke={upscaleMode === "nearest" ? "#7f1d1d" : "#9b5de5"}
                        strokeWidth="0.75"
                      />
                    ))
                  )}

                  {/* Lines Hidden 1 to Hidden 2 */}
                  {Array.from({ length: 5 }).map((_, i) =>
                    Array.from({ length: 5 }).map((_, j) => (
                      <line
                        key={`h1-h2-${i}-${j}`}
                        x1="37.5%"
                        y1={`${10 + i * 20}%`}
                        x2="62.5%"
                        y2={`${10 + j * 20}%`}
                        stroke={upscaleMode === "nearest" ? "#7f1d1d" : "#f15bb5"}
                        strokeWidth="0.75"
                      />
                    ))
                  )}

                  {/* Lines Hidden 2 to Output */}
                  {Array.from({ length: 5 }).map((_, i) =>
                    Array.from({ length: 4 }).map((_, j) => (
                      <line
                        key={`h2-o-${i}-${j}`}
                        x1="62.5%"
                        y1={`${10 + i * 20}%`}
                        x2="87.5%"
                        y2={`${20 + j * 20}%`}
                        stroke={upscaleMode === "nearest" ? "#7f1d1d" : "#00ff66"}
                        strokeWidth="0.75"
                      />
                    ))
                  )}

                  {/* Animated traveling dash packets */}
                  {upscaleMode === "convolutional" && (
                    <>
                      <path
                        d="M 50 50 L 150 30"
                        fill="none"
                        stroke="#00ff66"
                        strokeWidth="1.5"
                        strokeDasharray="6 30"
                        style={{
                          animation: `dash ${isDragging ? "0.3s" : "1.2s"} linear infinite`
                        }}
                      />
                      <path
                        d="M 150 30 L 250 70"
                        fill="none"
                        stroke="#f15bb5"
                        strokeWidth="1.5"
                        strokeDasharray="6 24"
                        style={{
                          animation: `dash ${isDragging ? "0.4s" : "1.5s"} linear infinite`
                        }}
                      />
                      <path
                        d="M 250 70 L 350 50"
                        fill="none"
                        stroke="#a3efff"
                        strokeWidth="1.5"
                        strokeDasharray="8 20"
                        style={{
                          animation: `dash ${isDragging ? "0.2s" : "0.9s"} linear infinite`
                        }}
                      />
                    </>
                  )}
                </svg>

                {/* Nodes columns overlay */}
                <div className="absolute inset-0 flex justify-between items-center px-4 pointer-events-none">
                  {/* Column 1: Input */}
                  <div className="flex flex-col justify-around h-full w-8">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={`node-i-${i}`}
                        className={`size-2.5 rounded-full border transition-all duration-300 ${
                          upscaleMode === "nearest"
                            ? "bg-zinc-800 border-zinc-700"
                            : "bg-[#9b5de5] border-[#9b5de5] shadow-[0_0_8px_#9b5de5]"
                        }`}
                      />
                    ))}
                  </div>

                  {/* Column 2: Hidden 1 */}
                  <div className="flex flex-col justify-around h-full w-8">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={`node-h1-${i}`}
                        className={`size-2.5 rounded-full border transition-all duration-300 ${
                          upscaleMode === "nearest"
                            ? "bg-zinc-800 border-zinc-700"
                            : "bg-[#f15bb5] border-[#f15bb5] shadow-[0_0_8px_#f15bb5]"
                        }`}
                      />
                    ))}
                  </div>

                  {/* Column 3: Hidden 2 */}
                  <div className="flex flex-col justify-around h-full w-8">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={`node-h2-${i}`}
                        className={`size-2.5 rounded-full border transition-all duration-300 ${
                          upscaleMode === "nearest"
                            ? "bg-zinc-800 border-zinc-700"
                            : "bg-[#ff7c00] border-[#ff7c00] shadow-[0_0_8px_#ff7c00]"
                        }`}
                      />
                    ))}
                  </div>

                  {/* Column 4: Output */}
                  <div className="flex flex-col justify-around h-full w-8">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={`node-o-${i}`}
                        className={`size-2.5 rounded-full border transition-all duration-300 ${
                          upscaleMode === "nearest"
                            ? "bg-zinc-800 border-zinc-700"
                            : "bg-[#00ff66] border-[#00ff66] shadow-[0_0_8px_#00ff66]"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Status statistics logs */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 pt-2 border-t border-zinc-900 text-[10px] text-zinc-500 tracking-wider">
                <div className="flex justify-between">
                  <span>MODEL_KERNEL:</span>
                  <span className={upscaleMode === "nearest" ? "text-red-400" : "text-[#00ff66]"}>
                    {upscaleMode === "nearest" ? "NEAREST_NEIGHBOR" : "SPRITE_SR-CNN_V3"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>INTERPOLATION_MSE:</span>
                  <span className="text-zinc-300">{upscaleMode === "nearest" ? "0.0894" : "0.0014"}</span>
                </div>
                <div className="flex justify-between">
                  <span>EPOCH_WEIGHTS:</span>
                  <span className="text-zinc-300">142,600</span>
                </div>
                <div className="flex justify-between">
                  <span>LATENCY:</span>
                  <span className="text-zinc-300">{upscaleMode === "nearest" ? "1.2ms" : "11.6ms"}</span>
                </div>
              </div>
            </div>

          </div>
          
        </div>

      </div>

      {/* Global SVG dash animation styles */}
      <style jsx global>{`
        @keyframes dash {
          to {
            stroke-dashoffset: -100;
          }
        }
      `}</style>
    </section>
  );
}
