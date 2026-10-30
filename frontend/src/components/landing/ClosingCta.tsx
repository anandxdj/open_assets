import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WRAP } from "@/components/marketing/site";

/** Orange closing band. Text on orange is always ink. */
export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className="border-t-2 border-line-strong bg-brand text-brand-fg">
      <div className={`${WRAP} flex flex-wrap items-end justify-between gap-7 py-14 md:py-[72px]`}>
        <h2 id="closing-title" className="oa-display text-[clamp(40px,6vw,80px)] leading-[.95]">
          Stop cropping
          <br />
          by hand.
        </h2>
        <Link
          href="/register"
          className={cn(
            buttonVariants({ size: "xl" }),
            "border-ink bg-ink text-page shadow-[4px_4px_0_var(--oa-bg)] hover:bg-ink hover:text-page focus-visible:outline-brand-fg max-sm:w-full"
          )}
        >
          Extract your first sheet
          <ArrowRight aria-hidden />
        </Link>
      </div>
    </section>
  );
}
