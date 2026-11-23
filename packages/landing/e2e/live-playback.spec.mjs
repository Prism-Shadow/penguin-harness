/**
 * The homepage plays a single evolution round when its frame comes into view. Stopping restores
 * a new chat, and reduced motion waits for Play. Setup prompts stay out of the walkthrough.
 * The AMSP player has independent pause and resume controls.
 */
import { test, expect } from "@playwright/test";
import serverPackage from "../../server/package.json" with { type: "json" };

const composer = '[data-slot="composer"] textarea';

async function openHero(page, lang = "zh") {
  await page.addInitScript((lang) => {
    localStorage.setItem("penguin-site.lang", lang);
    localStorage.setItem("penguin-site.theme", "light");
  }, lang);
  await page.clock.install({ time: new Date("2026-10-28T00:00:00Z") });
  await page.goto("/");
  await page
    .getByRole("button", { name: /^(Play demo|Stop demo|播放演示|停止演示)$/ })
    .scrollIntoViewIfNeeded();
  const iframe = page.locator('iframe[src*="fresh=1"]');
  await iframe.scrollIntoViewIfNeeded();
  const frame = iframe.contentFrame();
  await expect(frame.locator(composer)).toBeVisible();
  // Keep the controls and the app in view together; an offscreen walkthrough waits on visibility.
  await iframe
    .locator("xpath=../..")
    .locator(":scope > div")
    .first()
    .evaluate((bar) =>
      window.scrollTo({
        top: bar.getBoundingClientRect().top + scrollY - 120,
        behavior: "instant",
      }),
    );
  return { iframe, frame };
}

for (const [lang, play, stop] of [
  ["en", "Play demo", "Stop demo"],
  ["zh", "播放演示", "停止演示"],
]) {
  test(`plays, stops and restarts a single evolution round (${lang})`, async ({ page }) => {
    if (lang === "zh") await page.setViewportSize({ width: 390, height: 844 });
    const { frame } = await openHero(page, lang);
    const guide = frame.getByRole("dialog", {
      name: lang === "en" ? "Connect a model provider first" : "先连接一个模型供应商",
    });
    const passwordNotice = frame.getByText(
      lang === "en" ? /this account is using its initial password/i : /当前账号正在使用初始密码/,
    );
    await expect(frame.locator(composer)).not.toHaveValue("");
    await expect(guide).toHaveCount(0);
    await expect(passwordNotice).toHaveCount(0);
    const chart = frame.locator("main svg.ui-chart:visible").first();
    const evaluation = frame.getByRole("heading", {
      name: lang === "en" ? "Docs QA v1" : "文档问答 v1",
      exact: true,
    });
    for (let step = 0; step < 65 && !(await evaluation.isVisible()); step++) {
      await page.clock.runFor(1500);
    }
    await expect(evaluation).toBeVisible();
    await page.clock.runFor(600);
    await page.clock.fastForward(15_000);
    if (lang === "en" && (await frame.locator("[data-workspace-page]").count())) {
      await expect(frame.locator('[data-pane="left"] [data-slot="composer"]')).toBeVisible();
      await expect(frame.locator('[data-pane="right"] svg.ui-chart').first()).toBeVisible();
    }
    await expect(chart).toBeVisible();
    await page.getByRole("button", { name: stop, exact: true }).click();
    await expect(frame.locator(composer)).toHaveValue("");
    await expect(guide).toHaveCount(0);
    await expect(passwordNotice).toHaveCount(0);
    await page.getByRole("button", { name: play, exact: true }).click();
    await expect(frame.locator(composer)).not.toHaveValue("");
  });
}

test("the live homepage preview uses the new chat header and shortcut strip", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { frame } = await openHero(page, "en");
  await expect(frame.getByText("Create your first Agent OS", { exact: true })).toBeVisible();
  await expect(frame.locator('[data-slot="counts"]')).toHaveCount(0);
  await expect(frame.locator('[data-slot="examples"]')).toBeVisible();
  await expect(frame.locator('[data-slot="version"]')).toContainText(
    /v[\d.]+ · Last updated \w+ \d+/,
  );
  expect(await frame.locator(composer).evaluate((el) => getComputedStyle(el).resize)).toBe("none");
});

for (const [lang, name, instruction, download] of [
  [
    "en",
    "Your first workbench",
    /in your installed copy of PenguinHarness/i,
    "Download PenguinHarness",
  ],
  ["zh", "我的第一个工作台", /在已安装的 PenguinHarness 中/, "下载 PenguinHarness"],
]) {
  test(`opens the installed guide's download instructions (${lang})`, async ({ page }) => {
    const { frame } = await openHero(page, lang);
    await page
      .getByRole("button", { name: lang === "en" ? "Stop demo" : "停止演示", exact: true })
      .click();
    await expect(frame.getByRole("dialog")).toHaveCount(0);
    const row = frame.locator('[data-app-row="default_agent/first-workbench-guide"]:visible');
    if (!("@penguinharness/first-workbench-guide" in serverPackage.dependencies)) {
      await expect(row).toHaveCount(0);
      return;
    }
    await row.click();
    const guide = frame.getByRole("region", { name, exact: true });
    await expect(guide.getByText(instruction)).toBeVisible();
    const link = guide.getByRole("link", { name: download });
    const opened = page.waitForEvent("popup");
    await link.click();
    const downloads = await opened;
    await expect(downloads).toHaveURL(/\/download\/?$/);
    await expect(downloads.getByRole("heading", { name: "macOS", exact: true })).toBeVisible();
  });
}

test.describe("starting the demo on a touchscreen", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const reducedMotion of ["no-preference", "reduce"]) {
    test(`reveals the demo on the first tap (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "en"));
      await page.goto("/");
      const play = page.getByRole("button", { name: "Play demo", exact: true });
      const stop = page.getByRole("button", { name: "Stop demo", exact: true });
      const iframe = page.locator('iframe[src*="fresh=1"]');
      if (reducedMotion === "no-preference") {
        await stop.tap();
        await expect(iframe.contentFrame().locator(composer)).toHaveValue("");
      }
      // A reader can reach Play at the bottom edge before any of the app has come into view.
      await play.evaluate((el) =>
        window.scrollTo({
          top: scrollY + el.getBoundingClientRect().bottom - innerHeight + 1,
          behavior: "instant",
        }),
      );
      const visibleFraction = () =>
        iframe.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const visible = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
          return visible / rect.height;
        });
      expect(await visibleFraction()).toBe(0);
      await play.tap();
      await expect.poll(visibleFraction).toBeGreaterThan(0.5);
      await expect(stop).toBeInViewport({ ratio: 1 });
      await expect(iframe.contentFrame().locator(composer)).not.toHaveValue("");
      await stop.tap();
      await expect(iframe.contentFrame().locator(composer)).toHaveValue("");
      await expect(iframe.contentFrame().getByRole("dialog")).toHaveCount(0);
    });
  }
});

test("waits for explicit playback with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { frame } = await openHero(page);
  await page.clock.fastForward(30_000);
  await expect(frame.locator(composer)).toHaveValue("");
  await page.getByRole("button", { name: "播放演示", exact: true }).click();
  await expect(frame.locator(composer)).not.toHaveValue("");
  await page.getByRole("button", { name: "停止演示", exact: true }).click();
  await expect(frame.locator(composer)).toHaveValue("");
});

test("pauses and resumes the AMSP stream with the shared control", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "zh"));
  await page.clock.install({ time: new Date("2026-10-28T00:00:00Z") });
  await page.goto("/amsp");
  const pause = page.getByRole("button", { name: "暂停", exact: true });
  await pause.scrollIntoViewIfNeeded();
  await page.clock.runFor(1200);
  await pause.click();
  const stream = page.locator('[role="tabpanel"] ol:visible');
  const before = await stream.allTextContents();
  await page.clock.fastForward(15_000);
  expect(await stream.allTextContents()).toEqual(before);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.clock.runFor(1200);
  expect(await stream.allTextContents()).not.toEqual(before);
});
