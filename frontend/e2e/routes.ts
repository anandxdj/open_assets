import { E2E_INVITE_TOKEN, PUBLIC_PACK_ID, READ_ONLY_TEAM_PACK_ID, TEAM_PACK_ID, jobId, type Persona } from "./fixtures";

export interface RouteSpec {
  /** Part of every test and baseline name. */
  id: string;
  path: string;
  /** Who is signed in. Public pages are shot signed out, app pages as the plan state that shows the most. */
  persona: Persona;
  /** False drops the route from the screenshot set (it stays in the axe set) to keep the baselines small. */
  visual?: boolean;
  /** Selector of a section to scroll to the top of the viewport before the screenshot (long pages such as Settings). */
  scrollTo?: string;
}

/**
 * The key routes. Each is checked in light and dark at 1280 and 375 wide.
 * Personas are the seeded accounts (backend/scripts/e2e/fixtures.ts):
 *  - free shows the locks, the usage meter and the trial prompt;
 *  - pro shows what Pro unlocks, a team with an invite, and collections of every kind;
 *  - admin is the only one who can open /admin.
 */
export const ROUTES: RouteSpec[] = [
  { id: "landing", path: "/", persona: "anon" },
  { id: "pricing", path: "/pricing", persona: "anon" },
  { id: "signin", path: "/login", persona: "anon" },
  { id: "docs", path: "/docs", persona: "anon" },
  { id: "team-invite", path: `/team/invite/${E2E_INVITE_TOKEN}`, persona: "anon" },
  { id: "extract", path: "/upload", persona: "free" },
  { id: "history", path: "/history", persona: "pro" },
  { id: "editor", path: `/editor/${jobId("free", "detected")}`, persona: "free" },
  { id: "export", path: `/editor/${jobId("pro", "cropped")}/export`, persona: "pro" },
  { id: "collections", path: "/dashboard/collections", persona: "pro" },
  { id: "community", path: "/collections", persona: "free" },
  { id: "pack", path: `/collections/${PUBLIC_PACK_ID}`, persona: "free" },
  { id: "settings", path: "/settings", persona: "pro", scrollTo: "#team" },
  { id: "admin", path: "/admin", persona: "admin" },
  { id: "enhance", path: "/enhance", persona: "free" },
  { id: "cleanup", path: "/enhance/excalibur", persona: "free" },
  { id: "ai-enhance", path: "/enhance/ai", persona: "free" },
  { id: "studio", path: "/studio", persona: "free" },
  { id: "anibuddy", path: "/anibuddy", persona: "free" },
];

/**
 * The same screens as other plan states. Plan state changes what is locked,
 * what is said and what can be edited, so these are checked for accessibility
 * (and a few for looks, see visual.spec.ts) in addition to the main set.
 */
export const STATE_ROUTES: RouteSpec[] = [
  { id: "settings-free", path: "/settings", persona: "free", scrollTo: "#plan" },
  { id: "settings-trial", path: "/settings", persona: "trial", scrollTo: "#plan" },
  { id: "settings-lapsed", path: "/settings", persona: "lapsed", scrollTo: "#plan" },
  { id: "settings-member", path: "/settings", persona: "member", scrollTo: "#team" },
  { id: "editor-pro", path: `/editor/${jobId("pro", "detected")}`, persona: "pro" },
  { id: "export-free", path: `/editor/${jobId("free", "cropped")}/export`, persona: "free" },
  { id: "export-ready", path: `/editor/${jobId("pro", "ready")}/export`, persona: "pro" },
  { id: "collections-member", path: "/dashboard/collections", persona: "member" },
  { id: "collections-free", path: "/dashboard/collections", persona: "free" },
  { id: "pack-team-owner", path: `/collections/${TEAM_PACK_ID}`, persona: "pro" },
  { id: "pack-team-readonly", path: `/collections/${READ_ONLY_TEAM_PACK_ID}`, persona: "member" },
  { id: "extract-pro", path: "/upload", persona: "pro" },
  { id: "extract-lapsed", path: "/upload", persona: "lapsed" },
];
