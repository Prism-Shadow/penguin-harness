/**
 * The market's cards and list, as only a real engine lays them out.
 *
 * The showcase board (`lib.html?topic=showcase`) holds four market cards as the Web App draws
 * them: a version chip and a bar of two text actions, Install or how many Agents have it, and
 * Quick start. Its icon switch at the top end moves every grid on the board between cards and
 * the list.
 *
 * - Given the cards layout, each bar action is one line of words: no action stacks a second line
 *   under its label.
 * - Given the list layout in a column wide enough for two rows, the market rows stand two
 *   abreast; each is one row: its actions sit on the title's row, beside the text and inside
 *   the row's box, each on one line, and the version chip is not shown.
 * - Given the same list in a narrow column, the rows fall back to one column.
 * - The switch is two icon buttons with no words, each named, the current one pressed.
 */
import { test, expect } from "@playwright/test";

const LIST = { en: "List view", zh: "列表视图" };
const CARDS = { en: "Card view", zh: "卡片视图" };

async function openBoard(page, lang) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/lib.html?topic=showcase&theme=modern&mode=light&lang=${lang}`);
  const grid = page.getByTestId("market-grid");
  await expect(grid.locator("article.showcase-card")).toHaveCount(4);
  return grid;
}

/** Each bar action's count of text lines: the distinct tops of its words' boxes. */
const barLines = (grid) =>
  grid.evaluate((g) =>
    [...g.querySelectorAll(".showcase-card-bar > button")].map((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
    }),
  );

/** Where each market row's parts lie, in client pixels. */
const rows = (grid) =>
  grid.evaluate((g) =>
    [...g.querySelectorAll("article.showcase-card")].map((card) => {
      const r = (el) => el.getBoundingClientRect();
      const body = r(card.querySelector(".showcase-card-body"));
      const bar = r(card.querySelector(".showcase-card-bar"));
      const box = r(card);
      return {
        name: card.getAttribute("data-plugin"),
        top: Math.round(box.top),
        left: Math.round(box.left),
        // The actions' middle against the text's: on one row they share it.
        offRow: Math.abs((bar.top + bar.bottom) / 2 - (body.top + body.bottom) / 2),
        beside: bar.left >= body.right - 0.5,
        inside: bar.top >= box.top - 0.5 && bar.bottom <= box.bottom + 0.5,
        chip: card.querySelector(".showcase-card-version")?.checkVisibility() ?? false,
      };
    }),
  );

for (const lang of ["en", "zh"]) {
  test(`market cards and rows keep their actions on one line (${lang})`, async ({ page }) => {
    const grid = await openBoard(page, lang);

    // The switch: two wordless icon buttons, each named; the cards one pressed.
    const cards = page.getByRole("button", { name: CARDS[lang], exact: true });
    const list = page.getByRole("button", { name: LIST[lang], exact: true });
    await expect(cards).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveAttribute("aria-pressed", "false");
    await expect(list).toHaveText("");

    // Cards: every action one line.
    expect(new Set(await barLines(grid))).toEqual(new Set([1]));

    // The list, in a column wide enough for two rows.
    await list.click();
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(grid).toHaveAttribute("data-layout", "list");
    await grid.evaluate((g) => (g.style.width = "900px"));
    const wide = await rows(grid);
    expect(new Set(wide.slice(0, 2).map((row) => row.top)).size, "two rows abreast").toBe(1);
    expect(wide[1].left).toBeGreaterThan(wide[0].left);
    for (const row of wide) {
      expect(row.offRow, `${row.name}: actions on the title's row`).toBeLessThan(3);
      expect(row.beside, `${row.name}: actions beside the text`).toBe(true);
      expect(row.inside, `${row.name}: actions inside the row`).toBe(true);
      expect(row.chip, `${row.name}: no version chip in the list`).toBe(false);
    }
    expect(new Set(await barLines(grid))).toEqual(new Set([1]));

    // A narrow column: one row a line.
    await grid.evaluate((g) => (g.style.width = "360px"));
    const narrow = await rows(grid);
    expect(new Set(narrow.map((row) => row.left)).size, "one column").toBe(1);
  });
}
