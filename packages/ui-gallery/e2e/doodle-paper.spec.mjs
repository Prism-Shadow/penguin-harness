/**
 * A work group keeps its paper outline when its head folds. A password reminder opens a
 * bordered dialog, including from the account settings; neighbouring settings rows share
 * their outer edge and their dividers. Check the paint rather than a particular CSS rule.
 */
import { expect, test } from "@playwright/test";

async function expectPaperEdge(page, surface, stroke = surface) {
  await expect(surface).toBeVisible();
  const { edge, radius } = await stroke.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      edge: style.borderLeftColor,
      radius: Math.max(
        ...[
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomLeftRadius,
          style.borderBottomRightRadius,
        ].map(parseFloat),
      ),
    };
  });
  const png = await surface.screenshot({ animations: "disabled", scale: "css" });
  const sides = await page.evaluate(
    async ({ png, edge, radius }) => {
      const image = await createImageBitmap(
        await (await fetch("data:image/png;base64," + png)).blob(),
      );
      const { width, height } = image;
      const ctx = new OffscreenCanvas(width, height).getContext("2d");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, 1, 1);
      const ink = ctx.getImageData(0, 0, 1, 1).data;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const matches = (x, y) => {
        const offset = 4 * (y * width + x);
        return (
          ink[3] === 255 && [0, 1, 2].every((c) => Math.abs(pixels[offset + c] - ink[c]) <= 14)
        );
      };
      // A fractional layout box can round either way when the browser crops the screenshot.
      // Sample one to three device pixels inside the long straight portion of each edge.
      return ["top", "right", "bottom", "left"].map((side) => {
        const horizontal = side === "top" || side === "bottom";
        const length = horizontal ? width : height;
        const fractions = length >= 4 * radius ? [0.25, 0.5, 0.75] : [0.5];
        return fractions.every((fraction) => {
          const line = Math.floor(length * fraction);
          return [0, 1, 2].some((depth) =>
            horizontal
              ? matches(line, side === "top" ? depth : height - 1 - depth)
              : matches(side === "left" ? depth : width - 1 - depth, line),
          );
        });
      });
    },
    { png: png.toString("base64"), edge, radius },
  );
  expect(sides, "painted top, right, bottom and left borders").toEqual([true, true, true, true]);
}

for (const [mode, lang, width] of [
  ["light", "en", 1280],
  ["dark", "zh", 390],
]) {
  test(`Doodle retains the notebook edge and the password and settings outlines (${mode})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const prefs = new URLSearchParams({ theme: "doodle", mode, lang });
    await page.goto(`/app.html?route=/chat/s-link-check&${prefs}`);
    const frame = page
      .locator(".ui-frame")
      .filter({ has: page.locator('[data-group-header][data-state="running"]') })
      .first();
    await expectPaperEdge(page, frame);
    const head = frame.locator("[data-group-header]");
    await head.focus();
    await head.press("Enter");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expectPaperEdge(page, frame);

    await page.goto(`/app.html?route=/chat/new&notices=1&${prefs}`);
    const banner = page.locator(".ui-notice[data-banner]").first();
    await expectPaperEdge(page, banner);
    await banner.getByRole("button", { name: lang === "en" ? "Change now" : "去修改" }).click();
    const password = page.getByRole("dialog");
    await expectPaperEdge(page, password);
    const field = password.locator('input[type="password"]').first();
    for (let i = 0; i < 8 && !(await field.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(password).toHaveCount(0);

    await page.goto(`/app.html?route=/chat/new&open=settings.general&${prefs}`);
    const firstRow = page.locator(".ui-field").first();
    await expectPaperEdge(page, firstRow.locator(".."), firstRow);
  });
}
