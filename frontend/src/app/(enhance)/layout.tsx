import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/layout/AuthGate";

export default function EnhanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AuthGate label="Opening Enhance">{children}</AuthGate>
    </AppShell>
  );
}
