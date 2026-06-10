"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Studio chrome: mode tabs, credits badge, settings gear. Mode switching is
// router navigation; the last-used mode persists for the /studio redirect.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { STORAGE_MODE } from "@/features/studio/lib/app";
import type { Mode } from "@/features/studio/lib/app";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { SettingsDrawer } from "@/features/studio/components/SettingsDrawer";
import { ApiKeyModal } from "@/features/studio/components/ApiKeyModal";

const MODE_TABS: { mode: Mode; label: string; href: string }[] = [
  { mode: "extender", label: "Extender", href: "/studio/extender" },
  { mode: "parallax", label: "Parallax", href: "/studio/parallax" },
  { mode: "tile", label: "Tiles", href: "/studio/tiles" },
  { mode: "sprite", label: "Sprites", href: "/studio/sprites" },
  { mode: "props", label: "Props", href: "/studio/props" },
];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { apiKey, setApiKey, credits, hydrated } = useStudioSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  // Remember the active mode so /studio can resume it next visit.
  useEffect(() => {
    const active = MODE_TABS.find((t) => pathname.startsWith(t.href));
    if (active) {
      try {
        localStorage.setItem(STORAGE_MODE, active.mode);
      } catch {
        /* ignore */
      }
    }
  }, [pathname]);

  return (
    <div className="flex min-h-0 flex-1 flex-col font-mono">
      <div className="flex h-12 shrink-0 items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 bg-background px-4">
        <nav className="flex items-center gap-1">
          {MODE_TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.mode}
                href={tab.href}
                className={cn(
                  "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border rounded-none transition-all duration-150",
                  active
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black border-zinc-950 dark:border-white font-black"
                    : "text-zinc-500 hover:text-foreground border-transparent hover:border-zinc-300 dark:hover:border-zinc-700",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {hydrated && (
            <span
              className="inline-flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-[11px] font-bold uppercase text-muted-foreground"
              title={
                apiKey
                  ? "Using your own OpenRouter key — no limits"
                  : credits
                    ? `Free credits — resets ${new Date(credits.resetAt).toLocaleDateString()}`
                    : "Sign in for free credits or add your own key"
              }
            >
              <Coins size={12} />
              {apiKey ? "BYOK" : credits ? `${credits.credits} CR` : "—"}
            </span>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Studio settings"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onEditApiKey={() => {
          setSettingsOpen(false);
          setKeyModalOpen(true);
        }}
      />
      {keyModalOpen && (
        <ApiKeyModal
          initialValue={apiKey}
          onSave={(key) => {
            setApiKey(key);
            setKeyModalOpen(false);
          }}
          onClose={() => setKeyModalOpen(false)}
        />
      )}
    </div>
  );
}
