"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/context/AuthContext";
import Link from "next/link";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push("/upload");
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-mono">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-mono flex flex-col relative selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black">
      {/* Background tech grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#e4e4e7_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none opacity-60 z-0" />
      
      {/* Simple navigation header */}
      <header className="border-b border-zinc-200 dark:border-zinc-900 bg-background/95 sticky top-0 z-40 backdrop-blur-sm relative">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between text-xs relative">
          {/* Logo link */}
          <Link href="/" className="flex items-center hover:scale-105 transition-transform duration-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/logo.png"
              alt="open_assets logo"
              className="h-8 w-auto mix-blend-multiply dark:invert dark:mix-blend-screen select-none pointer-events-none"
            />
          </Link>
          
          <div className="flex items-center gap-4">
            <ThemeSwitch className="bg-transparent border-0 text-zinc-500 hover:text-foreground hover:bg-transparent size-auto p-0 cursor-pointer shadow-none ring-0 focus-visible:ring-0" iconSize={14} />
          </div>
        </div>
      </header>

      {/* Auth page content */}
      <main className="flex-1 flex items-center justify-center relative z-10 p-4 sm:p-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
