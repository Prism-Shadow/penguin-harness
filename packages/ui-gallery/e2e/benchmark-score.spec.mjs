/**
 * The score, its change and the unevaluated state sit beside the Benchmark actions. A theme
 * can frame the readings, but the frame must leave clear paper around their first and last
 * glyphs. A snug ring around the text used to cross those glyphs in Doodle.
 */
import { expect, test } from "@playwright/test";

for (const [lang, width, mode] of [
  ["zh", 1280, "light"],
  ["en", 390, "dark"],
]) {
  test(`benchmark readings clear their surrounding frame (${lang}, ${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto(`/app.html?route=/benchmark&theme=doodle&mode=${mode}&lang=${lang}`);
    const empty = page
      .getByText(lang === "zh" ? "尚未评测" : "Not evaluated yet", { exact: true })
      .last();
    await expect(empty).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const scores = page.locator('main .ui-ledger [data-slot="figure"]');
    await expect(scores.first()).toBeVisible();
    for (const reading of [empty, ...(await scores.all())]) {
      const tile = reading.locator("..");
      await tile.scrollIntoViewIfNeeded();
      const rows = await tile.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [...element.children].map((label) => {
          const range = document.createRange();
          range.selectNodeContents(label);
          const { left, right, top, height } = range.getBoundingClientRect();
          return {
            left: left - bounds.left,
            right: right - bounds.left,
            y: top - bounds.top + height / 2,
          };
        });
      });

      // Hide only the glyphs to measure their paper and any outline the theme paints behind them.
      const png = await tile.screenshot({
        scale: "css",
        style:
          '.ui-ledger [data-slot="label"], .ui-ledger [data-slot="figure"] { visibility: hidden; }',
      });
      const paperDifference = await page.evaluate(
        async ({ png, rows }) => {
          const bitmap = await createImageBitmap(
            await (await fetch("data:image/png;base64," + png)).blob(),
          );
          const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
          return rows.map(({ left, right, y }) => {
            const index = (x) =>
              4 * (Math.floor(y) * width + Math.max(0, Math.min(width - 1, Math.floor(x))));
            const middle = index((left + right) / 2);
            const edges = [index(left - 1), index(left), index(right - 1), index(right)];
            return Math.max(
              ...edges.flatMap((edge) =>
                [0, 1, 2].map((c) => Math.abs(data[edge + c] - data[middle + c])),
              ),
            );
          });
        },
        { png: png.toString("base64"), rows },
      );
      // Allow small antialiasing differences; a visible frame under an edge is much stronger.
      expect(Math.max(...paperDifference), "frame running through a reading").toBeLessThan(16);
    }
  });
}
