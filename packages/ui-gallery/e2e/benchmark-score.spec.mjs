/**
 * The score, its change and the unevaluated state sit beside the Benchmark actions, on each card
 * of the Self-Evolution Workbench (the pinned package's page, in the App Center's window frame).
 * A theme can frame the readings, but the frame must leave clear paper around their first and
 * last glyphs. A snug ring around the text used to cross those glyphs in Doodle.
 */
import { expect, test } from "@playwright/test";

const route = encodeURIComponent("/apps?app=default_agent%2Fbenchmark");

for (const [lang, width, mode] of [
  ["zh", 1280, "light"],
  ["en", 390, "dark"],
]) {
  test(`benchmark readings clear their surrounding frame (${lang}, ${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto(`/app.html?route=${route}&theme=doodle&mode=${mode}&lang=${lang}`);
    const workbench = page
      .locator('iframe[src*="/workbenches/benchmark/ui/"]:visible')
      .contentFrame();
    const empty = workbench
      .getByText(lang === "zh" ? "尚未评测" : "Not evaluated yet", { exact: true })
      .last();
    await expect(empty).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // A card's newest score, with its change from the record before it beneath.
    const scores = workbench.locator(
      `li [data-tooltip="${lang === "zh" ? "最新分数" : "Latest score"}"]`,
    );
    await expect(scores.first()).toBeVisible();
    for (const reading of [empty, ...(await scores.all())]) {
      const tile = reading.locator("..");
      await tile.scrollIntoViewIfNeeded();
      await tile.evaluate((element) => element.setAttribute("data-reading", ""));
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
            color: getComputedStyle(label).color,
          };
        });
      });

      // Hide only the glyphs to measure their paper and any outline the theme paints behind them.
      const png = await tile.screenshot({
        scale: "css",
        style: "[data-reading] > * { visibility: hidden; }",
      });
      await tile.evaluate((element) => element.removeAttribute("data-reading"));
      const samples = await page.evaluate(
        async ({ png, rows }) => {
          const bitmap = await createImageBitmap(
            await (await fetch("data:image/png;base64," + png)).blob(),
          );
          const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
          const luminance = (rgb) => {
            const [r, g, b] = rgb.map((n) => {
              const v = n / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          return rows.map(({ left, right, y, color }) => {
            const index = (x) =>
              4 * (Math.floor(y) * width + Math.max(0, Math.min(width - 1, Math.floor(x))));
            const middle = index((left + right) / 2);
            const edges = [index(left - 1), index(left), index(right - 1), index(right)];
            const edgeDifference = Math.max(
              ...edges.flatMap((edge) =>
                [0, 1, 2].map((c) => Math.abs(data[edge + c] - data[middle + c])),
              ),
            );
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const ink = luminance(Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3));
            const paper = luminance(Array.from(data.slice(middle, middle + 3)));
            const contrast = (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
            return { edgeDifference, contrast };
          });
        },
        { png: png.toString("base64"), rows },
      );
      // Allow small antialiasing differences; a visible frame under an edge is much stronger.
      for (const { edgeDifference, contrast } of samples) {
        expect(edgeDifference, "frame running through a reading").toBeLessThan(16);
        expect(contrast, "text against its card paper").toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}
