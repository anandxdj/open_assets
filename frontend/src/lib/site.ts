import type { MetadataRoute } from "next";

/**
 * Public identity of the site, shared by metadata, robots, sitemap, the web
 * manifest and the generated icons / social images.
 */

export const SITE_NAME = "OpenAssets";
export const SITE_TAGLINE = "Every asset, cut clean";
export const SITE_TITLE = `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`;
export const SITE_DESCRIPTION =
  "Drop one sprite sheet, icon grid or UI mockup. OpenAssets finds every asset, names it and hands you a ZIP of transparent PNGs.";

/** Brand colours the generated icons, social image and manifest share (see DESIGN.md). */
export const BRAND = {
  ink: "#0A0A0A",
  paper: "#F4F3EE",
  orange: "#FF7C00",
} as const;

/**
 * Used when NEXT_PUBLIC_SITE_URL is not set in a production build. It is the
 * host this repository already deploys to (see docker-compose.yml). Set the env
 * var for any other domain so canonical URLs, the sitemap and social images
 * point at the right place.
 */
const PRODUCTION_FALLBACK = "https://openassets.anands.dev";
const DEVELOPMENT_FALLBACK = "http://localhost:3000";

/** Parses a configured site URL down to its origin, or returns null if unusable. */
export function parseSiteUrl(value: string | undefined): URL | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

/**
 * Absolute origin of the deployed site, from NEXT_PUBLIC_SITE_URL. It is read at
 * build time (robots, sitemap and social images are generated then), so pass it
 * as a build argument when building the Docker image.
 */
export const SITE_URL: URL =
  parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
  new URL(process.env.NODE_ENV === "production" ? PRODUCTION_FALLBACK : DEVELOPMENT_FALLBACK);

/** Absolute URL for a path on this site, e.g. siteUrl("/pricing"). */
export function siteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * Public, indexable routes, in sitemap order. Everything behind sign-in
 * (upload, history, editor, enhance, studio, dashboard) and the auth flow pages
 * stay out of here and are disallowed in robots.ts.
 */
export const PUBLIC_ROUTES: {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/collections", changeFrequency: "daily", priority: 0.7 },
  { path: "/careers", changeFrequency: "monthly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
];

/** Path prefixes that need an account or are part of a sign-in flow. */
export const PRIVATE_PATHS = [
  "/api/",
  "/upload",
  "/history",
  "/settings",
  "/admin",
  "/editor/",
  "/enhance",
  "/studio",
  "/anibuddy",
  "/dashboard",
  "/callback",
  "/team/",
  "/extension/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password/",
  "/verify-email/",
] as const;
