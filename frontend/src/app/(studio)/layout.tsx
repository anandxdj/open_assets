"use client";

import { Navbar } from "@/components/layout/Navbar";
import { StudioSettingsProvider } from "@/features/studio/hooks/useStudioSettings";
import { StudioShell } from "@/features/studio/components/StudioShell";

// Studio works signed-out too (BYOK), so unlike (dashboard) this layout does
// not redirect unauthenticated users — generation prompts sign-in/BYOK instead.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      <StudioSettingsProvider>
        <StudioShell>{children}</StudioShell>
      </StudioSettingsProvider>
    </div>
  );
}
