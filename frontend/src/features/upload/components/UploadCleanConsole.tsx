"use client";

import { useState, useRef, useEffect } from "react";
import { useFileUpload } from "@/features/upload/hooks/useFileUpload";
import { DropZone } from "./DropZone";
import { 
  Sparkles, 
  ChevronRight, 
  Loader2, 
  Grid,
  Upload,
  Layers,
  AlertCircle
} from "lucide-react";

type TabType = "upload" | "ai" | "presets";
type PresetType = "invaders" | "icons" | "tiles";
type AiStyleType = "pixel" | "vector" | "tiles" | "gadgets";

export function UploadCleanConsole() {
  const { upload, status, progress, error: uploadError } = useFileUpload();
  
  // View states
  const [activeTab, setActiveTab] = useState<TabType>("upload");
  const [activePreset, setActivePreset] = useState<PresetType | null>(null);
  
  // AI Ingestion state
  const [prompt, setPrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<AiStyleType>("pixel");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState("ENGINE STANDBY");

  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas drawing routines (Grayscale B&W)
  const drawPixelInvaders = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, 256, 256);
    const cellSize = 64;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const x = c * cellSize + 8;
        const y = r * cellSize + 8;
        const size = 48;
        const pixels = 8;
        const pSize = size / pixels;

        const pattern: boolean[][] = [];
        const seed = (r * 4 + c) * 37 + 13;
        for (let py = 0; py < pixels; py++) {
          pattern[py] = [];
          for (let px = 0; px < pixels / 2; px++) {
            const bit = ((seed + py * 9) ^ (px * 17)) % 2 === 0;
            pattern[py][px] = bit;
          }
        }

        ctx.fillStyle = "black";
        for (let py = 0; py < pixels; py++) {
          for (let px = 0; px < pixels; px++) {
            const mapX = px < 4 ? px : 7 - px;
            if (pattern[py][mapX]) {
              ctx.fillRect(x + px * pSize, y + py * pSize, pSize, pSize);
            }
          }
        }
      }
    }
  };

  const drawMinimalIcons = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, 256, 256);
    const cellSize = 85;
    ctx.fillStyle = "black";

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cx = c * cellSize + cellSize / 2;
        const cy = r * cellSize + cellSize / 2;
        const idx = r * 3 + c;

        ctx.strokeStyle = "#e4e4e7"; // zinc-200
        ctx.lineWidth = 1;
        ctx.strokeRect(c * cellSize + 8, r * cellSize + 8, cellSize - 16, cellSize - 16);

        ctx.strokeStyle = "black";
        ctx.lineWidth = 3.5;

        if (idx === 0) {
          // Star
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
            const sx = cx + Math.cos(angle) * 16;
            const sy = cy + Math.sin(angle) * 16;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
          ctx.stroke();
        } else if (idx === 1) {
          // Heart
          ctx.beginPath();
          ctx.moveTo(cx, cy - 7);
          ctx.bezierCurveTo(cx - 12, cy - 18, cx - 22, cy - 7, cx, cy + 12);
          ctx.bezierCurveTo(cx + 22, cy - 7, cx + 12, cy - 18, cx, cy - 7);
          ctx.stroke();
        } else if (idx === 2) {
          // Gear
          ctx.beginPath();
          ctx.arc(cx, cy, 10, 0, Math.PI * 2);
          ctx.stroke();
          for (let a = 0; a < 8; a++) {
            const angle = (a * Math.PI) / 4;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * 10, cy + Math.sin(angle) * 10);
            ctx.lineTo(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14);
            ctx.stroke();
          }
        } else if (idx === 3) {
          // Home
          ctx.beginPath();
          ctx.moveTo(cx, cy - 16);
          ctx.lineTo(cx - 14, cy);
          ctx.lineTo(cx - 9, cy);
          ctx.lineTo(cx - 9, cy + 14);
          ctx.lineTo(cx + 9, cy + 14);
          ctx.lineTo(cx + 9, cy);
          ctx.lineTo(cx + 14, cy);
          ctx.closePath();
          ctx.stroke();
        } else if (idx === 4) {
          // Shield
          ctx.beginPath();
          ctx.moveTo(cx - 12, cy - 14);
          ctx.lineTo(cx + 12, cy - 14);
          ctx.quadraticCurveTo(cx + 12, cy + 2, cx, cy + 14);
          ctx.quadraticCurveTo(cx - 12, cy + 2, cx - 12, cy - 14);
          ctx.closePath();
          ctx.stroke();
        } else if (idx === 5) {
          // Warning triangle
          ctx.beginPath();
          ctx.moveTo(cx, cy - 16);
          ctx.lineTo(cx - 16, cy + 12);
          ctx.lineTo(cx + 16, cy + 12);
          ctx.closePath();
          ctx.stroke();
          ctx.fillRect(cx - 1, cy - 5, 2, 6);
          ctx.fillRect(cx - 1, cy + 3, 2, 2);
        } else if (idx === 6) {
          // Envelope
          ctx.strokeRect(cx - 16, cy - 10, 32, 20);
          ctx.beginPath();
          ctx.moveTo(cx - 16, cy - 10);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + 16, cy - 10);
          ctx.stroke();
        } else if (idx === 7) {
          // Cloud
          ctx.beginPath();
          ctx.arc(cx - 5, cy + 3, 7, 0.5 * Math.PI, 1.5 * Math.PI);
          ctx.arc(cx, cy - 4, 9, 1.0 * Math.PI, 2.0 * Math.PI);
          ctx.arc(cx + 7, cy + 3, 7, 1.5 * Math.PI, 2.5 * Math.PI);
          ctx.closePath();
          ctx.stroke();
        } else if (idx === 8) {
          // Folder
          ctx.beginPath();
          ctx.moveTo(cx - 16, cy + 10);
          ctx.lineTo(cx - 16, cy - 10);
          ctx.lineTo(cx - 8, cy - 10);
          ctx.lineTo(cx - 4, cy - 6);
          ctx.lineTo(cx + 16, cy - 6);
          ctx.lineTo(cx + 16, cy + 10);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
  };

  const drawRpgTiles = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, 256, 256);
    const cellSize = 64;
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2.5;

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const tx = c * cellSize;
        const ty = r * cellSize;
        const idx = r * 4 + c;

        ctx.strokeStyle = "#f4f4f5"; // zinc-100
        ctx.strokeRect(tx + 2, ty + 2, cellSize - 4, cellSize - 4);
        ctx.strokeStyle = "black";
        ctx.fillStyle = "black";

        if (idx === 0) {
          // Brick Wall
          ctx.strokeRect(tx + 4, ty + 4, cellSize - 8, cellSize - 8);
          ctx.beginPath();
          ctx.moveTo(tx + 4, ty + 18); ctx.lineTo(tx + cellSize - 4, ty + 18);
          ctx.moveTo(tx + 4, ty + 32); ctx.lineTo(tx + cellSize - 4, ty + 32);
          ctx.moveTo(tx + 4, ty + 46); ctx.lineTo(tx + cellSize - 4, ty + 46);
          // joints
          ctx.moveTo(tx + 18, ty + 4); ctx.lineTo(tx + 18, ty + 18);
          ctx.moveTo(tx + 42, ty + 4); ctx.lineTo(tx + 42, ty + 18);
          ctx.moveTo(tx + 12, ty + 18); ctx.lineTo(tx + 12, ty + 32);
          ctx.moveTo(tx + 36, ty + 18); ctx.lineTo(tx + 36, ty + 32);
          ctx.moveTo(tx + 22, ty + 32); ctx.lineTo(tx + 22, ty + 46);
          ctx.moveTo(tx + 48, ty + 32); ctx.lineTo(tx + 48, ty + 46);
          ctx.stroke();
        } else if (idx === 1) {
          // Grass
          for (let i = 0; i < 3; i++) {
            const gx = tx + 14 + (i * 16);
            const gy = ty + 18 + (i % 2) * 14;
            ctx.beginPath();
            ctx.moveTo(gx, gy + 8); ctx.lineTo(gx - 3, gy);
            ctx.moveTo(gx, gy + 8); ctx.lineTo(gx, gy - 2);
            ctx.moveTo(gx, gy + 8); ctx.lineTo(gx + 3, gy + 1);
            ctx.stroke();
          }
        } else if (idx === 2) {
          // Treasure Chest
          ctx.strokeRect(tx + 14, ty + 18, 36, 28);
          ctx.beginPath();
          ctx.moveTo(tx + 14, ty + 27); ctx.lineTo(tx + 50, ty + 27); // lid
          ctx.rect(tx + 28, ty + 24, 8, 7); // lock
          ctx.stroke();
          ctx.fillRect(tx + 31, ty + 27, 2, 3);
        } else if (idx === 3) {
          // Key
          const kx = tx + 32;
          const ky = ty + 32;
          ctx.beginPath();
          ctx.arc(kx - 10, ky, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(kx - 4, ky); ctx.lineTo(kx + 16, ky);
          ctx.lineTo(kx + 16, ky + 6);
          ctx.moveTo(kx + 11, ky); ctx.lineTo(kx + 11, ky + 5);
          ctx.stroke();
        } else if (idx === 4) {
          // Sword
          ctx.save();
          ctx.translate(tx + 32, ty + 32);
          ctx.rotate(-Math.PI / 4);
          ctx.strokeRect(-3, -18, 6, 22);
          ctx.beginPath();
          ctx.moveTo(-3, -18); ctx.lineTo(0, -22); ctx.lineTo(3, -18);
          ctx.moveTo(-9, 4); ctx.lineTo(9, 4);
          ctx.moveTo(0, 4); ctx.lineTo(0, 13);
          ctx.stroke();
          ctx.restore();
        } else if (idx === 5) {
          // Waves
          ctx.beginPath();
          for (let i = 0; i < 2; i++) {
            const wx = tx + 10;
            const wy = ty + 20 + i * 16;
            ctx.moveTo(wx, wy);
            ctx.bezierCurveTo(wx + 11, wy - 5, wx + 11, wy + 5, wx + 22, wy);
            ctx.bezierCurveTo(wx + 33, wy - 5, wx + 33, wy + 5, wx + 44, wy);
          }
          ctx.stroke();
        } else if (idx === 6) {
          // Stone Block
          ctx.strokeRect(tx + 6, ty + 6, cellSize - 12, cellSize - 12);
          ctx.beginPath();
          ctx.moveTo(tx + 6, ty + 22); ctx.lineTo(tx + cellSize - 6, ty + 34);
          ctx.stroke();
        } else if (idx === 7) {
          // Ladder
          ctx.beginPath();
          ctx.moveTo(tx + 20, ty + 4); ctx.lineTo(tx + 20, ty + cellSize - 4);
          ctx.moveTo(tx + 44, ty + 4); ctx.lineTo(tx + 44, ty + cellSize - 4);
          for (let i = 0; i < 4; i++) {
            const ly = ty + 12 + i * 12;
            ctx.moveTo(tx + 20, ly); ctx.lineTo(tx + 44, ly);
          }
          ctx.stroke();
        }
      }
    }
  };

  const drawAiProceduralAssets = (ctx: CanvasRenderingContext2D, promptText: string, styleVal: string) => {
    ctx.clearRect(0, 0, 256, 256);
    const p = promptText.toLowerCase();
    const cellSize = 128;
    ctx.strokeStyle = "black";
    ctx.lineWidth = 4;
    ctx.fillStyle = "black";

    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const cx = c * cellSize + cellSize / 2;
        const cy = r * cellSize + cellSize / 2;
        const idx = r * 2 + c;

        ctx.strokeStyle = "#f4f4f5";
        ctx.lineWidth = 1;
        ctx.strokeRect(c * cellSize + 8, r * cellSize + 8, cellSize - 16, cellSize - 16);

        ctx.strokeStyle = "black";
        ctx.lineWidth = 4;

        if (p.includes("potion") || p.includes("bottle") || p.includes("flask") || p.includes("magic") || styleVal === "tiles" && idx === 1) {
          ctx.beginPath();
          if (idx === 0) {
            ctx.arc(cx, cy + 12, 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeRect(cx - 5, cy - 24, 10, 16);
            ctx.strokeRect(cx - 8, cy - 27, 16, 4);
          } else if (idx === 1) {
            ctx.strokeRect(cx - 15, cy - 4, 30, 30);
            ctx.strokeRect(cx - 4, cy - 20, 8, 16);
          } else if (idx === 2) {
            ctx.moveTo(cx, cy - 18);
            ctx.lineTo(cx + 20, cy + 24);
            ctx.lineTo(cx - 20, cy + 24);
            ctx.closePath();
            ctx.stroke();
            ctx.strokeRect(cx - 4, cy - 28, 8, 10);
          } else {
            ctx.strokeRect(cx - 8, cy - 14, 16, 38);
            ctx.strokeRect(cx - 4, cy - 26, 8, 12);
          }
        } else if (p.includes("sword") || p.includes("weapon") || p.includes("axe") || p.includes("blade") || p.includes("shield") || styleVal === "pixel") {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-Math.PI / 4 + (idx * Math.PI) / 8);
          if (idx === 0) {
            ctx.strokeRect(-4, -28, 8, 36);
            ctx.strokeRect(-12, 8, 24, 4);
            ctx.strokeRect(-2, 12, 4, 10);
          } else if (idx === 1) {
            ctx.strokeRect(-2, -32, 4, 42);
            ctx.beginPath();
            ctx.arc(0, 10, 5, 0, Math.PI, true);
            ctx.stroke();
            ctx.strokeRect(-2, 10, 4, 10);
          } else if (idx === 2) {
            ctx.strokeRect(-2, -22, 4, 50);
            ctx.beginPath();
            ctx.moveTo(2, -12);
            ctx.quadraticCurveTo(15, -20, 18, -12);
            ctx.lineTo(15, 2);
            ctx.quadraticCurveTo(7, -1, 2, -4);
            ctx.stroke();
          } else {
            ctx.strokeRect(-3, -16, 6, 22);
            ctx.strokeRect(-8, 6, 16, 3);
            ctx.strokeRect(-1.5, 9, 3, 7);
          }
          ctx.restore();
        } else if (p.includes("ui") || p.includes("indicator") || p.includes("radar") || p.includes("dial") || styleVal === "gadgets") {
          if (idx === 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, 24, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - 26, cy); ctx.lineTo(cx + 26, cy);
            ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy + 26);
            ctx.stroke();
          } else if (idx === 1) {
            ctx.strokeRect(cx - 16, cy - 16, 32, 32);
            ctx.strokeRect(cx - 8, cy - 8, 16, 16);
          } else if (idx === 2) {
            ctx.beginPath();
            ctx.arc(cx, cy, 22, 0, Math.PI * 2);
            ctx.stroke();
            for (let a = 0; a < 8; a++) {
              const angle = (a * Math.PI) / 4;
              ctx.beginPath();
              ctx.moveTo(cx + Math.cos(angle) * 16, cy + Math.sin(angle) * 16);
              ctx.lineTo(cx + Math.cos(angle) * 22, cy + Math.sin(angle) * 22);
              ctx.stroke();
            }
          } else {
            ctx.strokeRect(cx - 20, cy - 12, 40, 24);
            ctx.beginPath();
            ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
            ctx.stroke();
          }
        } else {
          if (idx === 0) {
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
              const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
              ctx.lineTo(cx + Math.cos(angle) * 20, cy + Math.sin(angle) * 20);
            }
            ctx.closePath();
            ctx.stroke();
          } else if (idx === 1) {
            ctx.strokeRect(cx - 20, cy - 14, 40, 28);
            ctx.beginPath();
            ctx.moveTo(cx - 20, cy + 14); ctx.lineTo(cx + 20, cy - 14);
            ctx.stroke();
          } else if (idx === 2) {
            ctx.beginPath();
            ctx.moveTo(cx, cy - 20);
            ctx.lineTo(cx + 18, cy + 14);
            ctx.lineTo(cx - 18, cy + 14);
            ctx.closePath();
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(cx - 8, cy, 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx + 8, cy, 12, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }
  };

  const uploadCanvasImage = async (filename: string, drawFn: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = hiddenCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawFn(ctx);

    return new Promise<void>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (blob) {
          const file = new File([blob], filename, { type: "image/png" });
          try {
            await upload(file);
            resolve();
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error("Canvas blob compilation failed"));
        }
      }, "image/png");
    });
  };

  // Preset execution trigger
  const handlePresetClick = async (type: PresetType) => {
    if (uploadInProgress || isGenerating) return;
    setActivePreset(type);

    let filename = "";
    let drawFn: (ctx: CanvasRenderingContext2D) => void = () => {};

    if (type === "invaders") {
      filename = "invaders_pattern_bw.png";
      drawFn = drawPixelInvaders;
    } else if (type === "icons") {
      filename = "ui_icons_bw.png";
      drawFn = drawMinimalIcons;
    } else {
      filename = "rpg_tileset_bw.png";
      drawFn = drawRpgTiles;
    }

    try {
      await uploadCanvasImage(filename, drawFn);
    } catch (e) {
      console.error(e);
    } finally {
      setActivePreset(null);
    }
  };

  // AI Prompt generation sandbox trigger
  const handleAiGenerate = () => {
    if (isGenerating || uploadInProgress) return;
    setIsGenerating(true);

    const cleanPrompt = prompt.trim() || "modern_grayscale_assets";
    
    // Simple uncluttered stepper for state indicator
    const steps = [
      "CONNECTING CLUSTER...",
      "RESOLVING CONSTRAINTS...",
      "COMPILING ASSET GRID...",
      "RENDERING PNG MAP..."
    ];

    let currentStep = 0;
    setAiStatusMessage(steps[0]);

    const runStepper = setInterval(() => {
      currentStep++;
      if (currentStep < steps.length) {
        setAiStatusMessage(steps[currentStep]);
      } else {
        clearInterval(runStepper);
        setAiStatusMessage("COMPILING PNG RESULT...");
        
        const filename = `ai_gen_${selectedStyle}_${cleanPrompt.toLowerCase().replace(/\s+/g, "_")}.png`;
        const drawFn = (ctx: CanvasRenderingContext2D) => {
          drawAiProceduralAssets(ctx, cleanPrompt, selectedStyle);
        };

        uploadCanvasImage(filename, drawFn)
          .then(() => {
            setAiStatusMessage("UPLOAD DIRECT COMPLETE");
            setIsGenerating(false);
          })
          .catch((err) => {
            setAiStatusMessage("PIPELINE ERROR");
            setIsGenerating(false);
          });
      }
    }, 400);
  };

  const uploadInProgress = status === "uploading" || status === "success";

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 sm:py-20 font-mono text-black dark:text-white">
      {/* Hidden processing canvas */}
      <canvas ref={hiddenCanvasRef} width={256} height={256} className="hidden" />

      {/* Spacious, Elegant Monochrome Title */}
      <div className="text-center mb-12 space-y-3">
        <span className="text-[9px] tracking-widest text-zinc-400 font-bold uppercase block font-mono">
          [ open_assets / pipeline ]
        </span>
        <h1 className="text-xl sm:text-2xl font-bold uppercase tracking-tight">Inject Asset Target</h1>
        <p className="text-[11px] text-zinc-400 font-sans max-w-sm mx-auto uppercase">
          Inject a sprite sheet, icon pack, or dungeon level tileset to cleanly slice separate layers.
        </p>
      </div>

      {/* High-End Segmented Tab Selection Control */}
      <div className="border border-zinc-200 dark:border-zinc-800 p-1 bg-zinc-50 dark:bg-zinc-950/40 rounded-xl mb-8 flex gap-1 select-none text-[10px] font-bold">
        <button
          onClick={() => setActiveTab("upload")}
          className={`flex-1 py-2.5 px-3 text-center uppercase tracking-wider transition-all duration-150 rounded-lg ${
            activeTab === "upload"
              ? "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-black dark:text-white shadow-sm font-black"
              : "text-zinc-400 hover:text-black dark:hover:text-white"
          }`}
        >
          [ Local File ]
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          className={`flex-1 py-2.5 px-3 text-center uppercase tracking-wider transition-all duration-150 rounded-lg ${
            activeTab === "ai"
              ? "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-black dark:text-white shadow-sm font-black"
              : "text-zinc-400 hover:text-black dark:hover:text-white"
          }`}
        >
          [ AI prompt ]
        </button>
        <button
          onClick={() => setActiveTab("presets")}
          className={`flex-1 py-2.5 px-3 text-center uppercase tracking-wider transition-all duration-150 rounded-lg ${
            activeTab === "presets"
              ? "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-black dark:text-white shadow-sm font-black"
              : "text-zinc-400 hover:text-black dark:hover:text-white"
          }`}
        >
          [ Test presets ]
        </button>
      </div>

      {/* Clean Single Panel Shell */}
      <div className="relative border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black rounded-xl p-8 shadow-sm">
        
        {/* Tab 1: Local Ingestion Injected */}
        {activeTab === "upload" && (
          <div className="space-y-4">
            <div className="relative">
              <DropZone />
              
              {uploadInProgress && (
                <div className="absolute inset-0 bg-white/95 dark:bg-black/95 flex flex-col items-center justify-center p-4 text-center z-10 rounded-lg">
                  <Loader2 className="h-5 w-5 animate-spin text-black dark:text-white mb-3" />
                  <p className="text-[10px] font-bold uppercase tracking-widest animate-pulse">Uploading target asset map...</p>
                  <p className="text-[9px] text-zinc-400 mt-1 uppercase font-sans">Connecting to slicing engine · Redirecting</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Minimalist AI prompt sandbox Injected */}
        {activeTab === "ai" && (
          <div className="space-y-6">
            {/* Style pills selector */}
            <div className="space-y-2">
              <span className="text-[9px] font-bold uppercase text-zinc-400">Target Style Profile:</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "pixel", name: "Pixel Art" },
                  { id: "vector", name: "UI Vectors" },
                  { id: "tiles", name: "Dungeon Grid" },
                  { id: "gadgets", name: "Neon Dials" }
                ].map((style) => (
                  <button
                    key={style.id}
                    disabled={isGenerating || uploadInProgress}
                    onClick={() => setSelectedStyle(style.id as AiStyleType)}
                    className={`px-3 py-1.5 text-[9px] font-bold uppercase border transition-all duration-150 rounded-md ${
                      selectedStyle === style.id
                        ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black font-black"
                        : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 text-zinc-400 dark:text-zinc-500 hover:text-black dark:hover:text-white"
                    }`}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt input field */}
            <div className="space-y-2">
              <span className="text-[9px] font-bold uppercase text-zinc-400">Model prompt:</span>
              <input
                type="text"
                disabled={isGenerating || uploadInProgress}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. potion vials, medieval swords, cyberpunk dials..."
                className="w-full text-xs px-4 py-3 border border-zinc-200 dark:border-zinc-800 bg-transparent outline-none focus:border-black dark:focus:border-white transition-colors duration-150 font-mono rounded-lg placeholder:text-zinc-400 disabled:opacity-40"
              />
            </div>

            {/* Inversion hover action button */}
            <button
              disabled={isGenerating || uploadInProgress}
              onClick={handleAiGenerate}
              className="w-full bg-black text-white dark:bg-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-100 py-3 border border-black dark:border-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors duration-150 disabled:opacity-40 flex items-center justify-center gap-2 group cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  <span>Initialize AI Generator</span>
                </>
              )}
            </button>

            {/* Single clean log line instead of massive logging window */}
            <div className="flex items-center gap-2 text-[9px] text-zinc-400 font-bold border-t border-zinc-100 dark:border-zinc-900 pt-4 uppercase justify-between select-none">
              <div className="flex items-center gap-1.5">
                <span className={`inline-block size-1.5 rounded-full ${isGenerating || uploadInProgress ? "bg-black dark:bg-white animate-ping" : "bg-zinc-300 dark:bg-zinc-700"}`} />
                <span>Status:</span>
              </div>
              <span className={isGenerating || uploadInProgress ? "text-black dark:text-white animate-pulse" : "text-zinc-500"}>
                {isGenerating ? aiStatusMessage : uploadInProgress ? "UPLOADING RENDER..." : "ENGINE IDLE"}
              </span>
            </div>
          </div>
        )}

        {/* Tab 3: Test preset list Injected */}
        {activeTab === "presets" && (
          <div className="space-y-4">
            <p className="text-[10px] text-zinc-400 font-sans uppercase leading-normal">
              Click a preset pattern below to compile a grayscale image on the fly and trigger the contour detector.
            </p>

            <div className="space-y-2 pt-2">
              {[
                { id: "invaders", name: "Preset A: Pixel Invaders", desc: "Symmetric 8x8 spaceships (4x4 matrix)" },
                { id: "icons", name: "Preset B: Minimal Icons", desc: "Clean outline flat interface symbols (3x3 matrix)" },
                { id: "tiles", name: "Preset C: Dungeon Tiles", desc: "RPG bricks, grass tufts, chest lockets & keys (4x4 matrix)" }
              ].map((preset) => (
                <button
                  key={preset.id}
                  disabled={uploadInProgress || isGenerating}
                  onClick={() => handlePresetClick(preset.id as PresetType)}
                  className="w-full flex items-center justify-between px-4 py-3.5 border border-zinc-200 dark:border-zinc-800 hover:border-black dark:hover:border-white transition-all duration-150 rounded-lg text-left disabled:opacity-40 disabled:cursor-not-allowed group"
                >
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold uppercase block">{preset.name}</span>
                    <span className="text-[9px] text-zinc-400 group-hover:text-zinc-500 transition-colors block font-sans uppercase">{preset.desc}</span>
                  </div>
                  {activePreset === preset.id || (uploadInProgress && activePreset === preset.id) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-black dark:text-white" />
                  ) : (
                    <ChevronRight className="h-4 w-4 opacity-30 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-black dark:text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Global Exception Bar */}
        {uploadError && (
          <div className="mt-6 border border-red-200 dark:border-red-950 bg-red-50/50 dark:bg-red-950/10 p-3 rounded-lg flex gap-3 text-[10px] text-red-500 font-mono items-center">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <div className="font-mono">
              <span className="font-bold">SYSTEM WARNING: </span>
              {uploadError}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
