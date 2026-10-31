import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ROUTES, STATE_ROUTES } from "./routes";
import { storageStatePath } from "./fixtures";
import { THEMES, WIDTHS, prepare, settle } from "./support";

/**
 * axe-core on every key route, in both themes at both widths, as the plan
 * states that change what a screen says and locks. Serious and critical
 * violations fail the test; minor and moderate ones are printed in the report
 * as an annotation so they stay visible without blocking.
 *
 * No rule is switched off. Anything excluded below is a documented false
 * positive, with the reason next to it.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

for (const route of [...ROUTES, ...STATE_ROUTES]) {
  test.describe(`axe ${route.id}`, () => {
    test.use({ storageState: storageStatePath(route.persona) ?? { cookies: [], origins: [] } });
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        test(`${theme} ${width}`, async ({ page }, info) => {
          await prepare(page, theme, width);
          await page.goto(route.path);
          await settle(page, theme);

          const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          for (const v of violations.filter((x) => !blocking.includes(x))) {
            info.annotations.push({ type: `axe ${v.impact}`, description: `${v.id}: ${v.help} (${v.nodes.length})` });
          }
          expect(
            blocking.map((v) => ({
              rule: v.id,
              impact: v.impact,
              help: v.help,
              nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(1, 3).join(" ") })),
            })),
            `${route.id} ${theme} ${width}: serious or critical accessibility violations`,
          ).toEqual([]);
        });
      }
    }
  });
}
