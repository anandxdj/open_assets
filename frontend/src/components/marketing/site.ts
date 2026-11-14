/** Shared constants for the public marketing pages (landing, pricing, careers). */

/** Page-width container for full-width grids. 20px gutter on phones, 32px from md. */
export const WRAP = "mx-auto w-full max-w-[1200px] px-5 md:px-8";

/** Narrower container for text-led sections (gallery, pricing, FAQ, legal). */
export const NARROW = "mx-auto w-full max-w-[1040px] px-5 md:px-8";

/** Vertical padding of every marketing section: 80px on phones, 112px from md. */
export const SECTION_Y = "py-20 md:py-28";

/** Gap between a section header and its content: 48px on phones, 64px from md. */
export const SECTION_GAP = "gap-12 md:gap-16";

/** Gap between separate cards in a grid. */
export const CARD_GAP = "gap-5 md:gap-6";

/**
 * A separate card on a marketing page: white surface, soft line. Controls and
 * the selected or raised object keep the 1.5px ink line instead.
 */
export const CARD = "border border-line-soft bg-surface";

/** Page title (h1) on marketing pages: 36px on phones up to 76px, tight but not stacked. */
export const DISPLAY = "oa-display text-[clamp(36px,5.6vw,76px)]";

/** Section headings use 36/40 on desktop and step down to 30/32 on phones. */
export const SECTION_TITLE = "oa-h1 text-[30px] leading-[32px] md:text-[36px] md:leading-[40px]";

/** Small marketing copy: 13/21 (1.6). */
export const COPY = "text-[13px] leading-[21px]";

/** The docs live in this app: overview, getting started and the API reference (see docs.config.ts). */
export const DOCS_URL = "/docs";

/**
 * Where "Chrome extension" points, on the marketing site and in the app shell:
 * the extension section of the landing page. There is no store listing yet.
 * When one exists, change this to its URL and mark the links `external` (the
 * app shell and the footer already open external links in a new tab for that).
 */
export const EXTENSION_HREF = "/#extension";

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
