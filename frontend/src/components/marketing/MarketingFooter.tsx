import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { DOCS_URL, EXTENSION_HREF, LEGAL_LINKS, SALES_EMAIL, SOCIAL, SUPPORT_EMAIL, WRAP, type MarketingLink } from "./site";

const COLUMNS: { title: string; links: MarketingLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Pricing", href: "/pricing" },
      { label: "Extension", href: EXTENSION_HREF },
      { label: "Community", href: "/collections" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: DOCS_URL },
      { label: "Getting started", href: `${DOCS_URL}/getting-started` },
      { label: "API reference", href: `${DOCS_URL}/api` },
      { label: "Support", href: `mailto:${SUPPORT_EMAIL}` },
      { label: "Contact sales", href: `mailto:${SALES_EMAIL}` },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Careers", href: "/careers" },
      { label: "GitHub", href: SOCIAL.github, external: true },
      { label: "LinkedIn", href: SOCIAL.linkedin, external: true },
      { label: "X", href: SOCIAL.x, external: true },
    ],
  },
  { title: "Legal", links: LEGAL_LINKS },
];

const LINK =
  "oa-label inline-flex items-center gap-1 text-xs hover:text-ink hover:underline hover:decoration-[1.5px] hover:underline-offset-4";

function FooterLink({ link }: { link: MarketingLink }) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>
        {link.label}
        <ArrowUpRight aria-hidden className="size-3.5" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  if (link.href.startsWith("mailto:")) {
    return (
      <a href={link.href} className={LINK}>
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={LINK}>
      {link.label}
    </Link>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t-2 border-line-strong bg-page">
      <div className={`${WRAP} flex flex-wrap justify-between gap-10 py-12`}>
        <div className="flex max-w-[300px] flex-col gap-2.5">
          <Logo />
          <p className="text-xs leading-[18px] text-ink-2">AI asset extraction for game and UI artists.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-14 gap-y-8">
          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <h2 className="oa-label text-ink-3">{col.title}</h2>
              <ul className="flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-rule">
        <p className={`${WRAP} py-4 text-[11px] leading-4 text-ink-3`}>© {new Date().getFullYear()} OpenAssets</p>
      </div>
    </footer>
  );
}
