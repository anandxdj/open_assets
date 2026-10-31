import type { CSSProperties } from "react";
import Image from "next/image";
import { Check, ChevronRight, Hand, MousePointer2, SquareDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Box = {
  name: string;
  src: string;
  dim: string;
  /** Position on the 640×320 sample sheet, as percentages. */
  l: string;
  t: string;
  w: string;
  h: string;
  selected?: boolean;
};

const BOXES: Box[] = [
  { name: "health_potion", src: "/samples/sprite-potion.svg", dim: "49×68", l: "6.5%", t: "8.7%", w: "7.6%", h: "21.3%" },
  { name: "iron_sword", src: "/samples/sprite-sword.svg", dim: "72×72", l: "28.4%", t: "11.9%", w: "11.25%", h: "22.5%", selected: true },
  { name: "gold_coin", src: "/samples/sprite-coin.svg", dim: "78×78", l: "53.9%", t: "9.1%", w: "12.1%", h: "24.3%" },
  { name: "teal_gem", src: "/samples/sprite-gem.svg", dim: "72×70", l: "78.1%", t: "12.25%", w: "11.2%", h: "22%" },
  { name: "red_heart", src: "/samples/sprite-heart.svg", dim: "78×67", l: "5.1%", t: "61.3%", w: "12.2%", h: "21%" },
  { name: "knight_shield", src: "/samples/sprite-shield.svg", dim: "74×95", l: "29.9%", t: "54.6%", w: "11.5%", h: "29.5%" },
  { name: "red_mushroom", src: "/samples/sprite-shroom.svg", dim: "80×74", l: "53.6%", t: "59%", w: "12.4%", h: "23%" },
  { name: "spell_book", src: "/samples/sprite-book.svg", dim: "66×83", l: "79.6%", t: "56.75%", w: "10.3%", h: "25.9%" },
];

/** A bounding box drawn over the sheet, with its name tag. */
export function BoundingBox({
  name,
  selected,
  style,
  className,
}: {
  name: string;
  selected?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={cn("absolute", selected ? "border-2 border-brand" : "border-[1.5px] border-ink", className)}
      style={style}
    >
      <span
        className={cn(
          "oa-value absolute -top-[19px] h-[18px] whitespace-nowrap px-[5px] text-[10px] font-bold leading-[18px]",
          selected ? "-left-[2px] bg-brand text-brand-fg" : "-left-[1.5px] bg-ink text-page max-md:hidden"
        )}
      >
        {name}
      </span>
    </span>
  );
}

/**
 * Static picture of the extraction editor, built from markup so it follows
 * the theme. It is decorative: the figcaption describes it for screen readers.
 */
export function ProductShot() {
  const selected = BOXES.find((b) => b.selected) ?? BOXES[0];
  return (
    <figure className="overflow-hidden border-2 border-line-strong bg-surface shadow-[10px_10px_0_var(--oa-shadow-ink)]">
      <figcaption className="sr-only">
        The OpenAssets editor with rpg_pack_v1.png open: eight detected assets listed on the left, a box drawn
        around each sprite on the sheet, and the selected iron_sword shown with its bounds on the right.
      </figcaption>
      <div aria-hidden className="pointer-events-none select-none">
        <div className="flex h-11 items-center gap-2.5 border-b-[1.5px] border-line-strong pl-4 pr-3.5">
          <span className="oa-crumbs min-w-0">
            <span className="max-sm:hidden">Extract</span>
            <ChevronRight className="size-3.5 flex-none text-ink-3 max-sm:hidden" />
            <span className="oa-value truncate text-ink">rpg_pack_v1.png</span>
          </span>
          <Badge tone="success" className="max-sm:hidden">
            <Check />8 found
          </Badge>
          <span className="flex-1" />
          <span className="oa-btn oa-btn-secondary oa-btn-sm max-md:hidden">Raw ZIP</span>
          <span className="oa-btn oa-btn-primary oa-btn-sm">Name and export</span>
        </div>

        <div className="flex h-[280px] md:h-[500px]">
          <div className="hidden w-[232px] flex-none flex-col overflow-hidden border-r-[1.5px] border-line bg-surface md:flex">
            <div className="oa-panel-head">
              Detections <span className="oa-count">08</span>
            </div>
            <div className="flex flex-col p-1.5">
              {BOXES.map((b) => (
                <div key={b.name} className="oa-layer" data-selected={b.selected ? "true" : undefined}>
                  <span className="oa-checker flex size-6 flex-none items-center justify-center overflow-hidden border border-line">
                    <Image src={b.src} alt="" width={18} height={18} />
                  </span>
                  <span className="oa-value min-w-0 flex-1 truncate">{b.name}</span>
                  <span className={`oa-value text-[11px] ${b.selected ? "text-ink-2" : "text-ink-3"}`}>{b.dim}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="oa-stage flex min-w-0 flex-1 items-center justify-center">
            <div className="oa-checker relative aspect-[2/1] w-[min(86%,600px)] border-[1.5px] border-line">
              <Image src="/samples/sprite-sheet.svg" alt="" width={640} height={320} className="size-full" loading="eager" />
              {BOXES.map((b) => (
                <BoundingBox
                  key={b.name}
                  name={b.name}
                  selected={b.selected}
                  style={{ left: b.l, top: b.t, width: b.w, height: b.h }}
                />
              ))}
            </div>
            <div className="oa-float absolute bottom-4 left-1/2 -translate-x-1/2">
              <span className="oa-tool bg-ink text-page">
                <MousePointer2 />
              </span>
              <span className="oa-tool">
                <Hand />
              </span>
              <span className="oa-tool">
                <SquareDashed />
              </span>
            </div>
          </div>

          <div className="hidden w-[248px] flex-none flex-col overflow-hidden border-l-[1.5px] border-line bg-surface lg:flex">
            <div className="oa-panel-head">
              <span className="oa-value font-bold">{selected.name}</span>
            </div>
            <div className="oa-panel-sec">
              <div className="oa-checker flex h-[132px] items-center justify-center border-[1.5px] border-line">
                <Image src={selected.src} alt="" width={96} height={96} />
              </div>
            </div>
            <div className="oa-panel-sec">
              <span className="oa-panel-title">Bounds</span>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  ["X", "182"],
                  ["Y", "38"],
                  ["W", "72"],
                  ["H", "72"],
                ].map(([k, v]) => (
                  <span key={k} className="oa-unit-input">
                    <span>{k}</span>
                    {v}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
