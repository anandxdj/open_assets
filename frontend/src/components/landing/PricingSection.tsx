import Link from "next/link";
import { Faq } from "@/components/marketing/Faq";
import type { FaqItem } from "@/components/marketing/pricing";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { WRAP } from "@/components/marketing/site";

const FAQ: FaqItem[] = [
  {
    question: "Does my sheet need a transparent background?",
    answer: "No. If it has no alpha channel, we remove the background before detection.",
  },
  {
    question: "Which files can I upload?",
    answer: "PNG, JPG and WebP, up to 20 MB, one sheet at a time.",
  },
  {
    question: "What if detection misses something?",
    answer: "Draw, move, resize or delete boxes in the editor before you export.",
  },
  {
    question: "Who can see my assets?",
    answer: "Only you, and your team if you share a collection with it. Collections stay private drafts until you publish them.",
  },
];

/** Landing pricing: plan columns from the shared module plus product FAQ. */
export function PricingSection() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="scroll-mt-16 border-t-2 border-line-strong bg-sunken"
    >
      <div className={`${WRAP} flex flex-col gap-8 py-16 md:py-[88px]`}>
        <SectionHeader
          eyebrow="Pricing"
          titleId="pricing-title"
          title="Start free. Upgrade when it ships with you."
          aside={
            <Link href="/pricing" className="oa-link text-xs">
              Compare every feature
            </Link>
          }
        />
        <PricingTiers />
        <Faq items={FAQ} />
      </div>
    </section>
  );
}
