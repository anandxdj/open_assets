import type { ReactNode } from "react";
import { DocsNav } from "@/components/marketing/DocsNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { WRAP } from "@/components/marketing/site";

/** Marketing chrome around the docs set: header, the docs sidebar, the page, footer. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <MarketingHeader />
      <main className="flex-1">
        <div className={`${WRAP} grid gap-10 py-12 md:py-16 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16`}>
          <DocsNav />
          {children}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
