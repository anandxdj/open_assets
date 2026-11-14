import Link from "next/link";
import { Crumbs, Topbar } from "@/components/layout/AppShell";
import { TabLink, Tabs } from "@/components/ui/tabs";

export type EnhanceTab = "cleanup" | "ai";

/** Top bar shared by every Enhance page: where you are, then the two tools. */
export function EnhanceTopbar({ active }: { active?: EnhanceTab }) {
  return (
    <Topbar className="gap-5">
      {active ? (
        <nav aria-label="Breadcrumb" className="oa-crumbs flex-none">
          <Link href="/enhance" className="text-ink hover:text-brand-text">
            Enhance
          </Link>
        </nav>
      ) : (
        <Crumbs items={[{ label: "Enhance" }]} />
      )}
      <Tabs label="Enhance tools" className="min-w-0 self-stretch border-b-0">
        <TabLink href="/enhance/excalibur" active={active === "cleanup"} className="h-full">
          Cleanup
        </TabLink>
        <TabLink href="/enhance/ai" active={active === "ai"} className="h-full">
          AI enhance
        </TabLink>
      </Tabs>
    </Topbar>
  );
}
