"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Terminal, ArrowUpRight, Code2, Cpu, Smartphone, Eye, Sparkles, CheckCircle2, ChevronRight } from "lucide-react";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import { CursorProvider, Cursor } from "@/components/unlumen-ui/cursor";
import { useAuth } from "@/features/auth/context/AuthContext";
import UserAccountAvatar from "@/components/ui/smoothui/user-account-avatar";

const projects = [
  {
    id: "hashnode-clone",
    title: "HASHNODE_CLONE",
    subtitle: "// DEVELOPER BLOGGING PLATFORM",
    description: "A high-performance, developer-first blogging platform and community dashboard. Optimized for markdown syntax highlighting, collaborative team blogs, custom subdomains, and ultra-fast static rendering.",
    accentColor: "text-[#00ff66]",
    borderColor: "border-[#00ff66]",
    bgColor: "bg-[#00ff66]/5",
    accentBg: "bg-[#00ff66]",
    icon: Code2,
    requirements: [
      "Deep understanding of modern React & Next.js architectures",
      "Ability to read, trace, and refine complex codebases",
      "Passionate about creating clean, production-grade components"
    ],
    stack: ["Next.js 15", "React 19", "Tailwind CSS", "MDX Compiler", "Redis"],
    stats: {
      scope: "Large Scale",
      status: "PLANNED"
    }
  },
  {
    id: "tool-sadhan",
    title: "TOOL_SADHAN",
    subtitle: "// BROWSER TOOL KIT",
    description: "An open-source browser toolkit extension that helps developers debug layout boundaries, measure viewport performance, grab assets instantly, and capture visual elements directly in the browser.",
    accentColor: "text-blue-500",
    borderColor: "border-blue-500",
    bgColor: "bg-blue-500/5",
    accentBg: "bg-blue-500",
    icon: Cpu,
    requirements: [
      "Experience with Chrome Extension APIs and Content Scripts",
      "Strong background in canvas rendering and DOM manipulation",
      "Loves creating lightweight developer utilities"
    ],
    stack: ["Chrome Extensions", "TypeScript", "Canvas API", "Tailwind", "Vite"],
    stats: {
      scope: "Active Contrib",
      status: "IN_PROGRESS"
    }
  },
  {
    id: "calorie-tracker",
    title: "OPENCV_HEALTH_TRACKER",
    subtitle: "// MOBILE IMAGE ANALYSIS PLATFORM",
    description: "A comprehensive health and nutrition tracker for mobile devices. Powered by local OpenCV compilation to identify foods, estimate calorie metrics, and outline meal items in real-time through image contour detection.",
    accentColor: "text-[#ff7c00]",
    borderColor: "border-[#ff7c00]",
    bgColor: "bg-[#ff7c00]/5",
    accentBg: "bg-[#ff7c00]",
    icon: Smartphone,
    requirements: [
      "Capable of integrating OpenCV JS/WASM or native wrappers in mobile packages",
      "Solid understanding of computer vision and contour tracking algorithms",
      "Ready to build high-performance mobile UI frames"
    ],
    stack: ["React Native / Capacitor", "OpenCV (JS/WASM)", "Gemini Vision API", "SQLite"],
    stats: {
      scope: "Full App",
      status: "INITIALIZING"
    }
  }
];

export default function CareersPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.refresh();
  }

  return (
    <CursorProvider global className="min-h-screen block">
      <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-[#ff7c00] selection:text-black font-mono transition-colors duration-200">
        
        {/* Top Announcement Bar */}
        <div className="w-full bg-zinc-950 dark:bg-white text-white dark:text-black py-2.5 px-6 border-b border-zinc-800 dark:border-zinc-200 flex items-center justify-between text-[10px] sm:text-xs font-bold tracking-tight select-none">
          <div className="flex items-center gap-1.5 text-[#ff7c00]">
            <span>★</span><span>★</span><span>★</span>
          </div>
          <div className="text-center font-mono uppercase">
            ACTIVE TRANSMISSION DISPATCH | <span className="text-[#ff7c00] font-black">WE ARE HIRING CO-FOUNDERS & BUILDERS</span> | CONNECT DIRECTLY
          </div>
          <div className="flex items-center gap-1.5 text-[#ff7c00]">
            <span>★</span><span>★</span><span>★</span>
          </div>
        </div>

        {/* Global Public Navbar */}
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-background/95 sticky top-0 z-40 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between font-mono text-[10px] sm:text-xs relative">
            
            {/* Left Nav */}
            <div className="flex items-center gap-5">
              <Link href="/" className="flex items-center hover:scale-105 transition-transform duration-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/assets/logo.png"
                  alt="open_assets logo"
                  className="h-8 w-auto mix-blend-multiply dark:invert dark:mix-blend-screen select-none pointer-events-none"
                />
              </Link>
              <span className="hidden md:inline border-l border-zinc-200 dark:border-zinc-800 h-4" />
              <Link href="/" className="hidden md:inline hover:text-foreground text-zinc-500 dark:text-zinc-400 transition-colors uppercase tracking-wider font-bold">
                Home
              </Link>
              <Link href="/#product" className="hidden md:inline hover:text-foreground text-zinc-500 dark:text-zinc-400 transition-colors uppercase tracking-wider font-bold">
                Product
              </Link>
              <Link href="/pricing" className="hidden md:inline hover:text-foreground text-zinc-500 dark:text-zinc-400 transition-colors uppercase tracking-wider font-bold">
                Pricing
              </Link>
            </div>

            {/* Title Indicator (Brutalist style) */}
            <div className="absolute left-1/2 -translate-x-1/2 hidden lg:flex items-center gap-2 border border-black dark:border-zinc-800 px-3 py-1 bg-zinc-50 dark:bg-zinc-950 font-black">
              <Terminal className="h-3.5 w-3.5 text-[#ff7c00]" />
              <span>COLLECTIVE_RECRUITMENT.SH</span>
            </div>

            {/* Right Nav */}
            <div className="flex items-center gap-4">
              <ThemeSwitch className="bg-transparent border-0 text-zinc-500 dark:text-zinc-400 hover:text-foreground hover:bg-transparent size-auto p-0 cursor-pointer shadow-none ring-0 focus-visible:ring-0" iconSize={14} />
              <span className="border-l border-zinc-200 dark:border-zinc-800 h-4" />
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
                <Link 
                  href="/login" 
                  className="bg-zinc-900 dark:bg-white text-white dark:text-black font-black uppercase tracking-wider text-[10px] px-3.5 py-1.5 border border-zinc-900 dark:border-white hover:bg-transparent hover:text-zinc-900 dark:hover:bg-transparent dark:hover:text-white transition-all duration-150 rounded-none shadow-md"
                >
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 md:py-16">
          
          {/* Header Section */}
          <div className="text-center space-y-4 mb-16">
            <div className="bg-[#ff7c00] text-black border-2 border-black px-4 py-1.5 inline-block font-mono font-black text-xs tracking-widest uppercase shadow-[3px_3px_0px_0px_#000] dark:shadow-[3px_3px_0px_0px_#27272a]">
              [ SYSTEM_COLLECTIVE_RECRUITMENT ]
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black uppercase tracking-tight max-w-4xl mx-auto leading-none pt-2 text-foreground">
              BUILD MAJOR PROJECTS <br /> 
              <span className="underline decoration-wavy decoration-[#ff7c00] underline-offset-8">WITH ME</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground font-mono max-w-2xl mx-auto uppercase tracking-widest pt-4">
              // NO BORING TASKS. NO REPETITIVE corporate meetings. ONLY HIGH-VELOCITY OPEN-SOURCE ENGINEERING. LETS CREATE SOMETHING BIG.
            </p>
          </div>

          {/* System Specifications Widget */}
          <div className="border-2 border-black dark:border-zinc-800 bg-card p-6 shadow-[6px_6px_0px_0px_#000] dark:shadow-[6px_6px_0px_0px_#27272a] font-mono mb-16 rounded-none relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-[#ff7c00]" />
            <div className="flex items-center justify-between border-b border-dashed border-zinc-200 dark:border-zinc-800 pb-3 mb-4 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
              <span className="text-muted-foreground">// SYSTEM_SPECIFICATIONS</span>
              <span className="text-[#ff7c00] flex items-center gap-1.5 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-[#ff7c00]" /> ACTIVE_RECRUIT_SYNC
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">HOST_IDENTITY:</span>
                <p className="font-black text-foreground">ANANDXDJ // CREATOR</p>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">ROLES_SEEKING:</span>
                <p className="font-black text-foreground">FULLSTACK BUILDERS & ENGINEERS</p>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">CORE_COMMUNITY:</span>
                <p className="font-black text-foreground">OPEN-SOURCE / INDIE-HACKERS</p>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">PRIMARY_MISSION:</span>
                <p className="font-black text-foreground text-[#ff7c00]">CREATE SOMETHING BIG</p>
              </div>
            </div>
          </div>

          {/* Section Divider */}
          <div className="relative flex items-center justify-center mb-16">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t-2 border-dashed border-zinc-200 dark:border-zinc-800" />
            </div>
            <span className="relative bg-background px-4 text-xs font-black tracking-widest text-[#ff7c00]">
              // ACTIVE_IDEAS_LISTING
            </span>
          </div>

          {/* Project Ideas Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-20">
            {projects.map((project) => {
              const Icon = project.icon;
              return (
                <div 
                  key={project.id} 
                  className={`border-2 border-black dark:border-zinc-800 bg-card p-6 shadow-[5px_5px_0px_0px_#000] dark:shadow-[5px_5px_0px_0px_#27272a] hover:shadow-[8px_8px_0px_0px_#000] dark:hover:shadow-[8px_8px_0px_0px_#27272a] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between`}
                >
                  <div className="space-y-6">
                    {/* Card Header */}
                    <div className="space-y-2 text-left">
                      <div className="flex items-center justify-between">
                        <div className={`px-2.5 py-1 border-2 border-black dark:border-zinc-800 inline-flex items-center gap-1.5 font-bold text-xs ${project.accentBg} text-black font-mono shadow-[1.5px_1.5px_0px_0px_#000]`}>
                          <Icon className="h-3.5 w-3.5" />
                          <span>{project.title}</span>
                        </div>
                        <span className="text-[9px] text-muted-foreground uppercase font-bold select-none">
                          {project.stats.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest pt-1 font-bold">
                        {project.subtitle}
                      </p>
                    </div>

                    {/* Card Body */}
                    <p className="text-xs text-muted-foreground leading-relaxed font-mono">
                      {project.description}
                    </p>

                    {/* Stack Badges */}
                    <div className="space-y-1.5">
                      <span className="text-[9px] text-muted-foreground uppercase font-black tracking-wider">// ENG_STACK_MODULES</span>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {project.stack.map((item, idx) => (
                          <span 
                            key={idx} 
                            className="text-[9px] bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-foreground font-semibold rounded-none"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Core Roles / Requirements */}
                    <div className="space-y-2 border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-4">
                      <span className="text-[9px] text-muted-foreground uppercase font-black tracking-wider">// RECRUIT_SPECIFICATION</span>
                      <ul className="space-y-2 pt-0.5">
                        {project.requirements.map((req, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs font-mono">
                            <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${project.accentColor}`} />
                            <span className="text-muted-foreground leading-snug">{req}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Card Footer - CTA */}
                  <div className="mt-8 pt-4 border-t border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground font-mono">SCOPE: {project.stats.scope}</span>
                    <a 
                      href="https://x.com/anandxdj"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-black text-foreground flex items-center gap-1 hover:underline decoration-[#ff7c00] decoration-2 underline-offset-2 uppercase"
                    >
                      Connect <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Contact Dispatch Block */}
          <div className="border-2 border-black dark:border-zinc-800 bg-zinc-950 text-white dark:bg-zinc-900 p-8 sm:p-12 text-center space-y-6 shadow-[8px_8px_0px_0px_#ff7c00] relative overflow-hidden rounded-none">
            {/* Decorative background grid pattern */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none opacity-20" />
            
            <div className="space-y-3 relative z-10 max-w-xl mx-auto">
              <span className="text-[10px] text-[#ff7c00] uppercase tracking-widest font-black">// INITIATE_COMMUNICATION_LINK</span>
              <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white">
                READY TO BUILD THE FUTURE WITH ME?
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed font-mono pt-2">
                Click below to open a direct communication link to my Twitter/X DMs. Tell me which project matches your frequency, link your GitHub/portfolio, and let's coordinate to build something legendary together.
              </p>
            </div>

            <div className="pt-4 relative z-10">
              <a
                href="https://x.com/anandxdj"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2.5 bg-[#ff7c00] text-black border-2 border-black px-8 py-3.5 text-xs font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all duration-150 rounded-none shadow-[4px_4px_0px_0px_#fff] active:translate-y-0.5 cursor-pointer"
              >
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                INITIATE_TRANSMISSION
              </a>
            </div>
          </div>

        </main>

        {/* Global Footer */}
        <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 py-8 text-center text-[10px] text-muted-foreground font-mono uppercase tracking-widest mt-auto">
          <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>© {new Date().getFullYear()} OPEN_ASSETS_COLLECTIVE. ALL SYSTEMS OPERATIONAL.</p>
            <div className="flex items-center gap-4">
              <a href="https://github.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">GITHUB</a>
              <span className="text-zinc-300 dark:text-zinc-800">/</span>
              <a href="https://x.com/anandxdj" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">X_TWITTER</a>
            </div>
          </div>
        </footer>
      </div>
      <Cursor className="hidden md:block text-[#ff7c00]" />
    </CursorProvider>
  );
}
