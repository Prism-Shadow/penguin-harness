/**
 * A Benchmark card's title is never cut short by the id beside it.
 *
 * The Evaluation Center's cards show each Benchmark's title with its id beside it, and the
 * built-in Benchmarks' ids (`penguinharness-benchmark-gdpevo-essential-…`) run longer than the
 * room their titles leave. The landing page frames this list at 1280 px.
 *
 * - Given the list at 1280 and 800 px, in both languages, a title is cut off only when it is too
 *   long for the row by itself, never to make room for its id, and an id stays inside its card's
 *   info column, cut off where the room runs out.
 * - Given an id cut off, hovering it shows the whole id.
 */
import { test, expect } from "@playwright/test";

const list = (lang) => `app.html?route=%2Fbenchmark&theme=modern&mode=light&lang=${lang}`;

/** Each card's title line: the title, then the id in monospace. */
const heads = (page) => page.locator("main button > span:first-child:has(> span.font-mono)");

/** How each card's title and id are laid out, in the app's own document. */
const measure = (page) =>
  heads(page).evaluateAll((all) =>
    all.map((head) => {
      const [title, id] = head.children;
      const info = head.closest("button").getBoundingClientRect();
      const idBox = id.getBoundingClientRect();
      return {
        title: title.textContent,
        titleCut: title.scrollWidth > title.clientWidth,
        idWidth: idBox.width,
        idCut: id.scrollWidth > id.clientWidth,
        idPastInfo: idBox.right > info.right + 0.5,
      };
    }),
  );

async function openList(page, lang, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(list(lang));
  // Attached, not visible: an id the title leaves no room for is drawn zero wide.
  await expect(
    page.locator("main button span.font-mono", { hasText: /^penguinharness-benchmark-/ }).first(),
  ).toBeAttached();
}

for (const lang of ["en", "zh"]) {
  for (const width of [1280, 800]) {
    test(`a long id gives way to the title (${lang}, ${width}px)`, async ({ page }) => {
      await openList(page, lang, width);
      const cards = await measure(page);
      expect(cards.filter((card) => card.titleCut && card.idWidth > 0).map((c) => c.title)).toEqual(
        [],
      );
      expect(cards.filter((card) => card.idPastInfo).map((c) => c.title)).toEqual([]);
      // The case at hand: some id is longer than the room its title leaves.
      expect(cards.some((card) => card.idCut)).toBe(true);
    });
  }
}

test("show a cut-off id whole on hover", async ({ page }) => {
  await openList(page, "en", 1280);
  const index = (await measure(page)).findIndex((card) => card.idCut);
  const id = heads(page).nth(index).locator("> span.font-mono");
  const whole = (await id.textContent()).trim();
  // Any scroll closes a hint, so the scroll that brings the card into view lands first.
  await id.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await id.hover();
  await expect(page.getByTestId("tooltip")).toHaveText(whole);
});
