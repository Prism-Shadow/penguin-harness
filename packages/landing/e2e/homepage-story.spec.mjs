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
    "从 许愿式编程 到 许愿式调优",
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
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
      await expect(page.locator(".hero-automation")).toHaveText(subtitle);
      const backdrop = page.locator(".neon-bg");
      await expect(backdrop).toHaveCSS("pointer-events", "none");
      await expect(backdrop.locator(".neon-blob").first()).toHaveCSS("animation-name", "none");
      const metrics = page.locator("main section").first().locator("ul").first().getByRole("link");
      await expect(metrics).toHaveCount(3);
      for (const metric of await metrics.all()) await expect(metric).toHaveText(/^[1-9]\d*/);
      await expect(metrics.nth(1)).toHaveAttribute("href", "/plugins");
      await expect(metrics.nth(2)).toHaveAttribute("href", "/benchmarks");
      await expect(page.locator("main video")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Play demo|播放演示/ }).first()).toBeVisible();
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
      for (const [target, suite, algorithm] of [
        [apps[0], "rag-bench-essential", "OPRO"],
        [lang === "en" ? "Software engineering" : "软件工程", "deep-swe", "ACE"],
      ]) {
        const agent = loops.locator("dl").filter({ hasText: target });
        await expect(agent.locator("dd")).toHaveText(target);
        const lane = agent.locator("+ ol");
        await expect(lane.getByText(algorithm, { exact: true })).toBeVisible();
        const labels = lane.getByText(suite, { exact: true });
        await expect(labels).toHaveCount(2);
        const size = await labels.first().evaluate((el) => ({
          font: parseFloat(getComputedStyle(el).fontSize),
          fits: el.scrollWidth <= el.clientWidth,
        }));
        expect(size.font).toBeGreaterThanOrEqual(12);
        expect(size.fits).toBe(true);
        await expect(lane.getByText(steps[0], { exact: true })).toHaveCount(2);
        await expect(lane.getByText(steps[1], { exact: true })).toHaveCount(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

test("listing badges share the hero entrance and reserve their bounds through slow and failed artwork", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "en"));
  let releaseHunt;
  let releaseWatcha;
  const hunt = new Promise((resolve) => {
    releaseHunt = resolve;
  });
  const watcha = new Promise((resolve) => {
    releaseWatcha = resolve;
  });
  await page.route("https://api.producthunt.com/widgets/**", async (route) => {
    await hunt;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="54"><rect width="250" height="54" fill="white"/></svg>',
    });
  });
  await page.route("https://watcha.cn/api/**", async (route) => {
    await watcha;
    await route.abort();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const product = page.getByRole("link", { name: "PenguinHarness on Product Hunt" });
    const other = page.getByRole("link", { name: "PenguinHarness Watcha badge" });
    const row = product.locator("..");
    await expect(row).toContainText("Watcha");
    await expect(row).toHaveCSS("animation-name", "rise-in");
    await expect(product.locator("img")).toHaveAttribute("alt", "");
    await expect(product.locator("img")).toBeHidden();
    await expect(other.locator("img")).toBeHidden();
    await expect(product.getByText("Product Hunt")).toBeVisible();
    await expect(other.getByText("Watcha")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(row).toHaveCSS("animation-name", "none");
    const initial = await row.boundingBox();
    releaseHunt();
    await expect(product.locator("img")).toBeVisible();
    releaseWatcha();
    await expect.poll(() => other.locator("img").evaluate((img) => img.complete)).toBe(true);
    await expect(other.locator("img")).toBeHidden();
    await expect(other.getByText("Watcha")).toBeVisible();
    expect(await row.boundingBox()).toEqual(initial);
    await other.focus();
    await other.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    releaseHunt();
    releaseWatcha();
  }
});
