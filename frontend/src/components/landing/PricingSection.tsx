import Link from "next/link";
import { Faq } from "@/components/marketing/Faq";
import type { FaqItem } from "@/components/marketing/pricing";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { WRAP, SECTION_GAP, SECTION_Y } from "@/components/marketing/site";

const FAQ: FaqItem[] = [
  {
    question: "Does my sheet need a transparent background?",
    answer: "No. Detection works on the sheet as it is, and the background is removed when the assets are cut.",
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
      className="scroll-mt-16 border-t border-line-soft bg-sunken"
    >
      <div className={`${WRAP} flex flex-col ${SECTION_GAP} ${SECTION_Y}`}>
        <SectionHeader
          eyebrow="Pricing"
          titleId="pricing-title"
          title="Start free. Upgrade when it ships with you."
          aside={
            <Link href="/pricing" className="oa-link text-[13px]">
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
