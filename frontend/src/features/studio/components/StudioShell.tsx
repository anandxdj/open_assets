"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Studio chrome inside the app shell: top bar with the tool tabs, credits
// badge and settings. Tool switching is router navigation; the last-used tool
// persists for the /studio redirect.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Coins, KeyRound, SlidersHorizontal } from "lucide-react";
import { Crumbs, Topbar } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { STORAGE_MODE } from "@/features/studio/lib/app";
import type { Mode } from "@/features/studio/lib/app";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { SettingsDrawer } from "@/features/studio/components/SettingsDrawer";
import { ApiKeyModal } from "@/features/studio/components/ApiKeyModal";

const MODE_TABS: { mode: Mode; label: string; href: string }[] = [
  { mode: "sprite", label: "Sprites", href: "/studio/sprites" },
  { mode: "tile", label: "Tiles", href: "/studio/tiles" },
  { mode: "props", label: "Props", href: "/studio/props" },
  { mode: "parallax", label: "Parallax", href: "/studio/parallax" },
  { mode: "extender", label: "Extender", href: "/studio/extender" },
];

function CreditsBadge() {
  const { apiKey, credits, hydrated } = useStudioSettings();
  if (!hydrated) return null;

  if (apiKey) {
    return (
      <Badge title="Using your own OpenRouter key. No credit limit.">
        <KeyRound aria-hidden />
        BYOK
        <span className="sr-only">: using your own OpenRouter key</span>
      </Badge>
    );
  }
  if (credits) {
    const reset = new Date(credits.resetAt).toLocaleDateString();
    return (
      <Badge title={`Free credits reset ${reset}`}>
        <Coins aria-hidden />
        {credits.credits} credits
        <span className="sr-only">, reset {reset}</span>
      </Badge>
    );
  }
  return (
    <Badge title="Sign in for free credits or add your own key">
      <Coins aria-hidden />
      <span aria-hidden>—</span>
      <span className="sr-only">No credits. Sign in for free credits or add your own key.</span>
    </Badge>
  );
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { apiKey, setApiKey } = useStudioSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  // Remember the active tool so /studio can resume it next visit.
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
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar className="gap-3 md:gap-5">
        <span className="hidden md:block">
          <Crumbs items={[{ label: "Studio" }]} />
        </span>
        <Tabs label="Studio tools" className="min-w-0 flex-1 self-stretch border-b-0 md:flex-none md:gap-1">
          {MODE_TABS.map((tab) => (
            <TabLink
              key={tab.mode}
              href={tab.href}
              active={pathname.startsWith(tab.href)}
              className="h-full px-2.5 md:px-3.5"
            >
              {tab.label}
            </TabLink>
          ))}
        </Tabs>
        <span className="hidden flex-1 md:block" />
        <span className="hidden sm:inline-flex">
          <CreditsBadge />
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={() => setSettingsOpen(true)}
          aria-label="Studio settings"
          title="Studio settings"
        >
          <SlidersHorizontal aria-hidden />
        </Button>
      </Topbar>

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
