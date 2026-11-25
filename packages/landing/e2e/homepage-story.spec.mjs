import { expect, test } from "@playwright/test";

for (const [lang, headline, subtitle, apps, steps] of [
  [
    "en",
    "From Vibe-Coding to Vibe-Finetuning",
    "Unified Self-Evolving Foundation for Millions of AI Apps.",
    [
      "Document Q&A",
      "Investment Analyst",
      "Legal Assistant",
      "Image Studio",
      "AI Slides",
      "Support",
      "Expense log",
      "Terminal",
      "Browser",
    ],
    ["Evaluating", "Improving", "Retesting", "Next round"],
  ],
  [
    "zh",
    "从 许愿式编程 到 许愿式调优",
    "千万个 AI 应用的统一自进化底座",
    [
      "文档问答",
      "投资分析",
      "法务助手",
      "图像工作室",
      "AI PPT",
      "客服工作台",
      "报销登记",
      "命令行终端",
      "浏览器",
    ],
    ["评估中", "改进中", "复测中", "下一轮"],
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
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("PenguinHarness");
      await expect(page.locator(".hero-positioning")).toHaveText(headline);
      await expect(page.locator(".hero-automation")).toHaveText(subtitle);
      const backdrop = page.locator(".neon-bg");
      await expect(backdrop).toHaveCSS("pointer-events", "none");
      await expect(backdrop.locator(".neon-blob").first()).toHaveCSS("animation-name", "none");
      const hero = page.locator("main section").first();
      const features = hero.locator("dl").first();
      await expect(features.locator("dd")).toHaveCount(3);
      await expect(features.locator("dd").last()).toHaveText(
        lang === "en" ? "First self-improving harness" : "首个自进化 Harness",
      );
      const catalogue = hero.locator("dl").nth(1);
      await expect(catalogue.locator("dt")).toHaveText([/^1000\+/, /^10\+/, /^20\+/]);
      await expect(catalogue.locator('a[href="https://arxiv.org/abs/2309.03409"]')).toBeVisible();
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
      const appsDiagram = page.locator("#cases [data-story-diagram]");
      const platform = page.locator("#self-evolution [data-story-diagram]");
      await expect(page.locator("#cases h2")).toHaveText(
        lang === "en"
          ? "Build your first self-evolving Harness OS"
          : "构建你的第一个自进化 Harness OS",
      );
      await expect(platform.locator(".scene-workflow-pane")).toBeVisible();
      await expect(platform).not.toContainText("GDPEVO Essential");
      await expect(page.locator("#self-evolution figure")).toHaveCount(3);
      for (const app of apps) {
        await expect(appsDiagram.getByText(app, { exact: true })).toBeVisible();
      }
      await expect(
        appsDiagram.getByText(lang === "en" ? "Installed in Harness OS" : "已装入 Harness OS"),
      ).toBeVisible();
      const phases = platform.locator('[data-agent-loop] [aria-current="step"]');
      await expect(phases).toHaveText(steps);
      await expect(platform.locator('[data-arc="active"] .evo-arc').first()).toHaveCSS(
        "animation-name",
        "none",
      );
      await expect(platform.locator("[data-agent-loop]")).toHaveCount(4);
      await expect(platform.locator("animateMotion")).toHaveCount(0);
      for (const diagram of [appsDiagram, platform]) {
        await expect(diagram.locator("a,button,[role=button]")).toHaveCount(0);
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

// In view one clock turns every loop, each a stage apart, and the round a loop closes bumps its
// version and moves the curves. Switching to reduced motion leaves the finished run.
test("agent loops turn out of step, and each closed round bumps a version and the curves", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "en"));
  await page.goto("/");
  const workbench = page.getByRole("group", { name: "Self-Evolution Workbench", exact: true });
  await workbench.scrollIntoViewIfNeeded();
  const phases = workbench.locator('[data-agent-loop] [aria-current="step"]');
  const versions = workbench.locator("[data-agent-version]");
  const accuracy = workbench.locator("figure").first().locator(".evo-chart-value");
  await expect(phases).toHaveText(["Evaluating", "Improving", "Retesting", "Next round"]);
  await expect(versions).toHaveText(["v7", "v7", "v7", "v7"]);
  await expect(accuracy).toHaveText("79.0");
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(workbench).toHaveAttribute("data-active", "true");
  await expect(versions).toHaveText(["v1", "v1", "v1", "v1"]);
  await expect(accuracy).toHaveText("46.0");
  await page.clock.runFor(750);
  await expect(phases).toHaveText(["Improving", "Retesting", "Next round", "Evaluating"]);
  await expect(versions).toHaveText(["v1", "v1", "v1", "v2"]);
  await expect(accuracy).toHaveText("47.8");
  await page.clock.runFor(2100);
  await expect(phases).toHaveText(["Evaluating", "Improving", "Retesting", "Next round"]);
  await expect(versions).toHaveText(["v2", "v2", "v2", "v2"]);
  await expect(accuracy).toHaveText("53.0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(5500);
  await expect(versions).toHaveText(["v7", "v7", "v7", "v7"]);
});

// Each sentence becomes an app that installs when its ring closes, so the count only grows.
test("app center keeps generating and installing apps", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "en"));
  await page.goto("/");
  const appCenter = page.getByRole("group", { name: "App Center", exact: true });
  await appCenter.scrollIntoViewIfNeeded();
  const count = appCenter.locator("[data-app-count]");
  await expect(count).toHaveText("32");
  await expect(appCenter.locator('[data-app-state="building"]')).toHaveCount(0);
  await expect(appCenter.getByText("Installed in Harness OS")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(appCenter).toHaveAttribute("data-active", "true");
  await expect(count).toHaveText("24");
  await expect(appCenter.getByText("Generating app…")).toBeVisible();
  await expect(appCenter.getByText("Inventory", { exact: true })).toBeVisible();
  await expect(appCenter.locator('[data-app-state="building"]')).not.toHaveCount(0);
  await expect(appCenter.locator('[data-app-state="landed"]')).not.toHaveCount(0);
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThan(26);
});
