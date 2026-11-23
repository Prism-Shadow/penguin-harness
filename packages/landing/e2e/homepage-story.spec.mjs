import { expect, test } from "@playwright/test";

for (const [lang, headline, subtitle, apps, steps] of [
  [
    "en",
    "From Vibe-Coding to Vibe-Evolving",
    "Open Foundation for Self-Evolving Enterprise AI.",
    ["Document Q&A", "Investment Analyst", "Legal Assistant"],
    ["Evaluate", "Optimize"],
  ],
  [
    "zh",
    "从许愿式编程到许愿式调优",
    "企业级 AI 应用的统一自进化底座",
    ["文档问答", "投资分析", "法务助手"],
    ["评估", "优化"],
  ],
]) {
  for (const width of [320, 1280]) {
    test(`the homepage keeps both listings and its app and evaluation diagrams readable in ${lang} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({
        reducedMotion: "reduce",
        colorScheme: width === 320 ? "dark" : "light",
      });
      await page.addInitScript((lang) => localStorage.setItem("penguin-site.lang", lang), lang);
      await page.goto("/");
      await expect(page.locator(".hero-positioning")).toHaveText(headline);
      await expect(page.locator(".hero-automation")).toHaveText(subtitle);
      const watcha = page.locator('a[href="https://watcha.cn/products/penguinharness"]');
      const hunt = page.locator('a[href="https://www.producthunt.com/products/penguinharness"]');
      await expect(watcha.locator("img")).toHaveAttribute(
        "src",
        "https://watcha.cn/api/v2/products/penguinharness/badge?style=1&dark=false",
      );
      const [left, right] = await Promise.all([hunt.boundingBox(), watcha.boundingBox()]);
      expect(left.x + left.width).toBeLessThanOrEqual(right.x);
      expect(Math.abs(left.y - right.y)).toBeLessThan(1);
      expect(right.x + right.width).toBeLessThanOrEqual(width);
      for (const app of apps)
        await expect(page.locator("#cases figure").getByText(app, { exact: true })).toBeVisible();
      const loops = page.locator("#self-evolution figure").first();
      for (const algorithm of ["OPRO", "ACE"]) {
        const lane = loops.locator("ol").filter({ hasText: algorithm });
        await expect(lane.getByText(steps[0], { exact: true })).toHaveCount(2);
        await expect(lane.getByText(steps[1], { exact: true })).toHaveCount(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
