/**
 * An Agent's avatar follows the active theme, and only its drawing changes.
 *
 * The component library's avatars board (`lib.html?topic=avatars`) draws the palette in the
 * active theme's drawing. Each avatar carries every theme's drawing; the theme's CSS shows one.
 *
 * - Given each theme, every live avatar shows that theme's drawing and nothing else: Primer the
 *   flat one, Frost the soft one, Console the pixel one.
 * - Given the theme changes while the page is open, the same avatars show the new theme's drawing
 *   at once, with no reload.
 * - Given a theme id no stylesheet draws an avatar for, the avatars show Primer's flat drawing.
 * - Given the same Agent, its head is painted the same colour in every theme.
 */
import { test, expect } from "@playwright/test";

const DRAWN = { github: "flat", modern: "soft", geek: "pixel" };

/** The drawings each live avatar on the board shows, in board order. */
const shown = (page) =>
  page.locator('[data-avatar-board="active"] svg.ui-avatar').evaluateAll((avatars) =>
    avatars.map((svg) =>
      [...svg.children]
        .filter((g) => getComputedStyle(g).display !== "none")
        .map((g) => g.getAttribute("data-variant"))
        .join(","),
    ),
  );

/** The painted fills of the first live avatar's visible drawing. */
const fills = (page) =>
  page
    .locator('[data-avatar-board="active"] svg.ui-avatar')
    .first()
    .evaluate((svg) => {
      const drawing = [...svg.children].find((g) => getComputedStyle(g).display !== "none");
      return [...drawing.querySelectorAll("rect, circle, path")].map(
        (el) => getComputedStyle(el).fill,
      );
    });

async function open(page, theme) {
  await page.goto(`/lib.html?topic=avatars&theme=${theme}&mode=light&lang=en`);
  await expect(page.locator('[data-avatar-board="active"] svg.ui-avatar').first()).toBeVisible();
}

for (const [theme, drawing] of Object.entries(DRAWN)) {
  test(`${theme}: every live avatar shows the ${drawing} drawing alone`, async ({ page }) => {
    await open(page, theme);
    const drawings = await shown(page);
    expect(drawings.length).toBeGreaterThan(0);
    expect(new Set(drawings)).toEqual(new Set([drawing]));
  });
}

test("a theme switch redraws the open avatars, and an unknown theme falls back to flat", async ({
  page,
}) => {
  await open(page, "github");
  const head = (await fills(page))[0];
  const setTheme = (id) =>
    page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), id);

  await setTheme("geek");
  expect(new Set(await shown(page))).toEqual(new Set(["pixel"]));
  expect(await fills(page)).toContain(head);

  await setTheme("modern");
  expect(new Set(await shown(page))).toEqual(new Set(["soft"]));
  expect(await fills(page)).toContain(head);

  await setTheme("no-such-theme");
  expect(new Set(await shown(page))).toEqual(new Set(["flat"]));
});
