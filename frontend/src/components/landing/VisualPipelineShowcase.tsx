"use client";

import { OrbitingSkills } from "@/components/unlumen-ui/orbiting-skills";
import { Target, Cpu, Layers, Sparkles, FolderArchive, Ruler, CheckCircle2 } from "lucide-react";

const orbitItems = [
  { label: "OPENCV_CONTOURS", icon: <Target className="h-3.5 w-3.5 text-[#ff7c00]" /> },
  { label: "GEMINI_NAMING", icon: <Cpu className="h-3.5 w-3.5 text-[#00ff66]" /> },
  { label: "LAYER_ISOLATION", icon: <Layers className="h-3.5 w-3.5 text-blue-500" /> },
  { label: "CLOUD_UPSCALE", icon: <Sparkles className="h-3.5 w-3.5 text-yellow-500" /> },
  { label: "ZIP_COMPILER", icon: <FolderArchive className="h-3.5 w-3.5 text-purple-500" /> },
  { label: "MARGIN_TUNING", icon: <Ruler className="h-3.5 w-3.5 text-red-500" /> },
];

export function VisualPipelineShowcase() {
  return (
    <section id="pipeline-specs" className="bg-zinc-50 dark:bg-[#08080a] border-t border-b border-zinc-200 dark:border-zinc-900/60 py-24 px-6 relative overflow-hidden select-none">
      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-[radial-gradient(#00000002_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff03_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none opacity-50" />
      <div className="absolute top-1/2 left-1/3 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="mx-auto max-w-5xl relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Interactive Orbit (glowing brand showcase) */}
          <div className="lg:col-span-5 flex items-center justify-center relative min-h-[320px] sm:min-h-[380px] select-none" data-orbit-root="true">
            <OrbitingSkills
              items={orbitItems}
              radius={130}
              duration={24}
              showPath={true}
              followCursor={true}
              className="w-[320px] h-[320px] sm:w-[380px] sm:h-[380px] flex items-center justify-center"
            >
              {/* Central badge with logo */}
              <div className="relative p-6 rounded-full border border-zinc-200 dark:border-zinc-800 shadow-xl flex items-center justify-center size-24 sm:size-28 bg-white/80 dark:bg-black/60 backdrop-blur-sm transition-all duration-300 hover:border-[#ff7c00]/50 hover:shadow-[#ff7c00]/10">
                <img
                  src="/assets/logo.png"
                  alt="open_assets logo"
                  className="h-10 sm:h-12 w-auto mix-blend-multiply dark:invert dark:mix-blend-screen select-none pointer-events-none"
                />
              </div>
            </OrbitingSkills>
          </div>

          {/* Right Column: Monospaced specifications */}
          <div className="lg:col-span-7 space-y-6 text-left">
            <div className="space-y-3">
              <span className="text-[10px] font-bold text-[#ff7c00] uppercase tracking-widest block font-mono">
                [ PIPELINE_ARCHITECTURE ]
              </span>
              <h2 className="text-2xl font-black uppercase tracking-tight text-foreground sm:text-3xl font-mono">
                Interactive Pipeline Engine
              </h2>
              <p className="text-xs sm:text-sm text-zinc-500 font-mono leading-relaxed">
                Observe the automated asset isolation layers orbiting the core platform engine. Hover and slide your cursor over the visualizer to test the spring-damping kinetics of our interface design in real-time.
              </p>
            </div>

            {/* Checklist stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="border border-zinc-200 dark:border-zinc-900 bg-background/50 dark:bg-black/20 p-4 rounded font-mono space-y-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#00ff66]" />
                  <span className="text-[10px] font-black text-foreground uppercase">OPENCV DETECT</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-normal font-sans">
                  Smart contour tracing algorithms process coordinates locally in real-time to find distinct bounding regions.
                </p>
              </div>

              <div className="border border-zinc-200 dark:border-zinc-900 bg-background/50 dark:bg-black/20 p-4 rounded font-mono space-y-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#00ff66]" />
                  <span className="text-[10px] font-black text-foreground uppercase">AI COGNITION</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-normal font-sans">
                  Gemini Vision LLM parses asset visual metadata to auto-label layer names cleanly in batch outputs.
                </p>
              </div>

              <div className="border border-zinc-200 dark:border-zinc-900 bg-background/50 dark:bg-black/20 p-4 rounded font-mono space-y-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#00ff66]" />
                  <span className="text-[10px] font-black text-foreground uppercase">NEURAL UPSCALING</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-normal font-sans">
                  Cloud pipeline initiates high-definition neural net rendering for flawless sprites.
                </p>
              </div>

              <div className="border border-zinc-200 dark:border-zinc-900 bg-background/50 dark:bg-black/20 p-4 rounded font-mono space-y-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#00ff66]" />
                  <span className="text-[10px] font-black text-foreground uppercase">BATCH RECOMPILATION</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-normal font-sans">
                  Combines transparent isolated layers and outputs organized structural zip files for instant game dev deployment.
                </p>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </section>
  );
}
