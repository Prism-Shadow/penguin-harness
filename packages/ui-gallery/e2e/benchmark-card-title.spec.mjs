/**
 * A Benchmark card's title is never cut short while its card has room for it.
 *
 * The Self-Evolution Workbench (the pinned package's page, in the App Center's window frame)
 * lists each Benchmark as a card whose info column leads with the title, and the seeded
 * Benchmarks' titles (`GDPEVO Essential-Engineering Portfolio Analytics-Test`, …) run long. The
 * landing page frames this list at 1280 px.
 *
 * - Given the list at 1280 and 800 px, in both languages, a title is cut off only when it is too
 *   long for its info column by itself, and it stays inside that column, cut off where the room
 *   runs out.
 */
import { test, expect } from "@playwright/test";

const route = encodeURIComponent("/apps?app=default_agent%2Fbenchmark");
const list = (lang) => `app.html?route=${route}&theme=modern&mode=light&lang=${lang}`;

/** The workbench's page, in the window's frame. */
const workbench = (page) =>
  page.locator('iframe[src*="/workbenches/benchmark/ui/"]:visible').contentFrame();

/** How each card's title is laid out against its info column, in the page's own document. */
const measure = (page) =>
  workbench(page)
    .locator("li > button:first-child span.truncate.font-bold")
    .evaluateAll((titles) =>
      titles.map((title) => {
        const info = title.closest("button");
        const style = getComputedStyle(info);
        const room =
          info.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return {
          title: title.textContent,
          cut: title.scrollWidth > title.clientWidth,
          tooLong: title.scrollWidth > room + 0.5,
          pastInfo: title.getBoundingClientRect().right > info.getBoundingClientRect().right + 0.5,
        };
      }),
    );

for (const lang of ["en", "zh"]) {
  for (const width of [1280, 800]) {
    test(`a title gives way only to its own length (${lang}, ${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(list(lang));
      await expect(
        workbench(page).locator("li > button:first-child", { hasText: "GDPEVO Essential" }).first(),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const cards = await measure(page);
      expect(cards.length).toBeGreaterThan(10);
      expect(cards.filter((card) => card.cut && !card.tooLong).map((c) => c.title)).toEqual([]);
      expect(cards.filter((card) => card.pastInfo).map((c) => c.title)).toEqual([]);
    });
  }
}
