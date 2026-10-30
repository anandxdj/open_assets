import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FREE_SHEETS_PER_MONTH } from "@/components/marketing/pricing";
import { WRAP } from "@/components/marketing/site";
import { ProductShot } from "./ProductShot";

const SPECS = [
  { label: "Input", value: "PNG, JPG, WebP · up to 20 MB" },
  { label: "Detect", value: "OpenCV contour tracing" },
  { label: "Name", value: "Vision model reads the sheet" },
  { label: "Output", value: "ZIP of transparent PNGs", accent: true },
];

export function HeroSection() {
  return (
    <section aria-labelledby="hero-title" className={`${WRAP} flex flex-col gap-10 pb-16 pt-12 md:pt-[72px]`}>
      <div className="flex flex-col gap-6">
        <span className="oa-eyebrow">Asset extraction for game and UI artists</span>
        <h1 id="hero-title" className="oa-display text-[clamp(36px,7.4vw,104px)] leading-[.95]">
          Drop one sheet.
          <br />
          Get <span className="bg-brand px-[.12em] text-brand-fg">every</span> asset.
        </h1>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <p className="oa-lead max-w-[560px] text-base leading-[26px]">
          OpenAssets finds each sprite, icon and UI piece on a packed image, names it, cuts it onto a transparent
          background and hands you a clean ZIP.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto">
          <div className="flex flex-wrap gap-3.5">
            <Button asChild variant="primary" size="xl" className="max-sm:w-full">
              <Link href="/register">
                Extract your first sheet
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="xl" className="max-sm:w-full">
              <Link href="/collections">Browse packs</Link>
            </Button>
          </div>
          <p className="text-[11px] leading-4 text-ink-2">Free plan: {FREE_SHEETS_PER_MONTH} sheets a month.</p>
        </div>
      </div>

      <dl className="grid gap-[1.5px] border-2 border-line-strong bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
        {SPECS.map((spec) => (
          <div
            key={spec.label}
            className={
              spec.accent
                ? "flex flex-col gap-1 bg-brand px-[18px] py-3.5 text-brand-fg"
                : "flex flex-col gap-1 bg-surface px-[18px] py-3.5"
            }
          >
            <dt className={spec.accent ? "oa-label text-brand-fg" : "oa-label"}>{spec.label}</dt>
            <dd className="text-xs leading-[18px]">{spec.value}</dd>
          </div>
        ))}
      </dl>

      <ProductShot />
    </section>
  );
}
