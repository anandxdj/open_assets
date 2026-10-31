/** Shared constants for the public marketing pages (landing, pricing, careers). */

/** Page-width container used by every marketing section. */
export const WRAP = "mx-auto w-full max-w-[1200px] px-4 md:px-8";

/** Section headings use the h1 scale on desktop and step down on phones. */
export const SECTION_TITLE = "oa-h1 max-md:text-[30px] max-md:leading-[32px]";

/** The docs live in this app: overview, getting started and the API reference (see docs.config.ts). */
export const DOCS_URL = "/docs";

export const SALES_EMAIL = "sales@openassets.dev";

export const SOCIAL = {
  github: "https://github.com/anandxdj",
  linkedin: "https://www.linkedin.com/in/anandxdj",
  x: "https://x.com/anandxdj",
} as const;

export type MarketingLink = {
  label: string;
  href: string;
  external?: boolean;
};

/** Primary header navigation. */
export const NAV_LINKS: MarketingLink[] = [
  { label: "Product", href: "/#how" },
  { label: "Tools", href: "/#tools" },
  { label: "Gallery", href: "/#gallery" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: DOCS_URL },
];

/** Contact for account, support and billing questions (also shown on the auth pages). */
export const SUPPORT_EMAIL = "support@openassets.dev";

/** TO CONFIRM: the owner must create this mailbox (or change the address) before launch. */
export const PRIVACY_EMAIL = "privacy@openassets.dev";

/**
 * The Terms and Privacy pages are drafts until the owner and legal counsel
 * sign them off. Bump the date whenever either text changes.
 */
export const LEGAL_UPDATED = { iso: "2026-10-31", label: "31 October 2026" } as const;

/** Legal pages linked from the footer and the register form. */
export const LEGAL_LINKS: MarketingLink[] = [
  { label: "Terms of service", href: "/terms" },
  { label: "Privacy policy", href: "/privacy" },
];
