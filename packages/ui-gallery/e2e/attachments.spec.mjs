/**
 * Attachment tiles keep the picture's shape, and their controls stay in reach.
 *
 * The component library's attachments board (`lib.html?topic=attachments`) holds the composer
 * with staged images and files, a sent message, a steer's chip, every image ratio from a 16 px
 * icon to a 10:1 panorama, the composer and a message at phone width with a file name longer
 * than any tile, and an image that fails to load. A sent image once read as an ellipse in Frost:
 * it took the control radius, which Frost sets to 9999px, and on a box that is not square that
 * radius turns a rectangle into a stadium. Only a real engine resolves a radius against a box.
 *
 * - Given each theme, light and dark, every image tile's corner radius is less than half its
 *   shorter side (a rounded rectangle, never a stadium or an ellipse), every picture is either
 *   drawn at its own ratio or fitted whole inside its tile — never stretched or cropped — and no
 *   tile stands wider than the picture box it frames.
 * - Given the staged images and files in the composer, every tile in the row has one height.
 * - Given phone width and a file name longer than any tile, the name is cut off inside its tile,
 *   every tile and every remove button lies inside the row, and the page never scrolls sideways;
 *   hovering the cut-off name shows it whole.
 * - Given three staged images, pressing the second one's remove button removes that image and
 *   leaves the first and third in their order.
 * - Given an image that cannot load, a square tile stands in for it, named by why.
 */
import { test, expect } from "@playwright/test";

const THEMES = ["modern", "geek", "github"];

async function openBoard(page, { theme = "github", mode = "light", lang = "en", width = 1280 }) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/lib.html?topic=attachments&theme=${theme}&mode=${mode}&lang=${lang}`);
  await expect(
    page.locator('[data-board="composer"] [data-slot="attachment"]').first(),
  ).toBeVisible();
  // Every picture decoded (the failed one errors instead), so the tiles have their final width.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-slot="attachment"] img')].every((img) => img.complete),
  );
}

/** What is wrong with each image tile on the page: its shape, then its picture. */
const misshapen = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const [i, img] of [
      ...document.querySelectorAll('[data-slot="attachment"] img'),
    ].entries()) {
      const tile = img.parentElement;
      const box = tile.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(tile).borderTopLeftRadius);
      if (radius * 2 >= Math.min(box.width, box.height)) {
        out.push(`image ${i}: radius ${radius}px on a ${box.width}x${box.height} tile`);
      }
      const item = tile.closest('[data-slot="attachment"]').getBoundingClientRect();
      const frame = img.getBoundingClientRect();
      if (box.width - frame.width > 3 || item.width - box.width > 1) {
        out.push(
          `image ${i}: a ${frame.width}px picture in a ${box.width}px tile in a ${item.width}px item`,
        );
      }
      const natural = img.naturalWidth / img.naturalHeight;
      const drawn = img.clientWidth / img.clientHeight;
      const fit = getComputedStyle(img).objectFit;
      const sameShape = Math.abs(drawn - natural) / natural < 0.03;
      if (!sameShape && !["contain", "scale-down"].includes(fit)) {
        out.push(`image ${i}: ${natural.toFixed(2)} drawn at ${drawn.toFixed(2)} with ${fit}`);
      }
    }
    return out;
  });

test.describe("attachment tiles", () => {
  for (const theme of THEMES) {
    for (const mode of ["light", "dark"]) {
      test(`keep every picture's shape (${theme}, ${mode})`, async ({ page }) => {
        await openBoard(page, { theme, mode });
        expect(await misshapen(page)).toEqual([]);
      });
    }
  }

  test("line up at one height in the composer", async ({ page }) => {
    await openBoard(page, { theme: "modern" });
    const heights = await page
      .locator('[data-board="composer"] [data-slot="attachment"]')
      .evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(4);
    expect(new Set(heights).size).toBe(1);
  });

  for (const theme of THEMES) {
    test(`keep a long name and the remove buttons inside the row at phone width (${theme})`, async ({
      page,
    }) => {
      await openBoard(page, { theme, width: 390 });
      const found = await page.locator('[data-board="narrow"]').evaluate((board) => {
        const out = [];
        for (const list of board.querySelectorAll('[data-slot="attachments"]')) {
          const row = list.getBoundingClientRect();
          for (const el of list.querySelectorAll('[data-slot="attachment"], button')) {
            const r = el.getBoundingClientRect();
            if (r.left < row.left - 0.5 || r.right > row.right + 0.5) {
              out.push(`${el.ariaLabel ?? el.textContent} runs past its row`);
            }
          }
        }
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth) out.push("the page scrolls sideways");
        return out;
      });
      expect(found).toEqual([]);
      const name = page
        .locator('[data-board="narrow"]')
        .getByText(/^quarterly-infrastructure-review/)
        .first();
      expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      const remove = page
        .locator('[data-board="narrow"]')
        .getByRole("button", { name: /^Remove file quarterly-infrastructure-review/ });
      await remove.scrollIntoViewIfNeeded();
      await expect(remove).toBeInViewport({ ratio: 1 });
    });
  }

  test("show a cut-off file name whole on hover", async ({ page }) => {
    await openBoard(page, { theme: "github", width: 390 });
    const name = page
      .locator('[data-board="narrow"]')
      .getByText(/^quarterly-infrastructure-review/)
      .first();
    const whole = (await name.textContent()).trim();
    await name.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await name.hover();
    await expect(page.getByTestId("tooltip")).toHaveText(whole);
  });

  test("remove exactly the image whose button was pressed", async ({ page }) => {
    await openBoard(page, { theme: "github" });
    const composer = page.locator('[data-board="composer"]').first();
    const sources = () =>
      composer
        .locator('[data-slot="attachment"] img')
        .evaluateAll((imgs) => imgs.map((i) => i.src));
    const before = await sources();
    expect(before.length).toBeGreaterThanOrEqual(3);
    await composer.getByRole("button", { name: "Remove image" }).nth(1).click();
    expect(await sources()).toEqual([before[0], ...before.slice(2)]);
  });

  test("stand a square tile in for an image that cannot load", async ({ page }) => {
    await openBoard(page, { theme: "modern" });
    const failed = page
      .locator('[data-board="failed"]')
      .getByRole("img", { name: "This image could not be loaded" });
    await expect(failed).toHaveCount(2);
    for (const box of await failed.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().toJSON()),
    )) {
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    }
  });
});
