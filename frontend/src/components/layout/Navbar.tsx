"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/context/AuthContext";
import { cn } from "@/lib/utils";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import UserAccountAvatar from "@/components/ui/smoothui/user-account-avatar";

export function Navbar() {
  const { user, logout, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  // Determine active route state
  const isUploadActive = pathname === "/upload" || pathname.startsWith("/editor");
  const isCollectionActive = pathname.startsWith("/dashboard/collections");
  const isBrowseActive = pathname === "/collections" || pathname.startsWith("/collections/");
  const isStudioActive = pathname.startsWith("/studio");
  const isEnhanceActive = pathname.startsWith("/enhance");
  const isAniBuddyActive = pathname.startsWith("/anibuddy");

  return (
    <header className="border-b-2 border-zinc-950 dark:border-zinc-800 bg-background/95 backdrop-blur-sm sticky top-0 z-40 font-mono transition-colors duration-200">
      <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
        
        {/* Left Side: Brand Logo Icon Only (No Text) */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center hover:scale-105 transition-transform duration-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/logo.png"
              alt="open_assets logo"
              className="h-8 w-auto mix-blend-multiply dark:invert dark:mix-blend-screen select-none pointer-events-none"
            />
          </Link>

          {/* Navigation Links Block */}
          <nav className="flex items-center gap-2">
            {user && (
              <>
                <Link
                  href="/upload"
                  className={cn(
                    "text-xs px-4 py-2 border font-bold uppercase transition-all duration-150 rounded-none",
                    isUploadActive
                      ? "bg-zinc-950 text-white dark:bg-white dark:text-black border-zinc-950 dark:border-white font-black"
                      : "text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"
                  )}
                >
                  Upload
                </Link>
                <Link
                  href="/dashboard/collections"
                  className={cn(
                    "text-xs px-4 py-2 border font-bold uppercase transition-all duration-150 rounded-none",
                    isCollectionActive
                      ? "bg-zinc-950 text-white dark:bg-white dark:text-black border-zinc-950 dark:border-white font-black"
                      : "text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"
                  )}
                >
                  My Collections
                </Link>
              </>
            )}
            <Link
              href="/collections"
              className={cn(
                "text-xs px-4 py-2 border font-bold uppercase transition-all duration-150 rounded-none",
                isBrowseActive
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black border-zinc-950 dark:border-white font-black"
                  : "text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"
              )}
            >
              Browse
            </Link>
            <Link
              href="/studio"
              className={cn(
                "text-xs px-4 py-2 border font-bold uppercase transition-all duration-150 rounded-none",
                isStudioActive
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black border-zinc-950 dark:border-white font-black"
                  : "text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"
              )}
            >
              Studio
            </Link>
            <Link
              href="/enhance"
              className={cn(
                "text-xs px-4 py-2 border font-bold uppercase transition-all duration-150 rounded-none",
                isEnhanceActive
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black border-zinc-950 dark:border-white font-black"
                  : "text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"
              )}
            >
              Enhance
            </Link>
            <Link
              href="/anibuddy"
              className={cn(
                "text-xs px-4 py-2 border font-bold uppercase transition-all duration-150 rounded-none",
                isAniBuddyActive
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black border-zinc-950 dark:border-white font-black"
                  : "text-zinc-500 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"
              )}
            >
              AniBuddy
            </Link>
          </nav>
        </div>

        {/* Right Side: Theme Switcher & Premium User Avatar Popover */}
        <div className="flex items-center gap-4">
          {/* Custom Theme Switcher */}
          <ThemeSwitch
            className="bg-transparent border-0 text-zinc-500 dark:text-zinc-400 hover:text-foreground hover:bg-transparent size-auto p-0 cursor-pointer shadow-none ring-0 focus-visible:ring-0"
            iconSize={14}
          />

          {/* Vertical Separator */}
          <span className="border-l border-zinc-200 dark:border-zinc-800 h-5" />

          {/* Custom Account Dropdown / Auth Buttons */}
          {!loading && (
            user ? (
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
            )
          )}
        </div>
      </div>
    </header>
  );
}
