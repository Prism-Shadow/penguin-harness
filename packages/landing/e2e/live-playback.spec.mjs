/**
 * The homepage starts on the fresh project's new chat. Playing shows a single evolution round,
 * stopping restores the start, and reduced motion waits for the same explicit choice.
 * The AMSP player has independent pause and resume controls.
 */
import { test, expect } from "@playwright/test";

const composer = '[data-slot="composer"] textarea';

async function openHero(page, lang = "zh") {
  await page.addInitScript((lang) => {
    localStorage.setItem("penguin-site.lang", lang);
    localStorage.setItem("penguin-site.theme", "light");
  }, lang);
  await page.clock.install({ time: new Date("2026-10-28T00:00:00Z") });
  await page.goto("/");
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
    await expect(guide).toBeVisible();
    await page.clock.fastForward(30_000);
    await expect(frame.locator(composer)).toHaveValue("");
    await page.getByRole("button", { name: play, exact: true }).click();
    await expect(frame.locator(composer)).not.toHaveValue("");
    await page.getByRole("button", { name: stop, exact: true }).click();
    await expect(guide).toBeVisible();
    await expect(frame.locator(composer)).toHaveValue("");
    await page.getByRole("button", { name: play, exact: true }).click();
    const chart = frame.locator("main svg.ui-chart").first();
    for (let step = 0; step < 40 && !(await chart.isVisible()); step++) {
      await page.clock.runFor(1500);
    }
    await expect(chart).toBeVisible();
    await page.clock.fastForward(15_000);
    await expect(chart).toBeVisible();
    await page.getByRole("button", { name: stop, exact: true }).click();
    await expect(frame.locator(composer)).toHaveValue("");
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
      // A reader can reach Play at the bottom edge before any of the app has come into view.
      await play.evaluate((el) =>
        window.scrollTo({
          top: scrollY + el.getBoundingClientRect().bottom - innerHeight + 1,
          behavior: "instant",
        }),
      );
      const iframe = page.locator('iframe[src*="fresh=1"]');
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
      await expect(iframe.contentFrame().getByRole("dialog")).toBeVisible();
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
