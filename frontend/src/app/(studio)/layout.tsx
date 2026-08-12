"use client";

import { Navbar } from "@/components/layout/Navbar";
import { ComingSoonPage } from "@/components/layout/ComingSoonPage";

// Studio works signed-out too (BYOK), so unlike (dashboard) this layout does
// not redirect unauthenticated users — generation prompts sign-in/BYOK instead.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  void children;
  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      <ComingSoonPage
        name="Studio"
        description="Our asset-generation workspace is still being prepared for release. It is not available in this deployment yet."
      />
    </div>
  );
}
