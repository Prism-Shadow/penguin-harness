/**
 * List rows never push their actions out of their card.
 *
 * The component library's data board (`lib.html?topic=data`) holds a collapsible section of
 * memory rows, as Agent settings lists them: a long id, a description that runs far past any
 * card, a date and three icon actions, beside a short row. A line that truncates with `nowrap`
 * counts at its full length in a container's minimum width; once, one such row widened the
 * section's body past the card, so every row ran off its edge and the card clipped each row's
 * actions, the short rows' too.
 *
 * - Given each theme, both languages and the largest text size, at the board's width and with
 *   the section narrowed to 360, 280 and 220 px, every row and every action lies inside the
 *   card, every title and description either fits or is cut off by its own box, and the page
 *   never scrolls sideways.
 * - Given rows whose text is longer than any card, asked how narrow it can be, a row needs no
 *   more than its date and its actions: it never asks its container for its text's width.
 * - Given a description cut off at the row's end, hovering it shows the whole text.
 */
import { test, expect } from "@playwright/test";

const TITLE = { en: "User memory", zh: "用户记忆" };
const THEMES = ["modern", "geek", "github"];
const NARROWED = [360, 280, 220];

/** Opens the data board and returns the memory section. */
async function openSection(page, { theme, lang, size = "m", mode = "light" }) {
  await page.goto(`/lib.html?topic=data&theme=${theme}&mode=${mode}&lang=${lang}&size=${size}`);
  // The section is the card around its fold toggle (the board's own group is a section too).
  const section = page
    .getByRole("button", { name: new RegExp(TITLE[lang]) })
    .locator("xpath=ancestor::section[1]");
  await expect(section.locator("li")).toHaveCount(3);
  return section;
}

/**
 * What lies out of place in the section, in client pixels: a row or an action past the card's
 * inner box, a line drawn past its own box, the page wider than the window.
 */
const misplaced = (section) =>
  section.evaluate((card) => {
    const out = [];
    const box = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    const left = box.left + parseFloat(style.borderLeftWidth) - 0.5;
    const right = box.right - parseFloat(style.borderRightWidth) + 0.5;
    const outside = (el) => {
      const r = el.getBoundingClientRect();
      return r.left < left || r.right > right;
    };
    for (const [i, row] of [...card.querySelectorAll("li")].entries()) {
      if (outside(row)) out.push(`row ${i} runs past the card`);
      for (const action of row.querySelectorAll("button")) {
        if (outside(action)) out.push(`row ${i}: "${action.ariaLabel}" is clipped by the card`);
      }
      for (const line of row.querySelectorAll("*")) {
        const lineStyle = getComputedStyle(line);
        if (lineStyle.textOverflow !== "ellipsis") continue;
        if (outside(line)) out.push(`row ${i}: a line runs past the card`);
        const spills = line.scrollWidth > line.clientWidth + 1;
        if (spills && !["hidden", "clip"].includes(lineStyle.overflowX)) {
          out.push(`row ${i}: a line paints past its box`);
        }
      }
    }
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) out.push("the page scrolls sideways");
    return out;
  });

/** Every check at the board's width and narrowed, labelled by width. */
async function misplacedAtEveryWidth(section) {
  const found = (await misplaced(section)).map((m) => `board width: ${m}`);
  for (const width of NARROWED) {
    await section.evaluate((card, w) => (card.style.width = `${w}px`), width);
    found.push(...(await misplaced(section)).map((m) => `${width}px: ${m}`));
  }
  await section.evaluate((card) => (card.style.width = ""));
  return found;
}

test.describe("list rows with text longer than their card", () => {
  for (const theme of THEMES) {
    for (const lang of ["en", "zh"]) {
      test(`keep every action inside the card at every width (${theme}, ${lang})`, async ({
        page,
      }) => {
        const section = await openSection(page, { theme, lang });
        expect(await misplacedAtEveryWidth(section)).toEqual([]);
      });
    }
  }

  test("keep every action inside the card at the largest text size, in dark", async ({ page }) => {
    const section = await openSection(page, {
      theme: "github",
      lang: "zh",
      size: "xl",
      mode: "dark",
    });
    expect(await misplacedAtEveryWidth(section)).toEqual([]);
  });

  test("never ask their container for their text's width", async ({ page }) => {
    const section = await openSection(page, { theme: "github", lang: "en", size: "xl" });
    const rows = await section.locator("li").evaluateAll((items) =>
      items.map((row) => {
        const saved = row.style.width;
        row.style.width = "min-content";
        const narrowest = row.getBoundingClientRect().width;
        row.style.width = "max-content";
        const widest = row.getBoundingClientRect().width;
        row.style.width = saved;
        const trailing = row.lastElementChild.getBoundingClientRect().width;
        return { narrowest, widest, trailing };
      }),
    );
    for (const row of rows) {
      // Its text is longer than any card: laid out whole, the row is far wider than this.
      expect(row.widest).toBeGreaterThan(600);
      // Asked for its narrowest, it keeps only the date and the actions (plus its padding).
      expect(row.narrowest).toBeLessThanOrEqual(row.trailing + 48);
    }
  });

  test("show a cut-off description whole on hover", async ({ page }) => {
    const section = await openSection(page, { theme: "github", lang: "en" });
    const description = section.getByText(/^The local proxy listens/);
    const whole = (await description.textContent()).trim();
    expect(await description.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    // Any scroll closes a hint, so the scroll that brings the row into view lands first.
    await description.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await description.hover();
    await expect(page.getByTestId("tooltip")).toHaveText(whole);
  });
});
