import { expect, test, type Page } from "@playwright/test";
import { jobId, storageStatePath } from "./fixtures";
import { prepare, settle } from "./support";

/**
 * Keyboard-only walkthroughs of the core flows (WCAG 2.1.1, 2.4.1, 2.4.3, 2.4.7,
 * 3.3.1): nothing here touches the mouse. They check behaviour, not looks, so
 * they have no screenshots.
 */

// 1×1 PNG: enough for the upload's file type check; the server is never asked to detect it.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    return el.getAttribute("aria-label") || (el as HTMLElement).innerText?.trim() || el.tagName;
  });

test.describe("skip link", () => {
  test.use({ storageState: storageStatePath("free") });

  test("is the first tab stop, shows on focus and moves focus to the page's main", async ({ page }) => {
    await prepare(page, "light", 1280);
    await page.goto("/upload");
    await settle(page, "light");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main").first()).toBeFocused();
    // The next Tab lands inside the content, not back in the sidebar.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
  });
});

test.describe("editor", () => {
  test.use({ storageState: storageStatePath("pro") });

  test("select, move, resize, add, duplicate, undo, zoom and delete from the keyboard", async ({ page }) => {
    await prepare(page, "light", 1280);
    await page.goto(`/editor/${jobId("pro", "detected")}`);
    await settle(page, "light");
    const rows = page.locator("aside[aria-label=Detections] li");
    await expect(rows).toHaveCount(8);

    const field = (label: string) => page.getByLabel(label, { exact: true });
    const live = page.locator("p[role=status].sr-only").first();

    // Select the first box from the list.
    await rows.first().getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 selected")).toBeVisible();
    const x0 = Number(await field("X position").inputValue());
    const w0 = Number(await field("Width").inputValue());
    const h0 = Number(await field("Height").inputValue());

    // Arrow keys move, Shift moves 10.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(field("X position")).toHaveValue(String(x0 + 11));
    await expect(live).toContainText("Moved to");

    // Alt+Arrow resizes: right and down grow, left and up shrink.
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Shift+Alt+ArrowDown");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(field("Width")).toHaveValue(String(w0 + 1));
    await expect(field("Height")).toHaveValue(String(h0 + 9));
    await expect(live).toContainText("Resized to");

    // Undo walks back one step at a time.
    await page.keyboard.press("Control+z");
    await expect(field("Height")).toHaveValue(String(h0 + 10));

    // N adds a box in the middle of the view and selects it; Ctrl+D copies the selection.
    await page.keyboard.press("n");
    await expect(rows).toHaveCount(9);
    await expect(live).toContainText("Added a");
    await page.keyboard.press("Control+d");
    await expect(rows).toHaveCount(10);
    await expect(live).toContainText("Duplicated 1 box");

    // + and - zoom, and say so.
    const zoomBefore = await page.getByRole("button", { name: /^Zoom \d+%/ }).innerText();
    await page.keyboard.press("+");
    await expect(page.getByRole("button", { name: /^Zoom \d+%/ })).not.toHaveText(zoomBefore);
    await expect(live).toContainText("Zoom");

    // Deleting the selected, focused row leaves focus in the list, not on <body>.
    await rows.nth(2).getByRole("button").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");
    await expect(rows).toHaveCount(9);
    expect(await focusedName(page)).not.toBe("BODY");
    expect(await page.evaluate(() => !!document.activeElement?.closest("aside[aria-label=Detections]"))).toBe(true);
  });

  test("the canvas takes focus and arrow keys pan it when nothing is selected", async ({ page }) => {
    await prepare(page, "light", 1280);
    await page.goto(`/editor/${jobId("pro", "detected")}`);
    await settle(page, "light");
    const canvas = page.getByRole("main", { name: "Canvas" });
    await canvas.focus();
    await expect(canvas).toBeFocused();
    const before = await canvas.evaluate((el) => (el as HTMLElement).style.backgroundPosition);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => canvas.evaluate((el) => (el as HTMLElement).style.backgroundPosition)).not.toBe(before);
  });

  test("the shortcuts dialog traps focus, closes on Escape and returns focus to its button", async ({ page }) => {
    await prepare(page, "light", 1280);
    await page.goto(`/editor/${jobId("pro", "detected")}`);
    await settle(page, "light");
    const trigger = page.getByRole("button", { name: /Keyboard shortcuts/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    // Every key the editor answers to is listed, including the keyboard equivalents of the mouse.
    for (const text of ["Add a box without the mouse", "Resize 1 px", "Duplicate a box", "Pan with the keyboard"]) {
      await expect(dialog).toContainText(text);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("upload cancel", () => {
  test.use({ storageState: storageStatePath("pro") });

  test("Cancel during the upload aborts the request, makes no job, shows no error and focuses Choose file", async ({ page }) => {
    await prepare(page, "light", 1280);
    let posts = 0;
    let reachedServer = 0;
    // Hold the request open so there is something to cancel; count what reaches the server.
    await page.route("**/api/upload", async (route) => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        reachedServer += 1;
        await route.continue();
      } catch {
        reachedServer -= 1; // the browser had already dropped it
      }
    });
    const failed = page.waitForEvent("requestfailed", (r) => r.url().endsWith("/api/upload"));
    await page.goto("/upload");
    await settle(page, "light");
    const choose = page.getByRole("button", { name: "Choose file" });
    await choose.focus();
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles({ name: "sheet.png", mimeType: "image/png", buffer: TINY_PNG });

    const panel = page.getByRole("group", { name: "Upload progress" });
    await expect(panel).toBeVisible();
    // Focus moved to Cancel, so one key stops it.
    await expect(page.getByRole("button", { name: /^Cancel/ })).toBeFocused();
    await page.keyboard.press("Enter");

    await failed; // the request was aborted in the browser
    await expect(panel).toBeHidden();
    await expect(choose).toBeFocused();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await expect(page.locator("main [role=alert]")).toHaveCount(0);
    await expect(page.getByText("Upload cancelled", { exact: false })).toBeAttached();
    expect(posts).toBe(1);
    expect(reachedServer).toBe(0);
    expect(page.url()).toContain("/upload");

    // A new upload starts right away.
    await page.unroute("**/api/upload");
    let second = 0;
    await page.route("**/api/upload", (route) => {
      second += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) });
    });
    await choose.focus();
    const chooser2 = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser2).setFiles({ name: "sheet.png", mimeType: "image/png", buffer: TINY_PNG });
    await expect.poll(() => second).toBe(1);
    // A real failure, unlike a cancel, is an error the user is told about, and nothing keeps spinning.
    await expect(page.locator("main [role=alert]")).toContainText("Upload failed");
    await expect(panel).toBeHidden();
    await expect(choose).toBeFocused();
  });
});
