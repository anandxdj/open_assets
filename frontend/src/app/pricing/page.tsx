import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Faq } from "@/components/marketing/Faq";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import {
  COMPARISON,
  FREE_SHEETS_PER_MONTH,
  PLANS,
  PRICING_FAQ,
  STARTUP_PROGRAM,
  type ComparisonValue,
} from "@/components/marketing/pricing";
import { WRAP } from "@/components/marketing/site";
import { TRIAL_DAYS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing · OpenAssets",
  description: `Start free with ${FREE_SHEETS_PER_MONTH} sheets a month. Pro adds unlimited sheets, finer controls, 4× upscale and API keys.`,
  alternates: { canonical: "/pricing" },
};

function Cell({ value }: { value: ComparisonValue }) {
  if (value === true) {
    return (
      <>
        <Check aria-hidden className="size-4" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus aria-hidden className="size-4 text-ink-3" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="oa-value">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <MarketingHeader />
      <main className="flex-1">
        <section aria-labelledby="pricing-title" className={`${WRAP} flex flex-col gap-10 pb-16 pt-12 md:pb-[88px] md:pt-[72px]`}>
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
            <div className="flex flex-col gap-6">
              <span className="oa-eyebrow">Pricing</span>
              <h1 id="pricing-title" className="oa-display text-[clamp(36px,6.4vw,88px)] leading-[.95]">
                Start free.
                <br />
                Upgrade when it ships.
              </h1>
            </div>
            <div className="flex max-w-[420px] flex-col items-start gap-3">
              <p className="oa-lead">
                Free is free. Pro adds unlimited sheets, finer controls, the API and team sharing. Enterprise is for
                bigger limits and custom terms: contact sales.
              </p>
              <Link href="#startups" className="oa-link text-xs">
                Startup program: one-on-one onboarding
              </Link>
            </div>
          </div>

          <PricingTiers headingLevel="h2" />
          <p className="text-xs leading-[18px] text-ink-2">Pro starts with a {TRIAL_DAYS}-day trial, no card needed. Billing is not switched on yet.</p>
        </section>

        <section
          aria-labelledby="compare-title"
          className="border-t-2 border-line-strong bg-sunken"
        >
          <div className={`${WRAP} flex flex-col gap-8 py-16 md:py-[88px]`}>
            <SectionHeader eyebrow="Compare" titleId="compare-title" title="Every feature, side by side" />
            <div
              role="region"
              aria-labelledby="compare-title"
              tabIndex={0}
              className="oa-table-box"
            >
              <table className="oa-table min-w-[560px] [&_tbody_tr:last-child>th]:border-b-0">
                <caption className="sr-only">Features included in each plan</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[40%]">
                      Feature
                    </th>
                    {PLANS.map((plan) => (
                      <th key={plan.id} scope="col">
                        {plan.name}
                        <span className="oa-value ml-2 text-ink-3">
                          {plan.price}
                          {plan.period === "Per month" ? "/mo" : ""}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                {COMPARISON.map((group) => (
                  <tbody key={group.label}>
                    <tr>
                      <th scope="rowgroup" colSpan={PLANS.length + 1} className="text-ink">
                        {group.label}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.feature}>
                        <th
                          scope="row"
                          className="border-b border-rule bg-transparent text-xs font-normal normal-case leading-[18px] tracking-normal text-ink"
                        >
                          {row.feature}
                        </th>
                        {PLANS.map((plan) => (
                          <td key={plan.id}>
                            <Cell value={row.values[plan.id]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        </section>

        <section id="startups" aria-labelledby="startups-title" className="scroll-mt-16 bg-ink text-page">
          <div className={`${WRAP} grid gap-10 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:py-[88px]`}>
            <div className="flex flex-col gap-3.5">
              <span className="oa-eyebrow">Startup program</span>
              <h2 id="startups-title" className="oa-h1 max-md:text-[30px] max-md:leading-[32px]">
                One-on-one help to get set up
              </h2>
              <p className="max-w-[460px] text-xs leading-[18px] opacity-75">{STARTUP_PROGRAM.eligibility}</p>
            </div>
            <div className="flex flex-col gap-6 border-2 border-page p-5 md:p-7">
              <h3 className="oa-label text-inherit opacity-70">What you get</h3>
              <ul className="flex flex-col text-[13px] leading-5">
                {STARTUP_PROGRAM.benefits.map((benefit) => (
                  <li key={benefit} className="flex gap-2.5 border-t-[1.5px] border-page/30 py-2.5 first:border-t-0 first:pt-0">
                    <span aria-hidden className="oa-value leading-5 opacity-60">
                      +
                    </span>
                    {benefit}
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="self-start max-sm:w-full">
                <a href={STARTUP_PROGRAM.apply.href} target="_blank" rel="noopener noreferrer">
                  {STARTUP_PROGRAM.apply.label}
                  <ArrowUpRight aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-title" className={`${WRAP} flex flex-col gap-8 py-16 md:py-[88px]`}>
          <SectionHeader eyebrow="Questions" titleId="faq-title" title="Pricing questions" />
          <Faq items={PRICING_FAQ} />
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
