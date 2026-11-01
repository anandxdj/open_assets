import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingFooter } from "./MarketingFooter";
import { MarketingHeader } from "./MarketingHeader";
import { CARD_GAP, DISPLAY, NARROW } from "./site";

/**
 * Full public page for a dead end (not found, unexpected error): the marketing
 * header and footer around one headline, one sentence and the way back.
 */
export function StatusPage({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <MarketingHeader />
      <main className="flex-1">
        <section aria-labelledby="status-title" className={`${NARROW} flex flex-col gap-12 py-16 md:gap-14 md:py-24`}>
          <div className="flex flex-col gap-6">
            <span className="oa-eyebrow">{eyebrow}</span>
            <h1 id="status-title" className={DISPLAY}>
              {title}
            </h1>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
            <div className="flex max-w-[560px] flex-col gap-3">{description}</div>
            <div className="flex flex-wrap gap-3.5 max-sm:w-full max-sm:flex-col">{actions}</div>
          </div>
          {children}
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

/** Grid of links under a status headline, in the same ruled-cell style as the spec rows. */
export function StatusLinks({
  label,
  links,
}: {
  label: string;
  links: { label: string; hint: string; href: string; external?: boolean }[];
}) {
  const cell =
    "flex h-full flex-col gap-1.5 border border-line-soft bg-surface px-6 py-5 hover:bg-inverse hover:text-inverse-fg focus-visible:outline-offset-[-4px]";
  return (
    <nav aria-label={label} className="flex flex-col gap-3">
      <h2 className="oa-label text-ink-3">{label}</h2>
      <ul className={`grid ${CARD_GAP} sm:grid-cols-2 lg:grid-cols-4`}>
        {links.map((link) => {
          const content = (
            <>
              <span className="text-xs font-bold uppercase leading-[18px] tracking-[0.04em]">
                {link.label}
                {link.external && <span className="sr-only"> (opens in a new tab)</span>}
              </span>
              <span className="text-xs leading-[18px] opacity-75">{link.hint}</span>
            </>
          );
          return (
            <li key={link.href} className="contents">
              {link.external ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer" className={cell}>
                  {content}
                </a>
              ) : (
                <Link href={link.href} className={cell}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
