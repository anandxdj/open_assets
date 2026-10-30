import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FreeCta } from "@/features/plans/FreeCta";
import { ProTrialCta } from "@/features/plans/ProTrialCta";
import { PLANS, type Plan } from "./pricing";

function PlanCta({ plan }: { plan: Plan }) {
  // The Pro plan's button is live: it starts the trial or shows its state.
  if (plan.id === "pro") return <ProTrialCta />;
  // The free plan's button says "Open app" once signed in.
  if (plan.id === "free") return <FreeCta label={plan.cta.label} href={plan.cta.href} />;
  const variant = plan.featured ? "primary" : "secondary";
  const isMail = plan.cta.href.startsWith("mailto:");
  return (
    <Button asChild variant={variant} size="lg" block>
      {isMail ? <a href={plan.cta.href}>{plan.cta.label}</a> : <Link href={plan.cta.href}>{plan.cta.label}</Link>}
    </Button>
  );
}

/** The three plan columns. Data comes from ./pricing. */
export function PricingTiers({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <ul className="grid gap-[2px] border-2 border-line-strong bg-line-strong lg:grid-cols-3">
      {PLANS.map((plan) => (
        <li key={plan.id} className="flex flex-col bg-surface">
          {plan.featured && (
            <p className="oa-label flex h-8 items-center border-b-2 border-line-strong bg-brand px-6 text-brand-fg md:px-7">
              Most popular
            </p>
          )}
          <div className="flex flex-1 flex-col gap-5 p-6 md:p-7">
            <div className="flex flex-col gap-1.5">
              <Heading className="oa-h3">{plan.name}</Heading>
              <p className="text-xs leading-[18px] text-ink-2">{plan.tagline}</p>
            </div>
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="oa-h1">{plan.price}</span>
              {plan.period && <span className="oa-label">{plan.period}</span>}
            </p>
            <PlanCta plan={plan} />
            <ul className="flex flex-col text-xs leading-[18px]" aria-label={`${plan.name} includes`}>
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2.5 border-t border-rule py-[9px]">
                  <span aria-hidden className="oa-value leading-[18px] text-brand-text">
                    +
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ul>
  );
}
