/**
 * Message fills on a custom background, measured where only a browser can: the computed colours
 * of the framed app (`app.html`), with the background seeded the way a user's browser holds it
 * (the frame's `wallpaper` params write the two storage keys) and the conversation's notices
 * raised (`notices=1`). The approval conversation then holds a user bubble, a tool call waiting
 * on approval with its band, the initial-password banner across the main column and the
 * context-window notice over the composer.
 *
 * - Given a background, in each theme, the image is drawn under the shell and the user bubble
 *   lets it through: its fill is translucent, never clear.
 * - Given a background, in each theme, a notice and the approval band keep a thinner tone tint in
 *   Primer — in dark too, where the tint is translucent of its own; in Frost a notice is the
 *   panel's glass, the same fill as the composer, and the band a thinner amber; in Console
 *   neither paints anything.
 * - Given no background, the bubble is the opaque accent tint, a gray for the theme's own accent.
 * - Given Primer's blue accent and a background, the bubble's wash is blue.
 * - Given a background and reduced transparency, the bubble and Primer's notices are opaque.
 * - Given a background, a toast in Frost — whose notice recipe reads the panel's glass — floats
 *   outside the shell on its own opaque surface.
 *
 * Each case is one page load of the whole app, so the cases are the mechanisms, not the matrix:
 * the other modes run the same rules on other token values, which the contrast suite measures
 * and the screenshot script (`scripts/shots.mjs --wallpaper both`) shows.
 */
import { test, expect } from "@playwright/test";

/** Theme and mode for the background cases: every theme, and Primer's dark tone tints. */
const BACKGROUND_CASES = [
  ["github", "light"],
  ["github", "dark"],
  ["modern", "light"],
  ["geek", "light"],
];
const SETTINGS = JSON.stringify({ transparency: 25, mode: "cover", position: "center center" });

const SELECTORS = {
  layer: ".ui-shell > [data-wallpaper-layer]",
  bubble: ".bg-accent-tint",
  banner: ".ui-notice[data-banner]",
  notice: ".ui-notice:not([data-banner], button)",
  band: '[data-wallpaper-surface="tone"]:not(.ui-notice)',
  composer: '[data-slot="composer"]',
};

/** A small fixture image of strong, light and dark bands, as the PNG data URL the app stores. */
let image = "";
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 40;
    const g = canvas.getContext("2d");
    ["#1d4ed8", "#f8fafc", "#111827", "#f59e0b"].forEach((colour, i) => {
      g.fillStyle = colour;
      g.fillRect(i * 16, 0, 16, 40);
    });
    return canvas.toDataURL("image/png");
  });
  await page.close();
});

/** A computed colour, `rgb()`/`rgba()` or `color(srgb …)`, as 0–255 channels and an alpha. */
function rgba(css) {
  const legacy = /^rgba?\(([^)]+)\)$/.exec(css);
  if (legacy) {
    const [r, g, b, a = 1] = legacy[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  }
  const srgb = /^color\(srgb ([^)]+)\)$/.exec(css);
  if (srgb) {
    const [channels, alpha] = srgb[1].split("/");
    const [r, g, b] = channels
      .trim()
      .split(/\s+/)
      .map((c) => Number(c) * 255);
    return { r, g, b, a: alpha === undefined ? 1 : Number(alpha) };
  }
  // Another space (Primer's tone tints are oklch): only the alpha is read from these.
  const other = /^[a-z-]+\(([^)]+)\)$/.exec(css);
  if (other) {
    const alpha = other[1].split("/")[1];
    return { r: NaN, g: NaN, b: NaN, a: alpha === undefined ? 1 : Number(alpha) };
  }
  throw new Error(`unreadable colour: ${css}`);
}

/** Opens the approval conversation, waiting until the bubble, the notices and the band are up. */
async function openChat(page, { theme, mode = "light", accent = "neutral", wallpaper, open }) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const params = new URLSearchParams({
    route: "/chat/s-publish",
    theme,
    mode,
    accent,
    size: "m",
    latin: "theme",
    cjk: "theme",
    lang: "en",
    notices: "1",
  });
  if (wallpaper) {
    params.set("wallpaper", image);
    params.set("wallpaperSettings", SETTINGS);
  }
  if (open) params.set("open", open);
  await page.goto(`/app.html?${params}`);
  // The dev server compiles the whole app on the first visit, and may reload it once while it
  // optimizes the app's dependencies; the frame's state is all in its URL, so a reload is harmless.
  await expect(page.locator(SELECTORS.bubble).first()).toBeVisible({ timeout: 45_000 });
  for (const selector of [SELECTORS.banner, SELECTORS.notice, SELECTORS.band]) {
    await expect(page.locator(selector).first()).toBeVisible();
  }
}

/** Each surface's computed background, and whether the image layer is drawn. */
async function fills(page) {
  const found = await page.evaluate((selectors) => {
    const out = {};
    for (const [name, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector);
      out[name] = el === null ? null : getComputedStyle(el).backgroundColor;
    }
    return out;
  }, SELECTORS);
  const colours = Object.fromEntries(
    Object.entries(found)
      .filter(([name, css]) => name !== "layer" && css !== null)
      .map(([name, css]) => [name, rgba(css)]),
  );
  return { layer: found.layer !== null, ...colours };
}

const translucent = (c) => c.a > 0 && c.a < 1;

test.describe("message fills on a custom background", () => {
  for (const [theme, mode] of BACKGROUND_CASES) {
    test(`let the image through the bubble and thin the notices (${theme}, ${mode})`, async ({
      page,
    }) => {
      await openChat(page, { theme, mode, wallpaper: true });
      const f = await fills(page);
      expect(f.layer).toBe(true);
      expect(translucent(f.bubble), JSON.stringify(f.bubble)).toBe(true);
      if (theme === "github") {
        for (const name of ["banner", "notice", "band"]) {
          expect(translucent(f[name]), `${name} ${JSON.stringify(f[name])}`).toBe(true);
        }
      } else if (theme === "modern") {
        expect(translucent(f.composer), JSON.stringify(f.composer)).toBe(true);
        expect(f.banner).toEqual(f.composer);
        expect(f.notice).toEqual(f.composer);
        expect(translucent(f.band), JSON.stringify(f.band)).toBe(true);
      } else {
        for (const name of ["banner", "notice", "band"]) {
          expect(f[name].a, name).toBe(0);
        }
      }
    });
  }

  test("keep the bubble's opaque tint without a background, a gray for the theme's accent (Primer)", async ({
    page,
  }) => {
    await openChat(page, { theme: "github", wallpaper: false });
    const { bubble, layer } = await fills(page);
    expect(layer).toBe(false);
    expect(bubble.a).toBe(1);
    const spread = Math.max(bubble.r, bubble.g, bubble.b) - Math.min(bubble.r, bubble.g, bubble.b);
    expect(spread, JSON.stringify(bubble)).toBeLessThanOrEqual(3);
  });

  test("wash the bubble in the accent's hue (Primer, blue)", async ({ page }) => {
    await openChat(page, { theme: "github", accent: "blue", wallpaper: true });
    const { bubble } = await fills(page);
    expect(translucent(bubble), JSON.stringify(bubble)).toBe(true);
    expect(bubble.b - Math.max(bubble.r, bubble.g), JSON.stringify(bubble)).toBeGreaterThan(100);
  });

  test("turn solid again when the system asks for reduced transparency (Primer)", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await openChat(page, { theme: "github", wallpaper: true });
    const reduced = await page.evaluate(
      () => matchMedia("(prefers-reduced-transparency: reduce)").matches,
    );
    test.skip(!reduced, "this Chromium does not emulate prefers-reduced-transparency");
    const f = await fills(page);
    expect(f.layer).toBe(true);
    for (const name of ["bubble", "banner", "notice"]) {
      expect(f[name].a, `${name} ${JSON.stringify(f[name])}`).toBe(1);
    }
  });

  test("float a toast on its own opaque surface, outside the shell (Frost)", async ({ page }) => {
    await openChat(page, { theme: "modern", wallpaper: true, open: "settings.profile" });
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[maxlength="32"]').fill("Demo Admin 2");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const toast = page.locator('section[aria-live="polite"] .ui-notice');
    await expect(toast).toBeVisible();
    const found = await toast.evaluate((el) => ({
      inShell: el.closest(".ui-shell") !== null,
      surface: el.getAttribute("data-wallpaper-surface"),
      backing: getComputedStyle(el.parentElement).backgroundColor,
    }));
    expect(found.inShell).toBe(false);
    expect(found.surface).toBeNull();
    expect(rgba(found.backing).a).toBe(1);
  });
});
