"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanSearch, Sparkles, Download } from "lucide-react";
import { HeroSection } from "@/components/landing/HeroSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { ScreenComparison } from "@/components/landing/ScreenComparison";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import { DashboardSimulator } from "@/components/landing/DashboardSimulator";
import { CursorProvider, Cursor } from "@/components/unlumen-ui/cursor";
import { useAuth } from "@/features/auth/context/AuthContext";
import UserAccountAvatar from "@/components/ui/smoothui/user-account-avatar";

const features = [
  {
    icon: ScanSearch,
    title: "OPENCV_SMART_CONTOURS",
    desc: "Advanced contour tracing algorithms locate every asset bounding box automatically. No manual cropping required.",
    accent: "text-[#ff7c00]",
  },
  {
    icon: Sparkles,
    title: "SEMANTIC_AI_NAMING",
    desc: "Gemini Vision API reads asset context (shape, style, game theme) to generate descriptive, clean, and organized file names.",
    accent: "text-[#00ff66]",
  },
  {
    icon: Download,
    title: "DYNAMIC_ZIP_COMPILER",
    desc: "Batch scale sprites (2x, 4x), fine-tune transparent margins, and download isolated layers compiled in an structured zip.",
    accent: "text-blue-500",
  },
];

export default function LandingPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.refresh();
  }

  return (
    <CursorProvider global className="min-h-screen block">
      <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-[#ff7c00] selection:text-black font-mono">
      
      {/* Top Announcement Bar */}
      <div className="w-full bg-zinc-950 dark:bg-white text-white dark:text-black py-2.5 px-6 border-b border-zinc-800 dark:border-zinc-200 flex items-center justify-between text-[10px] sm:text-xs font-bold tracking-tight select-none">
        <div className="flex items-center gap-1.5 text-[#ff7c00]">
          <span>★</span><span>★</span><span>★</span>
        </div>
        <div className="text-center font-mono uppercase">
          OPEN TO RAISE<span className="text-[#ff7c00] font-black">$$$ IN X SERIES</span> | <Link href="/careers" className="hover:underline">LEARN WHATS NEXT →</Link>
        </div>
        <div className="flex items-center gap-1.5 text-[#ff7c00]">
          <span>★</span><span>★</span><span>★</span>
        </div>
      </div>

      {/* Dynamic Retro Global Navbar */}
      <header className="border-b border-zinc-200 dark:border-zinc-950 bg-background/95 sticky top-0 z-40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between font-mono text-[10px] sm:text-xs relative">
          
          {/* Left Navigation Links */}
          <div className="hidden lg:flex items-center gap-5 text-zinc-500 dark:text-zinc-400 font-bold">
            <Link href="/#product" className="hover:text-foreground transition-colors hover:underline underline-offset-4 tracking-wider uppercase">PRODUCT</Link>
            <Link href="/pricing" className="hover:text-foreground transition-colors hover:underline underline-offset-4 tracking-wider uppercase">PRICING</Link>
            <Link href="#resources" className="hover:text-foreground transition-colors hover:underline underline-offset-4 tracking-wider uppercase">RESOURCES</Link>
            <Link href="#enterprise" className="hover:text-foreground transition-colors hover:underline underline-offset-4 tracking-wider uppercase">ENTERPRISE</Link>
            <a href="https://x.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors hover:underline underline-offset-4 tracking-wider uppercase">BOOK A CALL</a>
          </div>

          {/* Fallback Left Navigation for smaller screen sizes (simply home link with logo) */}
          <Link href="/" className="lg:hidden flex items-center hover:scale-105 transition-transform duration-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/logo.png"
              alt="open_assets logo"
              className="h-8 w-auto mix-blend-multiply dark:invert dark:mix-blend-screen select-none pointer-events-none"
            />
          </Link>

          {/* Center Brand Logo Icon */}
          <Link href="/" className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center hover:scale-110 transition-transform duration-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src="/assets/logo.png" 
              alt="open_assets logo" 
              className="h-8 w-auto mix-blend-multiply dark:invert dark:mix-blend-screen select-none pointer-events-none" 
            />
          </Link>

          {/* Right Navigation & Socials */}
          <div className="flex items-center gap-4">
            
            {/* Careers Link */}
            <Link href="/careers" className="hidden md:inline hover:text-foreground text-zinc-500 dark:text-zinc-400 transition-colors uppercase tracking-wider font-bold">
              CAREERS
            </Link>

            {/* Vertical Separator */}
            <span className="hidden md:inline border-l border-zinc-200 dark:border-zinc-800 h-4" />

            {/* Social Icons Row */}
            <div className="hidden sm:flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
              {/* GitHub */}
              <a href="https://github.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                </svg>
              </a>
              {/* LinkedIn */}
              <a href="https://linkedin.com/in/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/>
                </svg>
              </a>
              {/* X */}
              <a href="https://x.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
            </div>

            {/* Vertical Separator */}
            <span className="hidden sm:inline border-l border-zinc-200 dark:border-zinc-800 h-4" />

            {/* Theme switcher */}
            <ThemeSwitch className="bg-transparent border-0 text-zinc-500 dark:text-zinc-400 hover:text-foreground hover:bg-transparent size-auto p-0 cursor-pointer shadow-none ring-0 focus-visible:ring-0" iconSize={14} />

            {/* Vertical Separator */}
            <span className="border-l border-zinc-200 dark:border-zinc-800 h-4" />

            {/* Auth Buttons / Avatar */}
            {user ? (
              <UserAccountAvatar
                user={{
                  name: user.name || "User Account",
                  email: user.email || "user@example.com",
                  avatar: user.picture || undefined,
                }}
                onLogout={handleLogout}
              />
            ) : (
              <div className="flex items-center gap-2">
                <Link 
                  href="/register" 
                  className="bg-zinc-900 dark:bg-white text-white dark:text-black font-black uppercase tracking-wider text-[10px] px-3.5 py-1.5 border border-zinc-900 dark:border-white hover:bg-transparent hover:text-zinc-900 dark:hover:bg-transparent dark:hover:text-white transition-all duration-150 rounded-none shadow-md"
                >
                  Sign Up
                </Link>
                <Link 
                  href="/login" 
                  className="bg-transparent text-zinc-600 dark:text-zinc-300 font-bold uppercase tracking-wider text-[10px] px-3.5 py-1.5 border border-zinc-300 dark:border-zinc-800 hover:border-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all duration-150 rounded-none"
                >
                  Sign In
                </Link>
              </div>
            )}

          </div>
        </div>
      </header>

      {/* Hero Section Piece */}
      <main className="flex-1">
        <HeroSection />

        {/* Interactive Dashboard Simulator Section */}
        <section id="product" className="bg-zinc-50 dark:bg-[#09090b] border-t border-b border-zinc-200 dark:border-zinc-900/60 py-24 px-6 relative">
          <div className="absolute inset-0 bg-[radial-gradient(#00000002_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff03_1px,transparent_1px)] bg-size-[24px_24px] pointer-events-none opacity-50" />
          
          <div className="mx-auto max-w-5xl relative z-10 space-y-16">
            <div className="text-center max-w-xl mx-auto space-y-3">
              <span className="text-[10px] font-bold text-[#ff7c00] uppercase tracking-widest block font-mono">
                [ DYNAMIC_SIMULATOR ]
              </span>
              <h2 className="text-2xl font-black uppercase tracking-tight text-foreground sm:text-3xl font-mono">
                Real-Time Pipeline Simulation
              </h2>
              <p className="text-xs sm:text-sm text-zinc-500 max-w-md mx-auto font-mono">
                Observe OpenCV Smart Contours and AI Vision API process a game sprite sheet in real time.
              </p>
            </div>

            <div className="border border-zinc-200 dark:border-zinc-800 bg-background/50 dark:bg-black/20 p-6 md:p-8 rounded-xl shadow-2xl backdrop-blur-sm">
              <DashboardSimulator />
            </div>
          </div>
        </section>

        {/* Storytelling Screen Comparison */}
        <ScreenComparison />

        {/* Feature Grid Section */}
        <section id="resources" className="bg-background border-t border-zinc-200 dark:border-zinc-900 py-20 px-6 relative">
          <div className="absolute inset-0 bg-[radial-gradient(#00000004_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff04_1px,transparent_1px)] bg-size-[24px_24px] pointer-events-none opacity-50" />
          
          <div className="mx-auto max-w-5xl relative z-10">
            <div className="text-center max-w-xl mx-auto mb-16 space-y-3">
              <span className="text-[10px] font-bold text-[#ff7c00] uppercase tracking-widest block">
                [ ENGINE_SPECIFICATIONS ]
              </span>
              <h2 className="text-2xl font-bold uppercase tracking-tight text-foreground sm:text-3xl">
                Technical pipeline breakdown
              </h2>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Engineered for rapid asset extraction, combining low-level vision contour detection with modern vision LLMs.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {features.map(({ icon: Icon, title, desc, accent }) => (
                <div 
                  key={title} 
                  className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors p-6 flex flex-col justify-between h-50 relative rounded-md shadow-lg"
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-2.5">
                      <Icon className={`h-4 w-4 ${accent}`} />
                      <h3 className="font-bold text-[11px] tracking-wider text-foreground uppercase">{title}</h3>
                    </div>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans">{desc}</p>
                  </div>
                  <div className="text-[9px] text-zinc-400 dark:text-zinc-600 font-mono mt-2 self-start uppercase">
                    Status: Verified_OK
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section Block */}
        <PricingSection />

      </main>

      {/* Monospace Tech Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-950 bg-zinc-100 dark:bg-black py-8 px-6 text-center sm:text-left">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 bg-[#00ff66] rounded-none" />
            <p className="text-[10px] text-zinc-600 dark:text-zinc-500 uppercase">
              open_assets © {new Date().getFullYear()} · all tools online
            </p>
          </div>
          <div className="flex items-center gap-6 text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase tracking-wider">
            <a href="#" className="hover:text-foreground transition-colors">Documentation</a>
            <a href="https://github.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
            <a href="#" className="hover:text-foreground transition-colors">Security</a>
          </div>
        </div>
      </footer>
    </div>
    <Cursor className="hidden md:block text-[#ff7c00]" />
  </CursorProvider>
  );
}
