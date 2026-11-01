import type { CSSProperties, HTMLAttributes } from "react";
import Image from "next/image";
import { Check, ChevronRight, Hand, MousePointer2, SquareDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProductShotPlayer } from "./ProductShotPlayer";
import { FINAL_FRAME, RENAME_TILE, TILE_COUNT } from "./productShotTimeline";
import styles from "./ProductShot.module.css";

type Box = {
  name: string;
  src: string;
  dim: string;
  /** Position on the 640×320 sample sheet, as percentages. */
  l: string;
  t: string;
  w: string;
  h: string;
};

const BOXES: Box[] = [
  { name: "health_potion", src: "/samples/sprite-potion.svg", dim: "49×68", l: "6.5%", t: "8.7%", w: "7.6%", h: "21.3%" },
  { name: "iron_sword", src: "/samples/sprite-sword.svg", dim: "72×72", l: "28.4%", t: "11.9%", w: "11.25%", h: "22.5%" },
  { name: "gold_coin", src: "/samples/sprite-coin.svg", dim: "78×78", l: "53.9%", t: "9.1%", w: "12.1%", h: "24.3%" },
  { name: "teal_gem", src: "/samples/sprite-gem.svg", dim: "72×70", l: "78.1%", t: "12.25%", w: "11.2%", h: "22%" },
  { name: "red_heart", src: "/samples/sprite-heart.svg", dim: "78×67", l: "5.1%", t: "61.3%", w: "12.2%", h: "21%" },
  { name: "knight_shield", src: "/samples/sprite-shield.svg", dim: "74×95", l: "29.9%", t: "54.6%", w: "11.5%", h: "29.5%" },
  { name: "red_mushroom", src: "/samples/sprite-shroom.svg", dim: "80×74", l: "53.6%", t: "59%", w: "12.4%", h: "23%" },
  { name: "spell_book", src: "/samples/sprite-book.svg", dim: "66×83", l: "79.6%", t: "56.75%", w: "10.3%", h: "25.9%" },
];

/**
 * A bounding box drawn over the sheet, with its name tag. `selected` is also
 * readable as `data-selected`, so the landing shot can move the selection by
 * changing an attribute instead of re-rendering.
 */
export function BoundingBox({
  name,
  selected,
  style,
  className,
  rename,
  ...rest
}: {
  name: string;
  selected?: boolean;
  style?: CSSProperties;
  className?: string;
  /** Marks the name tag as the text the product shot types a new name into. */
  rename?: boolean;
} & Omit<HTMLAttributes<HTMLSpanElement>, "style" | "className">) {
  return (
    <span
      {...rest}
      data-selected={selected ? "true" : undefined}
      className={cn(
        "group/box absolute border-[1.5px] border-ink data-[selected=true]:border-2 data-[selected=true]:border-brand",
        className
      )}
      style={style}
    >
      <span
        data-ps-rename={rename ? "" : undefined}
        className="oa-value absolute -left-[1.5px] -top-[19px] h-[18px] whitespace-nowrap bg-ink px-[5px] text-[10px] font-bold leading-[18px] text-page max-md:hidden group-data-[selected=true]/box:-left-[2px] group-data-[selected=true]/box:block group-data-[selected=true]/box:bg-brand group-data-[selected=true]/box:text-brand-fg"
      >
        {name}
      </span>
    </span>
  );
}

/** Where a box sits on the 640×320 sample sheet, in sheet pixels. */
function boundsOf(b: Box): [string, string][] {
  const [w, h] = b.dim.split("×");
  return [
    ["X", String(Math.round((parseFloat(b.l) / 100) * 640))],
    ["Y", String(Math.round((parseFloat(b.t) / 100) * 320))],
    ["W", w],
    ["H", h],
  ];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Picture of the extraction editor, built from markup so it follows the theme.
 * It is decorative: the figcaption describes it for screen readers.
 *
 * The markup is the finished frame: all eight boxes drawn, iron_sword selected,
 * `knight_shield` named. That is what no-JS, reduced-motion and print see. When
 * `animated` is on, `ProductShotPlayer` replays the editor's states by setting
 * `data-*` attributes on the `data-ps` elements below (see `productShotTimeline`),
 * and the transitions in `ProductShot.module.css` do the drawing. Pass
 * `animated={false}` where motion would distract, for example beside a form.
 */
export function ProductShot({ animated = true }: { animated?: boolean }) {
  const final = FINAL_FRAME.selected;
  const shot = (
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
            <Check />
            <span>
              <span data-ps-count="">{TILE_COUNT}</span> found
            </span>
          </Badge>
          <span className="flex-1" />
          <span className="oa-btn oa-btn-secondary oa-btn-sm max-md:hidden">Raw ZIP</span>
          <span className="oa-btn oa-btn-primary oa-btn-sm">Name and export</span>
        </div>

        <div className="flex h-[280px] md:h-[500px]">
          <div className="hidden w-[232px] flex-none flex-col overflow-hidden border-r-[1.5px] border-line bg-surface md:flex">
            <div className="oa-panel-head">
              Detections{" "}
              <span className="oa-count" data-ps-count="pad">
                {pad2(TILE_COUNT)}
              </span>
            </div>
            <div className="flex flex-col p-1.5">
              {BOXES.map((b, i) => (
                <div
                  key={b.name}
                  className="oa-layer group/row"
                  data-ps="row"
                  data-i={i}
                  data-on=""
                  data-selected={i === final ? "true" : undefined}
                >
                  <span className="oa-checker flex size-6 flex-none items-center justify-center overflow-hidden border border-line">
                    <Image src={b.src} alt="" width={18} height={18} />
                  </span>
                  <span className="oa-value min-w-0 flex-1 truncate" data-ps-rename={i === RENAME_TILE ? "" : undefined}>
                    {b.name}
                  </span>
                  <span className="oa-value text-[11px] text-ink-3 group-data-[selected=true]/row:text-ink-2">{b.dim}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="oa-stage flex min-w-0 flex-1 items-center justify-center">
            <div className="oa-checker relative aspect-[2/1] w-[min(86%,600px)] border-[1.5px] border-line">
              <Image src="/samples/sprite-sheet.svg" alt="" width={640} height={320} className="size-full" loading="eager" />
              {BOXES.map((b, i) => (
                <BoundingBox
                  key={b.name}
                  name={b.name}
                  selected={i === final}
                  rename={i === RENAME_TILE}
                  data-ps="box"
                  data-i={i}
                  data-on=""
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

          <div className="hidden w-[248px] flex-none overflow-hidden border-l-[1.5px] border-line bg-surface lg:grid lg:grid-cols-1 lg:content-start">
            <div className={styles.insp} data-ps="insp" data-i={-1}>
              <div className="oa-panel-head">Sheet</div>
              <div className="oa-panel-sec">
                <span className="oa-panel-title">File</span>
                <span className="oa-value truncate">rpg_pack_v1.png</span>
              </div>
              <div className="oa-panel-sec">
                <span className="oa-panel-title">Boxes</span>
                <span className="oa-value" data-ps-count="">
                  {TILE_COUNT}
                </span>
              </div>
            </div>
            {BOXES.map((b, i) => (
              <div
                key={b.name}
                className={styles.insp}
                data-ps="insp"
                data-i={i}
                data-selected={i === final ? "true" : undefined}
              >
                <div className="oa-panel-head">
                  <span className="oa-value font-bold" data-ps-rename={i === RENAME_TILE ? "" : undefined}>
                    {b.name}
                  </span>
                </div>
                <div className="oa-panel-sec">
                  <div className="oa-checker flex h-[132px] items-center justify-center border-[1.5px] border-line">
                    <Image src={b.src} alt="" width={96} height={96} />
                  </div>
                </div>
                <div className="oa-panel-sec">
                  <span className="oa-panel-title">Bounds</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {boundsOf(b).map(([k, v]) => (
                      <span key={k} className="oa-unit-input">
                        <span>{k}</span>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
  return animated ? <ProductShotPlayer>{shot}</ProductShotPlayer> : shot;
}
