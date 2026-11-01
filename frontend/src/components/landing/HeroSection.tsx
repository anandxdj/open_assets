import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FREE_SHEETS_PER_MONTH } from "@/components/marketing/pricing";
import { DISPLAY, WRAP } from "@/components/marketing/site";

/**
 * Hero: headline, one sentence, the two actions. The spec grid and the editor
 * shot live in the next section (ProductSection). A masked dot grid sits behind
 * it; no glow.
 */
export function HeroSection() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(color-mix(in_srgb,var(--oa-ink)_16%,transparent)_1px,transparent_1.3px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,#000_35%,transparent_75%)]"
      />
      <div className={`${WRAP} flex min-h-[min(calc(100svh-61px),880px)] flex-col justify-center gap-8 py-20 md:gap-10`}>
        <div className="flex flex-col gap-6">
          <span className="oa-eyebrow">Asset extraction for game and UI artists</span>
          <h1 id="hero-title" className={DISPLAY}>
            Drop one sheet.
            <br />
            Get <span className="bg-brand px-[.12em] text-brand-fg">every</span> asset.
          </h1>
        </div>

        <p className="oa-lead max-w-[560px] text-base leading-[26px]">
          OpenAssets finds each sprite, icon and UI piece on a packed image, names it, cuts it onto a transparent
          background and hands you a clean ZIP.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <Button asChild variant="primary" size="xl" className="max-sm:w-full">
              <Link href="/register">
                Extract your first sheet
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="xl" className="max-sm:w-full">
              <Link href="/collections">Browse collections</Link>
            </Button>
          </div>
          <p className="text-xs leading-[18px] text-ink-2">Free plan: {FREE_SHEETS_PER_MONTH} sheets a month.</p>
        </div>
      </div>
    </section>
  );
}
