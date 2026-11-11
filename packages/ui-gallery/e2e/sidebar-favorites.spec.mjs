/**
 * The sidebar's fixed block — New chat and the favourite entries — measured where only a browser
 * can: the framed app (`app.html`, development mode, the demo admin's nav) with its real layout.
 * The defaults favourite Agents, the App Center, Models and Plugins; Machines, the Cost Center and
 * the Evaluation Center sit in the fold at the top of the conversation list.
 *
 * - Given a window too short for the conversation list, when the list scrolls, New chat and the
 *   favourites do not move while the fold rides up with the list; when a folded entry's star is
 *   clicked, the entry joins the fixed block and is no longer inside the list that scrolls, and
 *   a second click sends it back.
 * - Given the list at its top, in each theme, every nav row stands exactly as far apart as the
 *   next, across the fixed block's boundary too: no extra gap under New chat or under the last
 *   favourite, and no line at the boundary.
 * - Given the list scrolled away from its top, in each theme, a hairline in the column's rule
 *   colour (the one above the account row) marks the boundary, and nothing moves for it: the
 *   fixed rows and the scroll area keep their boxes. Back at the top the line clears.
 * - Given a column too short for the fixed block and a useful scroll area both, the scroll area
 *   keeps room for rows (more than two of them) and the fixed block scrolls its own rows
 *   instead; nothing is pushed out of the column.
 */
import { test, expect } from "@playwright/test";

/** New chat is a button, a page entry a link; a name may carry an update note after the label. */
const NEW_CHAT = { role: "button", name: "New chat", exact: true };
const entry = (label) => ({ role: "link", name: new RegExp(`^${label}\\b`) });
const FIXED = [NEW_CHAT, entry("Agents"), entry("App Center"), entry("Models"), entry("Plugins")];
const FOLDED = [entry("Machines"), entry("Cost Center"), entry("Evaluation Center")];

/** Opens a conversation in the framed app at the given window size and returns the sidebar. */
async function openApp(page, { width = 1280, height = 800, theme = "modern" } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(`/app.html?route=/chat/s-hooks-index&theme=${theme}&mode=light&lang=en`);
  await page.waitForSelector("html[data-gallery-ready]");
  const sidebar = page.locator('aside[data-slot="nav"]');
  await expect(row(sidebar, FOLDED[2])).toBeVisible();
  return sidebar;
}

/** One nav row inside `scope`. */
const row = (scope, { role, name, exact = false }) => scope.getByRole(role, { name, exact });

/** The rows' boxes, top to bottom, in client pixels. */
const boxes = (sidebar, rows) => Promise.all(rows.map((r) => row(sidebar, r).boundingBox()));

/** The space between each row and the next. */
const gaps = (rows) => rows.slice(1).map((box, i) => box.y - (rows[i].y + rows[i].height));

test("the favourites hold still while the list scrolls, and a star moves an entry into them", async ({
  page,
}) => {
  const sidebar = await openApp(page, { height: 560 });
  const list = sidebar.locator('[data-find-region="sessions"]');
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 120)).toBe(true);

  const fixedBefore = await boxes(sidebar, FIXED);
  const foldedBefore = await boxes(sidebar, FOLDED);
  const scrolled = await list.evaluate((el) => {
    el.scrollTop = 120;
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect
    .poll(async () => (await row(sidebar, FOLDED[0]).boundingBox())?.y)
    .toBeCloseTo(foldedBefore[0].y - scrolled, 0);
  expect((await boxes(sidebar, FIXED)).map((box) => box.y)).toEqual(fixedBefore.map((b) => b.y));
  for (const r of FIXED) await expect(row(list, r)).toHaveCount(0);

  // Starring the Cost Center takes it out of the list that scrolls and into the fixed block.
  await list.evaluate((el) => (el.scrollTop = 0));
  const costCenter = row(sidebar, FOLDED[1]);
  await costCenter.hover();
  await costCenter.locator("xpath=..").getByRole("button", { name: "Add to favorites" }).click();
  await expect(row(list, FOLDED[1])).toHaveCount(0);
  const starred = row(sidebar, FOLDED[1]);
  await expect(starred.locator("xpath=..").getByRole("button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const pluginsBox = await row(sidebar, FIXED[3]).boundingBox();
  const starredBox = await starred.boundingBox();
  expect(starredBox.y).toBeGreaterThan(pluginsBox.y);
  await list.evaluate((el) => (el.scrollTop = 120));
  expect((await starred.boundingBox()).y).toBeCloseTo(starredBox.y, 0);

  // A second click sends it back into the fold.
  await starred.hover();
  await starred.locator("xpath=..").getByRole("button").click();
  await expect(row(list, FOLDED[1])).toHaveCount(1);
});

/**
 * The boundary's bottom border (the fixed block's), and the column's rule above the account row,
 * as computed colours and widths.
 */
const boundary = (sidebar) =>
  row(sidebar, NEW_CHAT).evaluate((newChat) => {
    const block = newChat.closest("nav");
    const rule = document.querySelector(
      'aside[data-slot="nav"] [data-find-region]',
    ).nextElementSibling;
    const edge = getComputedStyle(block);
    return {
      colour: edge.borderBottomColor,
      width: edge.borderBottomWidth,
      rule: getComputedStyle(rule).borderTopColor,
    };
  });

/** Whether a computed colour paints anything. */
const opaque = (css) => !/^rgba\([^)]*,\s*0\)$|^transparent$/.test(css);

for (const theme of ["github", "modern", "geek"]) {
  test(`every nav row stands evenly at rest, and a hairline marks the boundary once scrolled (${theme})`, async ({
    page,
  }) => {
    const sidebar = await openApp(page, { theme });
    const list = sidebar.locator('[data-find-region="sessions"]');
    const all = [...FIXED, ...FOLDED];
    const rest = await boxes(sidebar, all);
    const spacing = gaps(rest);
    for (const gap of spacing) expect(gap).toBeCloseTo(spacing[1], 1);
    expect(opaque((await boundary(sidebar)).colour)).toBe(false);

    const listBox = await list.boundingBox();
    await list.evaluate((el) => (el.scrollTop = 40));
    // The line fades in to the rule's own colour.
    await expect
      .poll(async () => {
        const line = await boundary(sidebar);
        return opaque(line.colour) && line.colour === line.rule;
      })
      .toBe(true);
    expect((await boundary(sidebar)).width).toBe("1px");
    // The line takes no room: the fixed rows and the scroll area keep their boxes.
    expect(await boxes(sidebar, FIXED)).toEqual(rest.slice(0, FIXED.length));
    expect(await list.boundingBox()).toEqual(listBox);

    await list.evaluate((el) => (el.scrollTop = 0));
    await expect.poll(async () => opaque((await boundary(sidebar)).colour)).toBe(false);
  });
}

test("a column too short for both keeps room in the scroll area and scrolls the fixed block", async ({
  page,
}) => {
  const sidebar = await openApp(page, { height: 300 });
  const list = sidebar.locator('[data-find-region="sessions"]');
  const listBox = await list.boundingBox();
  const newChat = await row(sidebar, NEW_CHAT).boundingBox();
  expect(listBox.height).toBeGreaterThan(2 * newChat.height);

  // The fixed rows' own scroller: the nearest scrolling ancestor of New chat.
  const fixedScroller = await row(sidebar, FIXED[0]).evaluate((el) => {
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).overflowY === "auto") {
        return {
          overflows: node.scrollHeight > node.clientHeight,
          inList: node.closest("[data-find-region]") !== null,
        };
      }
    }
    return null;
  });
  expect(fixedScroller).toEqual({ overflows: true, inList: false });

  const aside = await sidebar.boundingBox();
  // The account menu's trigger, the column's last row.
  const account = await sidebar.locator('button[aria-haspopup="menu"]').last().boundingBox();
  expect(account.y + account.height).toBeLessThanOrEqual(aside.y + aside.height + 0.5);
});
