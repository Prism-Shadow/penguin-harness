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
 * - Given an Agent with a picture of its own, the picture shows in the Agent's rounded tile, in
 *   every theme; given a picture that fails to load, the default drawing shows in its place.
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

for (const theme of Object.keys(DRAWN)) {
  test(`${theme}: an Agent's own picture keeps its rounded tile, and a broken one draws the default`, async ({
    page,
  }) => {
    await open(page, theme);
    const pictures = page.locator('[data-avatar-board="picture"] img.ui-avatar');
    // One picture in every cell of the board's picture row, one cell per size it draws.
    await expect(pictures).toHaveCount(await page.locator('[data-avatar-board="picture"]').count());
    const corners = await pictures.evaluateAll((imgs) =>
      imgs.map((img) => ({
        width: img.getBoundingClientRect().width,
        radius: parseFloat(getComputedStyle(img).borderTopLeftRadius),
        loaded: img.complete && img.naturalWidth > 0,
      })),
    );
    for (const { width, radius, loaded } of corners) {
      expect(loaded).toBe(true);
      // A rounded tile, not a circle: a corner above zero and short of half the side.
      expect(radius > 0 && radius < width / 2).toBe(true);
    }
    const broken = page.locator('[data-avatar-board="broken"]');
    await expect(broken.locator("svg.ui-avatar")).toBeVisible();
    await expect(broken.locator("img")).toHaveCount(0);
  });
}
