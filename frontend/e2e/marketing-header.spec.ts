import { expect, test, type Page } from "@playwright/test";
import { storageStatePath } from "./fixtures";
import { THEMES, WIDTHS, prepare, settle } from "./support";

/**
 * The public pages' header while the session is restored and after. A signed-in
 * visitor sees "Open app" and the account menu, never "Sign in". The header's
 * controls keep their place: the browser remembers that it was signed in
 * (lib/session-hint.ts), so the right variant is on screen before the session
 * request returns and nothing jumps when it does.
 *
 * These tests do not use screenshots, so they carry no baselines.
 */
const PAGES = ["/", "/pricing", "/docs", "/docs/api", "/terms", "/privacy", "/careers"];

const toggle = (page: Page) => page.locator('header button[aria-label^="Switch to"]');

/** Holds the session request for a while, so the loading state can be measured. */
async function slowSessionRestore(page: Page) {
  await page.route("**/api/auth/refresh-token", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`marketing header, signed out, ${theme} ${width}`, () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      for (const path of PAGES) {
        test(path, async ({ page }) => {
          await prepare(page, theme, width);
          await slowSessionRestore(page);
          await page.goto(path, { waitUntil: "domcontentloaded" });
          const header = page.locator("header").first();
          await expect(header.getByRole("link", { name: "Get started" })).toBeVisible();
          await expect(header.getByRole("link", { name: "Open app" })).toHaveCount(0);
          const before = await toggle(page).boundingBox();
          await settle(page, theme);
          expect(await toggle(page).boundingBox(), "theme toggle moved when the session resolved").toEqual(before);
          await expect(header.getByRole("link", { name: "Get started" })).toBeVisible();
          await expect(header.getByRole("button", { name: /^Account menu/ })).toHaveCount(0);
          if (width >= 1024) await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
        });
      }
    });

    test.describe(`marketing header, signed in, ${theme} ${width}`, () => {
      test.use({ storageState: storageStatePath("free") });

      for (const path of PAGES) {
        test(path, async ({ page }) => {
          await prepare(page, theme, width);
          // First visit: the session comes back and the header shows the signed-in actions.
          await page.goto(path);
          await settle(page, theme);
          const header = page.locator("header").first();
          await expect(header.getByRole("link", { name: "Open app" })).toBeVisible();
          await expect(header.getByRole("button", { name: /^Account menu/ })).toBeVisible();
          await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
          await expect(header.getByRole("link", { name: "Get started" })).toHaveCount(0);
          const settled = await toggle(page).boundingBox();

          // Next visit: the hint is stored, so the header is right before the session request returns.
          await slowSessionRestore(page);
          await page.goto(path, { waitUntil: "domcontentloaded" });
          await expect(header.getByRole("link", { name: "Open app" })).toBeVisible();
          await expect(header.getByRole("link", { name: "Get started" })).toHaveCount(0);
          expect(await toggle(page).boundingBox(), "theme toggle moved while the session was restored").toEqual(settled);
          await settle(page, theme);
          expect(await toggle(page).boundingBox()).toEqual(settled);
        });
      }
    });
  }
}

test.describe("marketing header, mobile menu", () => {
  test.use({ storageState: storageStatePath("free") });

  test("lists the section links and no sign-in entry for a signed-in visitor", async ({ page }) => {
    await prepare(page, "light", 375);
    await page.goto("/pricing");
    await settle(page, "light");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Product", "Tools", "Gallery", "Pricing", "Docs"]);
  });
});
