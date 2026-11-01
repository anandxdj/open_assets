import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/feedback";
import { MarketingFooter } from "./MarketingFooter";
import { MarketingHeader } from "./MarketingHeader";
import { CARD, CARD_GAP, DISPLAY, LEGAL_UPDATED, NARROW, PRIVACY_EMAIL, SUPPORT_EMAIL } from "./site";

/* -------------------------------------------------------------------------- */
/* Inline pieces used by the Terms and Privacy copy                           */
/* -------------------------------------------------------------------------- */

/**
 * A fact the owner has to fill in or confirm before launch. Always bracketed
 * and tinted with the warning status colours, so it is easy to find in review
 * and impossible to miss on the page.
 */
export function Fill({ children }: { children: ReactNode }) {
  return (
    <mark className="bg-warning-soft px-1 font-bold text-warning">
      [{children}]
    </mark>
  );
}

/** Link to another page on the site. */
export function Internal({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="oa-link">
      {children}
    </Link>
  );
}

/** Link to a third-party site. Opens in a new tab and says so. */
export function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="oa-link inline-flex items-center gap-1">
      {children}
      <ArrowUpRight aria-hidden className="size-3.5 flex-none" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function Mail({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className="oa-link">
      {address}
    </a>
  );
}

export const SupportMail = () => <Mail address={SUPPORT_EMAIL} />;
export const PrivacyMail = () => <Mail address={PRIVACY_EMAIL} />;

/** Sub-heading inside a numbered section. */
export function Sub({ children }: { children: ReactNode }) {
  return <h3 className="oa-section pt-2">{children}</h3>;
}

/** Bulleted list with a "+" marker, matching the careers and pricing pages. */
export function Bullets({ children }: { children: ReactNode }) {
  return (
    <ul role="list" className="flex max-w-[70ch] flex-col gap-2">
      {children}
    </ul>
  );
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="oa-value leading-[22px] text-brand-text">
        +
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Numbered list for sequences, for example the steps of a pipeline. */
export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol role="list" className="flex max-w-[70ch] flex-col gap-2">
      {children}
    </ol>
  );
}

export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="oa-value w-4 flex-none leading-[22px] text-brand-text">
        {n}.
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * Compact data table. The first column is the row header. Cells wrap (the
 * default table style never wraps) and the box scrolls sideways on phones.
 */
export function LegalTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="oa-table-box">
      <table className="oa-table min-w-[680px] [&_td]:whitespace-normal [&_td]:align-top [&_td]:leading-[18px] [&_th]:whitespace-normal [&_tbody_tr:last-child>th]:border-b-0">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th
                    key={j}
                    scope="row"
                    className="w-[22%] border-b border-rule bg-transparent align-top text-xs font-bold normal-case leading-[18px] tracking-normal text-ink"
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={j}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page frame                                                                 */
/* -------------------------------------------------------------------------- */

export type LegalSectionData = {
  /** Anchor id, also used for the contents list. Keep it short and stable. */
  id: string;
  title: string;
  body: ReactNode;
};

/**
 * Marketing-layout frame for a long legal document: draft banner, status
 * facts, a contents list (sticky on desktop) and numbered sections. Sections
 * are data so the contents list can never drift from the headings.
 */
export function LegalPage({
  slug,
  title,
  intro,
  related,
  sections,
}: {
  slug: string;
  title: ReactNode;
  intro: ReactNode;
  related: { label: string; href: string };
  sections: LegalSectionData[];
}) {
  const titleId = `${slug}-title`;
  const tocId = `${slug}-toc`;

  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <MarketingHeader />
      <main className="flex-1">
        <section aria-labelledby={titleId} className={`${NARROW} flex flex-col gap-10 pb-14 pt-16 md:pb-16 md:pt-24`}>
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="oa-eyebrow">Legal</span>
              <Badge tone="warning">
                <TriangleAlert aria-hidden />
                Draft
              </Badge>
            </div>
            <h1 id={titleId} className={DISPLAY}>
              {title}
            </h1>
          </div>

          <p className="oa-lead max-w-[640px]">{intro}</p>

          <div role="note" aria-label="Draft status">
            <Notice tone="warning">
              <p className="oa-section">Draft for review</p>
              <p className="mt-1 max-w-[78ch]">
                This document is a draft. It has not been reviewed by the owner or by qualified legal counsel, it is not
                legal advice, it is not yet in force, and it may change before launch. Text in{" "}
                <Fill>brackets</Fill> is a fact the owner still has to fill in or confirm.
              </p>
            </Notice>
          </div>

          <dl className={`grid ${CARD_GAP} sm:grid-cols-2 lg:grid-cols-4`}>
            <div className={`flex flex-col gap-1.5 px-6 py-5 ${CARD}`}>
              <dt className="oa-label">Status</dt>
              <dd className="text-[13px] font-bold leading-[21px]">Draft, not in force</dd>
            </div>
            <div className={`flex flex-col gap-1.5 px-6 py-5 ${CARD}`}>
              <dt className="oa-label">Last updated</dt>
              <dd className="text-[13px] font-bold leading-[21px]">
                <time dateTime={LEGAL_UPDATED.iso}>{LEGAL_UPDATED.label}</time>
              </dd>
            </div>
            <div className={`flex flex-col gap-1.5 px-6 py-5 ${CARD}`}>
              <dt className="oa-label">Review</dt>
              <dd className="text-[13px] font-bold leading-[21px]">Owner and legal counsel, pending</dd>
            </div>
            <div className={`flex flex-col gap-1.5 px-6 py-5 ${CARD}`}>
              <dt className="oa-label">Read also</dt>
              <dd className="text-[13px] font-bold leading-[21px]">
                <Internal href={related.href}>{related.label}</Internal>
              </dd>
            </div>
          </dl>
        </section>

        <div className="border-t border-line-soft">
          <div className={`${NARROW} grid gap-12 py-16 md:py-20 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16`}>
            <nav
              aria-labelledby={tocId}
              className="lg:sticky lg:top-[84px] lg:max-h-[calc(100dvh-108px)] lg:self-start lg:overflow-y-auto"
            >
              <h2 id={tocId} className="oa-label mb-3 text-ink-3">
                Contents
              </h2>
              <ol className="flex flex-col border-t border-line-soft">
                {sections.map((section, i) => (
                  <li key={section.id} className="border-b border-line-soft">
                    <a
                      href={`#${section.id}`}
                      className="flex gap-2.5 py-2 text-xs leading-[18px] text-ink-2 hover:text-ink hover:underline hover:decoration-[1.5px] hover:underline-offset-4"
                    >
                      <span className="oa-value w-5 flex-none text-ink-3">{i + 1}.</span>
                      <span className="min-w-0">{section.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="flex min-w-0 flex-col">
              {sections.map((section, i) => (
                <section
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-title`}
                  className="scroll-mt-24 border-t border-line-soft py-10 first:border-t-0 first:pt-0"
                >
                  <h2 id={`${section.id}-title`} className="oa-h3 mb-5 flex gap-3">
                    <span className="text-brand-text">{i + 1}.</span>
                    <span className="min-w-0 break-words">{section.title}</span>
                  </h2>
                  <div className="flex flex-col gap-4 text-[13px] leading-[22px] [&_p]:max-w-[70ch]">{section.body}</div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
