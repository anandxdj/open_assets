import { AppShell } from "@/components/layout/AppShell";

// Public: browsing and pack pages work signed-out.
export default function CollectionsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
