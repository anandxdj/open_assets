import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { WRAP } from "@/components/marketing/site";

/* Static example tiles built from the bundled samples; the real gallery lives at /collections. */
const PACKS: { name: string; sprites: string[] }[] = [
  { name: "Dungeon loot", sprites: ["sprite-potion", "sprite-coin", "sprite-gem", "sprite-book"] },
  { name: "Slime friends", sprites: ["slime-green", "slime-blue", "slime-pink", "slime-amber"] },
  { name: "Knight kit", sprites: ["sprite-sword", "sprite-shield", "sprite-heart", "sprite-potion"] },
  { name: "Forest pickups", sprites: ["sprite-shroom", "sprite-coin", "sprite-heart", "sprite-gem"] },
];

export function GallerySection() {
  return (
    <section
      id="gallery"
      aria-labelledby="gallery-title"
      className={`${WRAP} flex scroll-mt-16 flex-col gap-7 py-16 md:py-[88px]`}
    >
      <SectionHeader
        eyebrow="Community gallery"
        titleId="gallery-title"
        title="Publish a pack. Browse what others made."
        aside={
          <Button asChild variant="secondary" size="lg">
            <Link href="/collections">Browse all packs</Link>
          </Button>
        }
      />
      <ul className="grid border-l-2 border-t-2 border-line-strong sm:grid-cols-2 lg:grid-cols-4">
        {PACKS.map((pack) => (
          <li key={pack.name} className="border-b-2 border-r-2 border-line-strong bg-surface">
            <Link href="/collections" className="group flex h-full flex-col text-ink">
              <span
                aria-hidden
                className="oa-checker grid aspect-[4/3] grid-cols-2 border-b-[1.5px] border-line-strong"
              >
                {pack.sprites.map((s, i) => (
                  <span key={`${s}-${i}`} className="flex items-center justify-center">
                    <Image src={`/samples/${s}.svg`} alt="" width={64} height={64} className="h-auto w-[56%]" />
                  </span>
                ))}
              </span>
              <span className="flex flex-col gap-1 px-3.5 py-3">
                <span className="flex justify-between gap-2">
                  <span className="oa-section group-hover:underline group-hover:decoration-[1.5px] group-hover:underline-offset-4">
                    {pack.name}
                  </span>
                  <span className="oa-value text-ink-3">4 sprites</span>
                </span>
                <span className="text-[11px] leading-4 text-ink-2">Example pack</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
