/**
 * The desktop window's main column, measured where only a browser can: the framed app
 * (`app.html`) as the desktop shell's main window (`window=win32`, a stand-in for the shell's
 * window bridge), on the plugins page, whose scroller fills the main column, with the scrollbar
 * drawn (headless Chromium hides it unless told otherwise).
 *
 * - Given the desktop window, in each theme, the page's scrollbar lies whole inside what the main
 *   column shows: no corner the column draws cuts into it, top or bottom, so its ends and its
 *   thumb at either end can be seen and pressed. And the main column starts below the title
 *   band, ruled off from it by the line that rules it off from the navigation column.
 *
 * One page load per theme carries both, since each load compiles and boots the whole app.
 */
import { test, expect } from "@playwright/test";

const THEMES = ["modern", "github", "geek", "doodle"];

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});

/** Opens the plugins page in the desktop window, waiting until its list scrolls. */
async function openWindow(page, theme) {
  const params = new URLSearchParams({
    route: "/plugins",
    theme,
    mode: "light",
    accent: "neutral",
    size: "m",
    latin: "theme",
    cjk: "theme",
    lang: "en",
    window: "win32",
  });
  await page.goto(`/app.html?${params}`);
  // The dev server compiles the whole app on the first visit, and may reload it once while it
  // optimizes the app's dependencies; the frame's state is all in its URL, so a reload is harmless.
  await expect(page.locator('.ui-shell[data-window-band] > [data-slot="band"]')).toBeVisible({
    timeout: 45_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const main = document.querySelector('.ui-shell > [data-slot="main"]');
        return [...main.querySelectorAll("*")].some(
          (e) =>
            e.scrollHeight > e.clientHeight + 4 &&
            /(auto|scroll)/.test(getComputedStyle(e).overflowY),
        );
      }),
    )
    .toBe(true);
}

/**
 * The main column's box and its corner radii, and the strip the tallest scroller inside it gives
 * its vertical scrollbar, all in client px.
 */
function geometry() {
  const main = document.querySelector('.ui-shell > [data-slot="main"]');
  const nav = document.querySelector('.ui-shell > [data-slot="nav"]');
  const band = document.querySelector('.ui-shell > [data-slot="band"]');
  const scrollers = [...main.querySelectorAll("*")].filter(
    (e) =>
      e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY),
  );
  scrollers.sort((a, b) => b.clientHeight - a.clientHeight);
  const scroller = scrollers[0];
  const box = scroller.getBoundingClientRect();
  const css = getComputedStyle(scroller);
  const width =
    scroller.offsetWidth -
    scroller.clientWidth -
    parseFloat(css.borderLeftWidth) -
    parseFloat(css.borderRightWidth);
  const right = box.right - parseFloat(css.borderRightWidth);
  const m = main.getBoundingClientRect();
  const mcss = getComputedStyle(main);
  const ncss = getComputedStyle(nav);
  return {
    main: { left: m.left, top: m.top, right: m.right, bottom: m.bottom },
    radius: {
      tl: parseFloat(mcss.borderTopLeftRadius),
      tr: parseFloat(mcss.borderTopRightRadius),
      br: parseFloat(mcss.borderBottomRightRadius),
      bl: parseFloat(mcss.borderBottomLeftRadius),
    },
    strip: { left: right - width, right, top: box.top, bottom: box.bottom, width },
    bandBottom: band.getBoundingClientRect().bottom,
    mainRule: { width: mcss.borderTopWidth, color: mcss.borderTopColor },
    navRule: { width: ncss.borderRightWidth, color: ncss.borderRightColor },
  };
}

/** Whether a point lies inside a box with these corner radii (the shape `overflow: clip` keeps). */
function inside({ main: b, radius: r }, x, y) {
  if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
  const corners = [
    [r.tl, b.left + r.tl, b.top + r.tl, x < b.left + r.tl && y < b.top + r.tl],
    [r.tr, b.right - r.tr, b.top + r.tr, x > b.right - r.tr && y < b.top + r.tr],
    [r.br, b.right - r.br, b.bottom - r.br, x > b.right - r.br && y > b.bottom - r.br],
    [r.bl, b.left + r.bl, b.bottom - r.bl, x < b.left + r.bl && y > b.bottom - r.bl],
  ];
  return corners.every(([rad, cx, cy, within]) => !within || Math.hypot(x - cx, y - cy) <= rad);
}

for (const theme of THEMES) {
  test(`${theme}: the desktop window's main column cuts no corner off a page's scrollbar, and is ruled off from the band as from the sidebar`, async ({
    page,
  }) => {
    await openWindow(page, theme);
    const g = await page.evaluate(geometry);
    expect(g.strip.width, "the scrollbar is drawn").toBeGreaterThan(0);
    const { left, right, top, bottom } = g.strip;
    for (const [x, y] of [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ]) {
      expect(inside(g, x, y), `scrollbar corner (${x}, ${y}) in ${JSON.stringify(g)}`).toBe(true);
    }
    expect(g.main.top).toBeGreaterThanOrEqual(g.bandBottom);
    expect(g.mainRule).toEqual(g.navRule);
  });
}
