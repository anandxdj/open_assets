"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Studio chrome inside the app shell: top bar with the tool tabs, credits
// badge and settings, plus the out-of-credits notice. Tool switching is router
// navigation; the last-used tool persists for the /studio redirect.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { KeyRound, SlidersHorizontal } from "lucide-react";
import { Crumbs, Topbar } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { STORAGE_MODE } from "@/features/studio/lib/app";
import type { Mode } from "@/features/studio/lib/app";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { SettingsDrawer } from "@/features/studio/components/SettingsDrawer";
import { ApiKeyModal } from "@/features/studio/components/ApiKeyModal";
import { CreditsBadge, CreditsNotice } from "@/features/usage/CreditsBadge";

const MODE_TABS: { mode: Mode; label: string; href: string }[] = [
  { mode: "sprite", label: "Sprites", href: "/studio/sprites" },
  { mode: "tile", label: "Tiles", href: "/studio/tiles" },
  { mode: "props", label: "Props", href: "/studio/props" },
  { mode: "parallax", label: "Parallax", href: "/studio/parallax" },
  { mode: "extender", label: "Extender", href: "/studio/extender" },
];

/** BYOK requests spend no credits, so the badge says so instead of a balance. */
function StudioCredits() {
  const { apiKey, hydrated } = useStudioSettings();
  if (!hydrated) return null;
  if (apiKey) {
    return (
      <Badge title="Using your own OpenRouter key. No AI credit limit.">
        <KeyRound aria-hidden />
        BYOK
        <span className="sr-only">: using your own OpenRouter key</span>
      </Badge>
    );
  }
  return <CreditsBadge />;
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { apiKey, setApiKey } = useStudioSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  // On phones the tab row scrolls: keep the current tool in view.
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname]);

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
      <Topbar className="gap-3 lg:gap-5">
        <span className="hidden lg:block">
          <Crumbs items={[{ label: "Studio" }]} />
        </span>
        <div ref={tabsRef} className="flex min-w-0 flex-1 self-stretch lg:flex-none">
          <Tabs
            label="Studio tools"
            className="min-w-0 flex-1 border-b-0 [scrollbar-width:none] md:gap-1 [&::-webkit-scrollbar]:hidden"
          >
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
        </div>
        <span className="hidden flex-1 lg:block" />
        <StudioCredits />
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

      {!apiKey && (
        <CreditsNotice>
          <Button size="sm" onClick={() => setKeyModalOpen(true)}>
            <KeyRound aria-hidden />
            Add your own key
          </Button>
        </CreditsNotice>
      )}

      <h1 className="sr-only">Studio {MODE_TABS.find((t) => pathname.startsWith(t.href))?.label ?? ""}</h1>

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
