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
import { COPY, DISPLAY, NARROW, SECTION_GAP, SECTION_TITLE, SECTION_Y } from "@/components/marketing/site";
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
        <section aria-labelledby="pricing-title" className={`${NARROW} flex flex-col gap-12 pb-20 pt-16 md:gap-14 md:pb-28 md:pt-24`}>
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
            <div className="flex flex-col gap-6">
              <span className="oa-eyebrow">Pricing</span>
              <h1 id="pricing-title" className={DISPLAY}>
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
              <Link href="#startups" className="oa-link text-[13px]">
                Startup program: one-on-one onboarding
              </Link>
            </div>
          </div>

          <PricingTiers headingLevel="h2" />
          <p className={`${COPY} text-ink-2`}>Pro starts with a {TRIAL_DAYS}-day trial, no card needed. Billing is not switched on yet.</p>
        </section>

        <section
          aria-labelledby="compare-title"
          className="border-t border-line-soft bg-sunken"
        >
          <div className={`${NARROW} flex flex-col ${SECTION_GAP} ${SECTION_Y}`}>
            <SectionHeader eyebrow="Compare" titleId="compare-title" title="Every feature, side by side" />
            <div
              role="region"
              aria-labelledby="compare-title"
              tabIndex={0}
              className="oa-table-box border-line-soft"
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
                          className="border-b border-rule bg-transparent text-[13px] font-normal normal-case leading-[21px] tracking-normal text-ink"
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

        <section
          id="startups"
          aria-labelledby="startups-title"
          className="scroll-mt-16 bg-band text-band-fg [--oa-shadow-ink:var(--oa-band-fg)]"
        >
          <div className={`${NARROW} grid gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-16 ${SECTION_Y}`}>
            <div className="flex flex-col gap-4">
              <span className="oa-eyebrow">Startup program</span>
              <h2 id="startups-title" className={SECTION_TITLE}>
                One-on-one help to get set up
              </h2>
              <p className={`max-w-[460px] ${COPY} opacity-75`}>{STARTUP_PROGRAM.eligibility}</p>
            </div>
            <div className="flex flex-col gap-6 border border-band-fg/25 p-6 md:p-8">
              <h3 className="oa-label text-inherit opacity-70">What you get</h3>
              <ul className="flex flex-col text-[13px] leading-[21px]">
                {STARTUP_PROGRAM.benefits.map((benefit) => (
                  <li key={benefit} className="flex gap-2.5 border-t border-band-fg/20 py-3 first:border-t-0 first:pt-0">
                    <span aria-hidden className="oa-value leading-[21px] opacity-60">
                      +
                    </span>
                    {benefit}
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="self-start focus-visible:outline-band-fg max-sm:w-full">
                <a href={STARTUP_PROGRAM.apply.href} target="_blank" rel="noopener noreferrer">
                  {STARTUP_PROGRAM.apply.label}
                  <ArrowUpRight aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-title" className={`${NARROW} flex flex-col ${SECTION_GAP} ${SECTION_Y}`}>
          <SectionHeader eyebrow="Questions" titleId="faq-title" title="Pricing questions" />
          <Faq items={PRICING_FAQ} />
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
