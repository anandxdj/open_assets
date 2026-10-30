/**
 * The docs set: its pages and the sections of each. The sidebar, the page
 * headings and the sitemap all read from here, and a page has to supply a body
 * for every section listed (see DocsPage), so the navigation cannot drift from
 * the content.
 */
import { DOCS_URL } from "./site";

export type DocsSection = { readonly id: string; readonly title: string };

export const DOCS_PAGES = {
  overview: {
    href: DOCS_URL,
    label: "Overview",
    eyebrow: "Docs",
    title: "OpenAssets docs",
    sections: [
      { id: "what", title: "What OpenAssets does" },
      { id: "how", title: "How an extraction works" },
      { id: "ways-in", title: "Three ways to use it" },
      { id: "plans", title: "Plans and limits" },
      { id: "next", title: "Where to go next" },
    ],
  },
  "getting-started": {
    href: `${DOCS_URL}/getting-started`,
    label: "Getting started",
    eyebrow: "Docs",
    title: "Getting started",
    sections: [
      { id: "account", title: "Before you start" },
      { id: "web-app", title: "Extract with the web app" },
      { id: "extension", title: "Extract with the Chrome extension" },
      { id: "limits", title: "Limits to know about" },
    ],
  },
  api: {
    href: `${DOCS_URL}/api`,
    label: "API reference",
    eyebrow: "Docs",
    title: "API reference",
    sections: [
      { id: "overview", title: "Overview" },
      { id: "auth", title: "Authentication" },
      { id: "quickstart", title: "Quickstart" },
      { id: "responses", title: "Responses" },
      { id: "lifecycle", title: "Job lifecycle" },
      { id: "me", title: "GET /me" },
      { id: "upload", title: "POST /jobs" },
      { id: "list", title: "GET /jobs" },
      { id: "get-job", title: "GET /jobs/{jobId}" },
      { id: "crop", title: "POST /jobs/{jobId}/crop" },
      { id: "export", title: "POST /jobs/{jobId}/export" },
      { id: "download", title: "GET /jobs/{jobId}/download" },
      { id: "rate-limits", title: "Rate limits" },
      { id: "errors", title: "Errors" },
      { id: "plan-limits", title: "Plan limits" },
    ],
  },
} as const satisfies Record<string, { href: string; label: string; eyebrow: string; title: string; sections: readonly DocsSection[] }>;

export type DocsPageId = keyof typeof DOCS_PAGES;
export type DocsSectionId<P extends DocsPageId> = (typeof DOCS_PAGES)[P]["sections"][number]["id"];

/** Reading order, for the previous and next links. */
export const DOCS_ORDER: readonly DocsPageId[] = ["overview", "getting-started", "api"];

/**
 * The public API's rate limits. Mirrors V1_LIMITS in
 * backend/src/modules/publicapi/v1.limits.ts (the API also reports them from
 * GET /api/v1/me): change both together.
 */
export const API_LIMITS = {
  requestsPerMinute: 120,
  startsPer15Minutes: 60,
  failedAuthPer15Minutes: 100,
} as const;

/** The API origin of this deployment, as the web app itself calls it. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
