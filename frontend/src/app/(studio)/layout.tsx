import { AppShell } from "@/components/layout/AppShell";
import { ComingSoonPage } from "@/components/layout/ComingSoonPage";

// Studio works signed-out too (BYOK), so unlike (dashboard) this layout does
// not gate on auth. It stays behind ComingSoonPage until release. To ungate,
// render children wrapped as:
//   <AppShell><StudioSettingsProvider><StudioShell>{children}</StudioShell></StudioSettingsProvider></AppShell>
// (useStudioSettings throws without the provider).
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  void children;
  return (
    <AppShell>
      <ComingSoonPage
        name="Studio"
        description="Generate animated sprites, tile sets, prop atlases and parallax backgrounds that drop straight into your library."
      />
    </AppShell>
  );
}
