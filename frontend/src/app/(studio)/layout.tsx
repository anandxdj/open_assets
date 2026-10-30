import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/layout/AuthGate";
import { StudioShell } from "@/features/studio/components/StudioShell";
import { StudioSettingsProvider } from "@/features/studio/hooks/useStudioSettings";
import { CreditsProvider } from "@/features/usage/CreditsProvider";

export const metadata: Metadata = { title: "Studio · OpenAssets" };

// Studio spends credits, so it needs a signed-in user. Bringing your own
// OpenRouter key (StudioSettingsProvider) skips the credit charge, not the
// sign-in. useStudioSettings and useCredits throw without their providers.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AuthGate label="Opening Studio">
        <CreditsProvider>
          <StudioSettingsProvider>
            <StudioShell>{children}</StudioShell>
          </StudioSettingsProvider>
        </CreditsProvider>
      </AuthGate>
    </AppShell>
  );
}
