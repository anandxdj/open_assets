import { expect, type Page } from "@playwright/test";
import { freshClientAddress } from "./env";

export type Theme = "light" | "dark";
export type Width = 1280 | 375;

export const THEMES: Theme[] = ["light", "dark"];
export const WIDTHS: Width[] = [1280, 375];
const HEIGHT: Record<Width, number> = { 1280: 800, 375: 812 };

/**
 * Puts the page in a theme the way the app reads it. The app's theme provider
 * (next-themes, class strategy) reads `localStorage.theme` before first paint
 * and only falls back to the system preference when nothing is stored, so the
 * stored value is the setting and `colorScheme` merely agrees with it (the
 * browser chrome, form controls and the `prefers-color-scheme` rules follow it).
 */
export async function prepare(page: Page, theme: Theme, width: Width): Promise<void> {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": freshClientAddress() });
  await page.setViewportSize({ width, height: HEIGHT[width] });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("theme", value);
    } catch {
      /* storage blocked: the colorScheme emulation still applies */
    }
  }, theme);
}

/** Waits until a route has drawn what it is going to draw, not just until the document loaded. */
export async function settle(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Session restore, plan and data requests show a status line until they finish.
  await expect(
    page.getByRole("status").filter({ hasText: /^\s*(loading|opening|checking|signing)/i }),
  ).toHaveCount(0);
  await expect(page.locator("html")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Lazy images below the fold never load until scrolled to, so only wait for the ones the browser is fetching.
    const pending = Array.from(document.images).filter((img) => !img.complete && img.loading !== "lazy");
    await Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 8000)),
    ]);
  });
  // Two frames, so layout effects that run after data arrives have painted.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}
