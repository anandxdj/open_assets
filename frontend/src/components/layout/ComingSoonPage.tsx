import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Topbar, Crumbs } from "@/components/layout/AppShell";

type ComingSoonPageProps = {
  name: string;
  description: string;
};

export function ComingSoonPage({ name, description }: ComingSoonPageProps) {
  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: name }]} />
      </Topbar>
      <main className="flex flex-1 items-center justify-center overflow-auto px-4 py-12 pb-24 md:pb-12">
        <section className="flex max-w-xl flex-col items-center gap-5 text-center">
          <Badge>Coming soon</Badge>
          <h1 className="oa-h2">{name} is almost ready</h1>
          <p className="text-[13px] leading-5 text-ink-2">{description}</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button asChild variant="primary">
              <Link href="/collections">Browse community packs</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/upload">Extract a sheet</Link>
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}
