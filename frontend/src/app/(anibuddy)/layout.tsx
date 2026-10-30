import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/layout/AuthGate";
import { CreditsProvider } from "@/features/usage/CreditsProvider";

export const metadata: Metadata = { title: "AniBuddy · OpenAssets" };

// AniBuddy's AI steps spend credits (never a user key), so it needs a signed-in user.
export default function AniBuddyLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AuthGate label="Opening AniBuddy">
        <CreditsProvider>{children}</CreditsProvider>
      </AuthGate>
    </AppShell>
  );
}
