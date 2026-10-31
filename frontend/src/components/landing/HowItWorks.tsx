import Image from "next/image";
import type { ReactNode } from "react";
import { ArrowRight, Folder } from "lucide-react";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { WRAP } from "@/components/marketing/site";
import { BoundingBox } from "./ProductShot";

const RENAMES = [
  ["asset_006", "knight_shield"],
  ["asset_007", "red_mushroom"],
  ["asset_008", "spell_book"],
];

const VISUAL = "flex h-[168px] flex-col justify-center border-b-[1.5px] border-line-strong";

const STEPS: { title: string; body: ReactNode; visual: ReactNode }[] = [
  {
    title: "Drop an image",
    body: "Sprite sheets, icon grids, UI mockups, manga pages. No transparent background needed; we remove it when we cut the assets.",
    visual: (
      <div className={`${VISUAL} oa-checker items-center p-4`}>
        <Image src="/samples/sprite-sheet.svg" alt="" width={640} height={320} className="h-auto w-full" />
      </div>
    ),
  },
  {
    title: "We box each asset",
    body: "Contour tracing draws a box around every piece. Move, resize, add or delete boxes before you continue.",
    visual: (
      <div className={`${VISUAL} items-center bg-sunken`}>
        <div className="oa-checker relative size-[120px] border-[1.5px] border-line">
          <Image src="/samples/sprite-shield.svg" alt="" width={120} height={120} className="size-full" />
          <BoundingBox name="asset_006" selected style={{ left: "14%", top: "6%", width: "72%", height: "88%" }} />
        </div>
      </div>
    ),
  },
  {
    title: "AI names them",
    body: (
      <>
        A vision model reads the whole sheet, so a potion is <span className="oa-value">health_potion</span>, not{" "}
        <span className="oa-value">asset_001</span>.
      </>
    ),
    visual: (
      <div className={`${VISUAL} gap-2.5 bg-sunken px-5 py-[18px]`}>
        {RENAMES.map(([from, to]) => (
          <span key={from} className="flex items-center gap-2">
            <span className="oa-value text-ink-3 line-through">{from}</span>
            <ArrowRight className="size-3.5 flex-none" />
            <span className="oa-value font-bold">{to}</span>
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Export or publish",
    body: "Download transparent PNGs, upscale them first (up to 4× on Pro), or save them to a collection you can publish.",
    visual: (
      <div className={`${VISUAL} gap-1.5 bg-sunken px-5 py-4`}>
        <span className="flex items-center gap-2">
          <Folder className="size-4 flex-none" />
          <span className="oa-value font-bold">rpg_pack_v1.zip</span>
        </span>
        <span className="oa-value pl-6 text-ink-2">├ health_potion.png</span>
        <span className="oa-value pl-6 text-ink-2">├ iron_sword.png</span>
        <span className="oa-value pl-6 text-ink-2">├ gold_coin.png</span>
        <span className="oa-value pl-6 text-ink-3">└ + 5 more</span>
      </div>
    ),
  },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className={`${WRAP} flex scroll-mt-16 flex-col gap-8 py-16 md:py-[88px]`}>
      <SectionHeader
        eyebrow="How it works"
        titleId="how-title"
        title="Packed image in. Named PNGs out."
        aside={<span className="oa-value text-ink-2">4 steps</span>}
      />
      <ol className="grid gap-[1.5px] border-2 border-line-strong bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex flex-col bg-surface">
            <div aria-hidden>{step.visual}</div>
            <div className="flex flex-col gap-2 p-[18px]">
              <span aria-hidden className="oa-h2 text-brand-text">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="oa-section">{step.title}</h3>
              <p className="text-xs leading-[18px] text-ink-2">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
