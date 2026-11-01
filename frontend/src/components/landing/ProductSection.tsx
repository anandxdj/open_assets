import { Reveal } from "@/components/marketing/Reveal";
import { CARD, CARD_GAP, COPY, WRAP } from "@/components/marketing/site";
import { ProductShot } from "./ProductShot";

const SPECS = [
  { label: "Input", value: "PNG, JPEG or WebP · up to 20 MB" },
  { label: "Detect", value: "OpenCV contour tracing" },
  { label: "Name", value: "Vision model reads the sheet" },
  { label: "Output", value: "ZIP of transparent PNGs", accent: true },
];

/**
 * What goes in and what comes out: the spec cells and the editor shot (an
 * aria-hidden depiction, so it is not a second call to action). The hero above
 * already leaves its own space, so this section only pads below.
 */
export function ProductSection() {
  return (
    <section aria-label="What OpenAssets takes and returns" className={`${WRAP} flex flex-col gap-10 pb-20 md:gap-12 md:pb-28`}>
      <Reveal as="dl" stagger className={`grid ${CARD_GAP} sm:grid-cols-2 lg:grid-cols-4`}>
        {SPECS.map((spec) => (
          <div
            key={spec.label}
            className={
              spec.accent
                ? "flex flex-col gap-1.5 border border-line-soft bg-brand px-6 py-5 text-brand-fg"
                : `flex flex-col gap-1.5 px-6 py-5 ${CARD}`
            }
          >
            <dt className={spec.accent ? "oa-label text-brand-fg" : "oa-label"}>{spec.label}</dt>
            <dd className={COPY}>{spec.value}</dd>
          </div>
        ))}
      </Reveal>

      <Reveal>
        <ProductShot />
      </Reveal>
    </section>
  );
}
