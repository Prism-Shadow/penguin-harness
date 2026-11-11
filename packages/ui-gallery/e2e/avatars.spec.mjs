/**
 * An Agent's avatar follows the active theme, and only its drawing changes.
 *
 * The component library's avatars board (`lib.html?topic=avatars`) draws the palette in the
 * active theme's drawing. Each avatar carries every theme's drawing; the theme's CSS shows one.
 *
 * - Given each theme, every live avatar shows that theme's drawing and nothing else: Primer the
 *   flat one, Frost and Doodle (built on Frost) the soft one, Console the pixel one.
 * - Given the theme changes while the page is open, the same avatars show the new theme's drawing
 *   at once, with no reload.
 * - Given a pack on the foundation alone that draws no avatar of its own, the avatars show Primer's
 *   flat drawing.
 * - Given the same Agent, its tile is painted the same colour in every theme.
 */
import { test, expect } from "@playwright/test";

const DRAWN = { github: "flat", modern: "soft", geek: "pixel", doodle: "soft" };

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
  const tile = (await fills(page))[0];
  // The root as the app writes it: the pack's id, and `data-theme-base="modern"` beside a pack
  // built on Frost (none beside one on the foundation alone).
  const setTheme = (id, onFrost) =>
    page.evaluate(
      ([value, base]) => {
        const root = document.documentElement;
        root.setAttribute("data-theme", value);
        if (base) root.setAttribute("data-theme-base", "modern");
        else root.removeAttribute("data-theme-base");
      },
      [id, onFrost],
    );

  await setTheme("geek", false);
  expect(new Set(await shown(page))).toEqual(new Set(["pixel"]));
  expect(await fills(page)).toContain(tile);

  await setTheme("modern", true);
  expect(new Set(await shown(page))).toEqual(new Set(["soft"]));
  expect(await fills(page)).toContain(tile);

  await setTheme("no-such-theme", false);
  expect(new Set(await shown(page))).toEqual(new Set(["flat"]));
});
