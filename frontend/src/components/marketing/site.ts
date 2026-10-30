/** Shared constants for the public marketing pages (landing, pricing, careers). */

/** Page-width container used by every marketing section. */
export const WRAP = "mx-auto w-full max-w-[1200px] px-4 md:px-8";

/** Section headings use the h1 scale on desktop and step down on phones. */
export const SECTION_TITLE = "oa-h1 max-md:text-[30px] max-md:leading-[32px]";

/**
 * There is no hosted docs site yet, so "Docs" points at the project README.
 * Replace with the docs URL once it exists.
 */
export const DOCS_URL = "https://github.com/anandxdj/open_assets#readme";

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
  { label: "Docs", href: DOCS_URL, external: true },
];
