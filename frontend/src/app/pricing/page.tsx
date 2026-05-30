"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Terminal, Shield, CheckCircle2, X, Calculator, Check } from "lucide-react";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import { CursorProvider, Cursor } from "@/components/unlumen-ui/cursor";
import { useAuth } from "@/features/auth/context/AuthContext";
import UserAccountAvatar from "@/components/ui/smoothui/user-account-avatar";

export default function PricingPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.refresh();
  }

  const [showCalculator, setShowCalculator] = useState(false);
  const [showStartups, setShowStartups] = useState(false);

  // Calculator states
  const [sheets, setSheets] = useState(10);
  const [aiUpscales, setAiUpscales] = useState(100);
  const [aiNaming, setAiNaming] = useState(500);

  // Estimation math
  // Base rates: Free has some limits. Let's calculate cost for Pro & custom.
  const calculateEstimate = () => {
    // Pro base: $150 covers:
    // 50 sheets, 250 upscales, 1000 AI naming calls.
    // Excess usage:
    // Sheet excess: $2 per sheet
    // Upscale excess: $0.10 per upscale
    // Naming excess: $0.02 per call
    const sheetLimit = 50;
    const upscaleLimit = 250;
    const namingLimit = 1000;

    const sheetExcess = Math.max(0, sheets - sheetLimit) * 2;
    const upscaleExcess = Math.max(0, aiUpscales - upscaleLimit) * 0.10;
    const namingExcess = Math.max(0, aiNaming - namingLimit) * 0.02;

    const totalUsageCost = sheetExcess + upscaleExcess + namingExcess;
    const baseCost = 150;
    const estimatedTotal = baseCost + totalUsageCost;

    return {
      base: baseCost,
      usage: totalUsageCost.toFixed(2),
      total: estimatedTotal.toFixed(2)
    };
  };

  const estimate = calculateEstimate();

  return (
    <CursorProvider global className="min-h-screen block">
      <div className="flex flex-col min-h-screen bg-black text-white dark:bg-black selection:bg-[#ff7c00] selection:text-black font-mono transition-colors duration-200">
        
        {/* Top Announcement Bar */}
        <div className="w-full bg-[#ff7c00] text-black py-2.5 px-6 border-b-2 border-black flex items-center justify-between text-[10px] sm:text-xs font-bold tracking-tight select-none">
          <div className="flex items-center gap-1.5 font-bold">
            <span>★</span><span>★</span><span>★</span>
          </div>
          <div className="text-center font-mono uppercase">
            OPEN TO RAISE <span className="font-black underline">$$$ IN X SERIES </span> | <Link href="/careers" className="hover:underline font-black">LEARN WHAT&apos;S NEXT →</Link>
          </div>
          <div className="flex items-center gap-1.5 font-bold">
            <span>★</span><span>★</span><span>★</span>
          </div>
        </div>

        {/* Global Public Navbar */}
        <header className="border-b border-zinc-900 bg-black/95 sticky top-0 z-40 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between font-mono text-[10px] sm:text-xs relative">
            
            {/* Left Nav */}
            <div className="flex items-center gap-5">
              <Link href="/" className="flex items-center hover:scale-105 transition-transform duration-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/assets/logo.png"
                  alt="open_assets logo"
                  className="h-8 w-auto invert select-none pointer-events-none"
                />
              </Link>
              <span className="hidden md:inline border-l border-zinc-800 h-4" />
              <Link href="/" className="hidden md:inline hover:text-white text-zinc-400 transition-colors uppercase tracking-wider font-bold">
                Product
              </Link>
              <Link href="/pricing" className="hover:text-white text-foreground underline decoration-[#ff7c00] decoration-2 underline-offset-4 transition-colors uppercase tracking-wider font-bold">
                Pricing
              </Link>
              <Link href="/careers" className="hover:text-white text-zinc-400 transition-colors uppercase tracking-wider font-bold">
                Careers
              </Link>
            </div>

            {/* Title Indicator (Brutalist style) */}
            <div className="absolute left-1/2 -translate-x-1/2 hidden lg:flex items-center gap-2 border border-zinc-800 px-3 py-1 bg-zinc-950 font-black">
              <Terminal className="h-3.5 w-3.5 text-[#ff7c00]" />
              <span>TRANSMISSION_CHARTS.SH</span>
            </div>

            {/* Right Nav */}
            <div className="flex items-center gap-4">
              <ThemeSwitch className="bg-transparent border-0 text-zinc-400 hover:text-white hover:bg-transparent size-auto p-0 cursor-pointer shadow-none ring-0 focus-visible:ring-0" iconSize={14} />
              <span className="border-l border-zinc-850 h-4" />
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
                <>
                  <Link 
                    href="/register" 
                    className="bg-white text-black font-black uppercase tracking-wider text-[10px] px-3.5 py-1.5 border border-white hover:bg-transparent hover:text-white transition-all duration-150 rounded-none shadow-md"
                  >
                    Sign Up
                  </Link>
                  <Link 
                    href="/login" 
                    className="bg-transparent text-zinc-300 font-bold uppercase tracking-wider text-[10px] px-3.5 py-1.5 border border-zinc-800 hover:border-zinc-500 hover:text-white transition-all duration-150 rounded-none"
                  >
                    Sign In
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 md:py-16 relative">
          
          {/* Print decorator on the right side */}
          <div className="absolute right-6 top-8 text-zinc-700 text-[10px] font-mono select-none uppercase hidden sm:block">
            {"/PRINT('$' * 150)"}
          </div>

          {/* Hover hint on the bottom-left of hero */}
          <div className="absolute left-6 top-72 text-zinc-700 text-[10px] font-mono select-none uppercase hidden lg:block tracking-widest animate-pulse">
            &gt; HOVER (↓↓)
          </div>

          {/* Hero Header Section */}
          <div className="text-center space-y-5 mb-16 pt-6">
            
            {/* Startups tag */}
            <button
              onClick={() => setShowStartups(true)}
              className="bg-[#ff7c00] text-black border-2 border-black px-3 py-1 inline-flex items-center gap-2 font-mono font-black text-[9px] sm:text-[10px] tracking-widest uppercase hover:bg-white hover:text-black transition-colors duration-150 cursor-pointer shadow-[3px_3px_0px_0px_#fff]"
            >
              <span className="bg-black text-white px-1 py-0.2 select-none">NEW</span>
              JOIN STARTUPS PROGRAM
            </button>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black uppercase tracking-tight max-w-4xl mx-auto leading-none pt-4 text-white">
              PRICING
            </h1>
            
            <p className="text-xs sm:text-sm text-zinc-400 font-mono max-w-xl mx-auto uppercase tracking-widest leading-relaxed">
              Free Hobby tier, and paid upgrades to cover all needs. <br />
              <span className="text-zinc-600 font-bold">Separate usage costs.</span>
            </p>

            {/* Pricing calculator trigger */}
            <div className="pt-2">
              <button
                onClick={() => setShowCalculator(true)}
                className="text-xs font-black uppercase tracking-widest text-[#ff7c00] hover:text-white underline decoration-2 underline-offset-4 transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                <Calculator className="h-4.5 w-4.5" />
                PRICING ESTIMATE CALCULATOR
              </button>
            </div>
          </div>

          {/* Three Stark Brutalist Columns Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch mb-20 max-w-5xl mx-auto">
            
            {/* 1. HOBBY CARD */}
            <div className="border-2 border-zinc-850 bg-zinc-950 p-8 flex flex-col justify-between rounded-none shadow-[6px_6px_0px_0px_rgba(255,255,255,0.05)] hover:border-zinc-500 transition-colors">
              <div className="space-y-8">
                {/* Header */}
                <div className="space-y-3">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">{"// STAGE_01_SANDBOX"}</span>
                  <h3 className="text-2xl font-black tracking-wider uppercase text-zinc-400">Hobby</h3>
                  <div className="space-y-1.5">
                    <p className="text-4xl font-black text-white">Free</p>
                    <span className="bg-zinc-900 border border-zinc-800 text-zinc-400 px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest inline-block select-none">
                      + USAGE COSTS
                    </span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                  Perfect for game jams, prototyping, and testing bounding boxes in local workspaces.
                </p>

                <div className="border-t border-dashed border-zinc-850 my-6" />

                {/* Features */}
                <ul className="space-y-3 text-xs text-zinc-400">
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">5 sprite sheets per month</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">Standard OpenCV adaptive contours</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">Basic AI filename labeling</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">2x upscale model bounds limit</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">Standard ZIP exports</span>
                  </li>
                </ul>
              </div>

              {/* Action */}
              <div className="pt-8">
                <Link
                  href="/register"
                  className="w-full py-3.5 block text-center font-mono font-black uppercase tracking-widest text-xs border-2 border-zinc-800 text-zinc-400 bg-transparent hover:border-white hover:text-white transition-all rounded-none"
                >
                  START FREE SANDBOX
                </Link>
              </div>
            </div>

            {/* 2. PRO CARD (WHITE-HIGHLIGHTED) */}
            <div className="border-4 border-[#ff7c00] bg-white text-black p-8 flex flex-col justify-between rounded-none shadow-[8px_8px_0px_0px_#ff7c00] md:-translate-y-2 z-10 relative">
              
              {/* Highlight label */}
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-black text-[#ff7c00] font-black text-[9px] uppercase px-3 py-0.8 tracking-widest border border-black whitespace-nowrap">
                RECOMMENDED // PRODUCTION_READY
              </span>

              <div className="space-y-8">
                {/* Header */}
                <div className="space-y-3">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">{"// STAGE_02_VELOCITY"}</span>
                  <h3 className="text-2xl font-black tracking-wider uppercase text-black">Pro</h3>
                  <div className="space-y-1.5">
                    <div className="flex items-baseline gap-1">
                      <p className="text-4xl font-black text-black">$150</p>
                      <span className="text-[10px] text-zinc-500 font-bold">/MO</span>
                    </div>
                    <span className="bg-[#ff7c00]/10 border border-[#ff7c00]/30 text-[#ff7c00] px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest inline-block select-none">
                      + USAGE COSTS
                    </span>
                  </div>
                </div>

                <p className="text-xs text-zinc-600 leading-relaxed font-sans font-medium">
                  Designed for active game designers, asset compilers, and indie studios looking for rapid batch naming.
                </p>

                <div className="border-t border-dashed border-zinc-300 my-6" />

                {/* Features */}
                <ul className="space-y-3 text-xs text-zinc-800">
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#ff7c00] shrink-0 mt-0.5" />
                    <span className="font-sans font-bold leading-tight">Unlimited sprite sheets & UI kits</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#ff7c00] shrink-0 mt-0.5" />
                    <span className="font-sans font-bold leading-tight">Advanced CV padding & threshold sliders</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#ff7c00] shrink-0 mt-0.5" />
                    <span className="font-sans font-bold leading-tight">AI Premium Gemini flash vision labeling</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#ff7c00] shrink-0 mt-0.5" />
                    <span className="font-sans font-bold leading-tight">4x AI upscaling model resolution limit</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#ff7c00] shrink-0 mt-0.5" />
                    <span className="font-sans font-bold leading-tight">Custom naming directory maps</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#ff7c00] shrink-0 mt-0.5" />
                    <span className="font-sans font-bold leading-tight">5 concurrent API token hooks</span>
                  </li>
                </ul>
              </div>

              {/* Action */}
              <div className="pt-8">
                <Link
                  href="/register"
                  className="w-full py-3.5 block text-center font-mono font-black uppercase tracking-widest text-xs border-2 border-black bg-black text-white hover:bg-transparent hover:text-black transition-all rounded-none shadow-[3px_3px_0px_0px_rgba(0,0,0,0.15)]"
                >
                  START 14-DAY TRIAL
                </Link>
              </div>
            </div>

            {/* 3. ULTIMATE CARD */}
            <div className="border-2 border-zinc-850 bg-zinc-950 p-8 flex flex-col justify-between rounded-none shadow-[6px_6px_0px_0px_rgba(255,255,255,0.05)] hover:border-zinc-500 transition-colors">
              <div className="space-y-8">
                {/* Header */}
                <div className="space-y-3">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">{"// STAGE_03_ENTERPRISE"}</span>
                  <h3 className="text-2xl font-black tracking-wider uppercase text-zinc-400">Ultimate</h3>
                  <div className="space-y-1.5">
                    <p className="text-4xl font-black text-white">Enterprise</p>
                    <span className="bg-zinc-900 border border-zinc-800 text-zinc-400 px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest inline-block select-none">
                      + USAGE COSTS
                    </span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                  Tailored for studios requiring dedicated GPU batch pipelines, full compliance vaults, and custom vision models.
                </p>

                <div className="border-t border-dashed border-zinc-850 my-6" />

                {/* Features */}
                <ul className="space-y-3 text-xs text-zinc-400">
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">Bespoke priority GPU cue lines</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">Private S3 cloud endpoints or local syncing</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">SAML SSO & enterprise security logs</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">Granular role permission workspaces</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">99.9% Uptime API SLAs</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#00ff66] shrink-0 mt-0.5" />
                    <span className="font-sans leading-tight">Bespoke threshold configurations</span>
                  </li>
                </ul>
              </div>

              {/* Action */}
              <div className="pt-8">
                <a
                  href="mailto:sales@openassets.dev?subject=Enterprise%20Integration%20Request"
                  className="w-full py-3.5 block text-center font-mono font-black uppercase tracking-widest text-xs border-2 border-zinc-800 text-zinc-400 bg-transparent hover:border-[#00ff66] hover:text-[#00ff66] transition-all rounded-none"
                >
                  CONTACT SALES TRANSMISSION
                </a>
              </div>
            </div>

          </div>

          {/* Guarantee stamp */}
          <div className="text-center max-w-xl mx-auto border border-zinc-900 bg-zinc-950 p-4 font-mono mb-12">
            <span className="inline-flex items-center gap-2 text-[10px] uppercase text-zinc-500 tracking-wider">
              <Shield className="h-4 w-4 text-[#ff7c00]" />
              Secure transactions · Upgrade, downgrade, or cancel any time · 100% money-back guarantee
            </span>
          </div>

          {/* --- CALCULATOR MODAL --- */}
          {showCalculator && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 backdrop-blur-sm animate-fade-in">
              <div className="bg-zinc-950 border-2 border-black dark:border-zinc-800 p-6 max-w-lg w-full relative font-mono text-xs text-zinc-300 shadow-[8px_8px_0px_0px_#ff7c00] rounded-none">
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-900 pb-3 mb-6">
                  <span className="text-[10px] text-[#ff7c00] font-black uppercase tracking-widest">{"// ESTIMATION_MODULE.EXE"}</span>
                  <button 
                    onClick={() => setShowCalculator(false)}
                    className="text-zinc-500 hover:text-white hover:scale-105 transition-all duration-150 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-6 leading-relaxed">
                  Adjust metrics below to compute your estimated monthly production billing on the Pro plan.
                </p>

                {/* Sliders */}
                <div className="space-y-6">
                  
                  {/* Slider 1 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold uppercase">
                      <span>Sprite Sheets / Month</span>
                      <span className="text-[#ff7c00]">{sheets} sheets</span>
                    </div>
                    <input 
                      type="range" 
                      min="5" 
                      max="150" 
                      value={sheets} 
                      onChange={(e) => setSheets(Number(e.target.value))}
                      className="w-full accent-[#ff7c00] h-1 bg-zinc-900 border border-zinc-800 rounded-none outline-none appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] text-zinc-600">
                      <span>5 SHEETS</span>
                      <span>150 SHEETS</span>
                    </div>
                  </div>

                  {/* Slider 2 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold uppercase">
                      <span>AI Upscales / Month</span>
                      <span className="text-[#ff7c00]">{aiUpscales} upscales</span>
                    </div>
                    <input 
                      type="range" 
                      min="50" 
                      max="1000" 
                      value={aiUpscales} 
                      onChange={(e) => setAiUpscales(Number(e.target.value))}
                      className="w-full accent-[#ff7c00] h-1 bg-zinc-900 border border-zinc-800 rounded-none outline-none appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] text-zinc-600">
                      <span>50 UPSCALES</span>
                      <span>1,000 UPSCALES</span>
                    </div>
                  </div>

                  {/* Slider 3 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold uppercase">
                      <span>AI Labeled Names / Month</span>
                      <span className="text-[#ff7c00]">{aiNaming} calls</span>
                    </div>
                    <input 
                      type="range" 
                      min="100" 
                      max="5000" 
                      value={aiNaming} 
                      onChange={(e) => setAiNaming(Number(e.target.value))}
                      className="w-full accent-[#ff7c00] h-1 bg-zinc-900 border border-zinc-800 rounded-none outline-none appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] text-zinc-600">
                      <span>100 CALLS</span>
                      <span>5,000 CALLS</span>
                    </div>
                  </div>

                </div>

                {/* Calculation breakdown */}
                <div className="border-2 border-dashed border-zinc-900 p-4 mt-8 bg-black space-y-3">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>PRO BASE BILLING:</span>
                    <span>${estimate.base}.00</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-zinc-400 border-b border-zinc-900 pb-2">
                    <span>ESTIMATED EXCESS USAGE:</span>
                    <span className="text-[#ff7c00]">+ ${estimate.usage}</span>
                  </div>
                  <div className="flex justify-between text-xs font-black uppercase text-white pt-1">
                    <span>ESTIMATED TOTAL / MO:</span>
                    <span className="text-[#00ff66]">${estimate.total}</span>
                  </div>
                </div>

                <div className="pt-6">
                  <button
                    onClick={() => setShowCalculator(false)}
                    className="w-full py-3 bg-[#ff7c00] text-black font-black uppercase tracking-widest text-xs hover:bg-white transition-colors duration-150 rounded-none cursor-pointer"
                  >
                    CONFIRM ESTIMATE AND CLOSE
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* --- STARTUPS PROGRAM MODAL --- */}
          {showStartups && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 backdrop-blur-sm animate-fade-in">
              <div className="bg-zinc-950 border-2 border-black dark:border-zinc-800 p-6 max-w-lg w-full relative font-mono text-xs text-zinc-300 shadow-[8px_8px_0px_0px_#00ff66] rounded-none">
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-900 pb-3 mb-6">
                  <span className="text-[10px] text-[#00ff66] font-black uppercase tracking-widest">{"// STARTUPS_GRANT_APPLICATION"}</span>
                  <button 
                    onClick={() => setShowStartups(false)}
                    className="text-zinc-500 hover:text-white hover:scale-105 transition-all duration-150 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">
                    ARE YOU A FOUNDER OR EARLY-STAGE STUDIO?
                  </h3>
                  
                  <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                    We support rapid product creation. If you are an early-stage venture, game-jam compiler, or a registered startup founded within the last 2 years with under $2M in funding, you qualify for our Startups Program!
                  </p>

                  <div className="border-t border-dashed border-zinc-850 py-2" />

                  <h4 className="font-black text-[#00ff66] uppercase text-[10px] tracking-widest">{"// STARTUP_MEMBER_BENEFITS:"}</h4>
                  <ul className="space-y-2 text-xs">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[#00ff66] shrink-0" />
                      <span className="text-zinc-300">50% off Pro tier for the first 12 months</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[#00ff66] shrink-0" />
                      <span className="text-zinc-300">$1,000 in free AI labeling & Upscale credits</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[#00ff66] shrink-0" />
                      <span className="text-zinc-300">1-on-1 developer onboarding & integration help</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-8">
                  <a
                    href="https://x.com/anandxdj"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3.5 block text-center bg-[#00ff66] text-black font-black uppercase tracking-widest text-xs hover:bg-white transition-colors duration-150 rounded-none cursor-pointer"
                  >
                    APPLY NOW VIA TWITTER/X DIRECT MESSAGE
                  </a>
                </div>

              </div>
            </div>
          )}

        </main>

        {/* Global Footer */}
        <footer className="border-t border-zinc-900 bg-zinc-950/20 py-8 text-center text-[10px] text-zinc-500 font-mono uppercase tracking-widest mt-auto">
          <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>© {new Date().getFullYear()} OPEN_ASSETS_COLLECTIVE. ALL SYSTEMS OPERATIONAL.</p>
            <div className="flex items-center gap-4">
              <a href="https://github.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">GITHUB</a>
              <span className="text-zinc-800">/</span>
              <a href="https://x.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">X_TWITTER</a>
            </div>
          </div>
        </footer>

      </div>
      <Cursor className="hidden md:block text-[#ff7c00]" />
    </CursorProvider>
  );
}
