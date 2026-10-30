import { AppShell } from "@/components/layout/AppShell";
import { ComingSoonPage } from "@/components/layout/ComingSoonPage";

export default function AniBuddyLayout({ children }: { children: React.ReactNode }) {
  void children;
  return (
    <AppShell>
      <ComingSoonPage
        name="AniBuddy"
        description="Rig a character you drew, then animate it with a prompt or by hand and export frames, a GIF or a project file."
      />
    </AppShell>
  );
}
