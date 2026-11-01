import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/marketing/Reveal";
import { SECTION_Y, WRAP } from "@/components/marketing/site";

/** Orange closing band. Text on orange is always ink. */
export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className="bg-brand text-brand-fg">
      <Reveal stagger className={`${WRAP} flex flex-wrap items-end justify-between gap-8 ${SECTION_Y}`}>
        <h2 id="closing-title" className="oa-display text-[clamp(36px,5vw,64px)]">
          Stop cropping
          <br />
          by hand.
        </h2>
        <Link
          href="/register"
          className={cn(
            buttonVariants({ size: "xl" }),
            // Fixed ink and paper in both themes (the band is orange either way), as on the canvas.
            "border-[#0A0A0A] bg-[#0A0A0A] text-[#F4F3EE] shadow-[4px_4px_0_#F4F3EE] hover:bg-[#0A0A0A] hover:text-[#F4F3EE] focus-visible:outline-[#0A0A0A] max-sm:w-full"
          )}
        >
          Extract your first sheet
          <ArrowRight aria-hidden />
        </Link>
      </Reveal>
    </section>
  );
}
