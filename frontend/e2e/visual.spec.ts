import { expect, test, type Page } from "@playwright/test";
import { ROUTES, STATE_ROUTES, type RouteSpec } from "./routes";
import { storageStatePath } from "./fixtures";
import { THEMES, WIDTHS, prepare, scrollSectionIntoView, settle, type Theme, type Width } from "./support";

/**
 * Viewport screenshots (not full page, to keep baselines small) of the key
 * routes in both themes at desktop and phone width. Dates, counts that move
 * with the clock and ids are masked. Update baselines with `pnpm e2e:update`.
 */

/** Text that changes between runs: relative and absolute dates, ids, "n days left". */
function dynamicText(page: Page) {
  return [
    page.locator("time, [datetime]"),
    page.getByText(/\b\d+\s+(second|minute|hour|day|week|month|year)s?\s+(ago|left|remaining)\b/i),
    page.getByText(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(,\s+\d{4})?\b/),
    page.getByText(/\b\d{4}-\d{2}-\d{2}\b/),
    page.getByText(/\b[a-f0-9]{24}\b/),
    page.locator("[data-e2e-mask]"),
  ];
}

function nameFor(route: RouteSpec, theme: Theme, width: Width) {
  return `${route.id}-${theme}-${width}.png`;
}

// Routes in the screenshot set. A route can opt out with `visual: false` when its baselines would not be worth their size.
const SHOT = ROUTES.filter((r) => r.visual !== false);

for (const route of SHOT) {
  test.describe(route.id, () => {
    test.use({ storageState: storageStatePath(route.persona) ?? { cookies: [], origins: [] } });
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        test(`${theme} ${width}`, async ({ page }) => {
          await prepare(page, theme, width);
          await page.goto(route.path);
          await settle(page, theme);
          if (route.scrollTo) await scrollSectionIntoView(page, route.scrollTo);
          await expect(page).toHaveScreenshot(nameFor(route, theme, width), { mask: dynamicText(page) });
        });
      }
    }
  });
}

/** A few plan-state screens whose look (not just their markup) depends on the plan. Light, desktop only. */
const STATE_SHOTS = new Set(["settings-free", "settings-trial", "settings-lapsed", "settings-member", "collections-member", "pack-team-readonly", "community-tag", "community-tag-empty"]);
for (const route of STATE_ROUTES.filter((r) => STATE_SHOTS.has(r.id))) {
  test.describe(`state ${route.id}`, () => {
    test.use({ storageState: storageStatePath(route.persona) ?? { cookies: [], origins: [] } });
    test("light 1280", async ({ page }) => {
      await prepare(page, "light", 1280);
      await page.goto(route.path);
      await settle(page, "light");
      if (route.scrollTo) await scrollSectionIntoView(page, route.scrollTo);
      await expect(page).toHaveScreenshot(nameFor(route, "light", 1280), { mask: dynamicText(page) });
    });
  });
}
