"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative w-full lg:min-h-[calc(100vh-96px)] lg:h-[calc(100vh-96px)] bg-background text-foreground overflow-hidden flex flex-col items-center justify-center py-10 lg:py-16 px-6 border-b border-zinc-200 dark:border-zinc-900">
      
      {/* Grid Pattern & Glow Center */}
      <div className="absolute inset-0 bg-[radial-gradient(#00000004_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none z-0 opacity-80" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-orange-600/10 to-amber-500/5 rounded-full blur-[140px] pointer-events-none z-0" />

      {/* Content wrapper */}
      <div className="w-full max-w-5xl mx-auto text-center relative z-10 flex flex-col justify-between h-full gap-10">
        
        {/* Spacer at the top to balance the centered layout */}
        <div className="hidden lg:block h-6" />

        {/* Hero copy elements */}
        <div className="space-y-6 max-w-3xl mx-auto">
          {/* Breathtaking Retro Header */}
          <div className="space-y-3 py-1">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-black font-mono tracking-tighter uppercase leading-tight select-none">
              AI contour pipeline for
              <br />
              <span className="mt-4 text-lg sm:text-2xl md:text-4xl lg:text-5xl text-white dark:text-black bg-black dark:bg-white px-4 py-1.5 inline-block tracking-tight font-black shadow-[4px_4px_0px_#ff7c00] border-2 border-black dark:border-white transform -rotate-1 hover:rotate-0 transition-transform duration-300 whitespace-nowrap">
                [ DEEP ASSET EXTRACTION ]
              </span>
            </h1>
          </div>

          {/* Detailed monospaced subtitle */}
          <p className="text-xs sm:text-sm md:text-base text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto font-mono tracking-tight leading-relaxed">
            High-performance computer vision SaaS built to segment complex sprite sheets, UI kits, and icon packs in milliseconds. Powered by AI to auto-name batch layers in production queues.
          </p>

          {/* CTA Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              href="/register"
              className="w-full sm:w-auto px-6 py-3 rounded-none bg-zinc-900 dark:bg-white text-white dark:text-black font-bold uppercase tracking-wider text-xs border border-zinc-900 dark:border-white hover:bg-[#00ff66] hover:text-black hover:border-[#00ff66] hover:shadow-[0_0_25px_rgba(0,255,102,0.45)] transition-all font-mono duration-200 flex items-center justify-center gap-2"
            >
              Start Free Trial
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/collections"
              className="w-full sm:w-auto px-6 py-3 rounded-none bg-transparent text-zinc-600 dark:text-zinc-300 font-bold uppercase tracking-wider text-xs border border-zinc-200 dark:border-zinc-800 hover:border-zinc-500 dark:hover:border-[#00ff66] hover:text-black dark:hover:text-[#00ff66] transition-all font-mono duration-200 flex items-center justify-center gap-1.5"
            >
              View Collection
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Social Proof Brand Monospace Row */}
        <div className="pt-8 border-t border-zinc-200 dark:border-zinc-900/60 max-w-4xl mx-auto flex flex-col items-center gap-4 w-full">
          <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-500 dark:text-zinc-600">
            Trusted & integrated by builders at
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[11px] sm:text-xs font-mono font-bold text-zinc-600 dark:text-zinc-500 select-none">
            <span className="hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors uppercase tracking-wider">
              [ Open Polls ]
            </span>
            <span className="hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors uppercase tracking-wider">
              [ Open Hire ]
            </span>
            <span className="hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors uppercase tracking-wider">
              [ Tool Sadhan ]
            </span>
            <span className="hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors uppercase tracking-wider">
              [ Chai Code ]
            </span>
            <span className="hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors uppercase tracking-wider">
              [ Clipix ]
            </span>
          </div>
        </div>

      </div>
    </section>
  );
}
