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
    await expect(frame.getByRole("dialog")).toBeVisible();
    await page.clock.fastForward(30_000);
    await expect(frame.locator(composer)).toHaveValue("");
    await page.getByRole("button", { name: play, exact: true }).click();
    await expect(frame.locator(composer)).not.toHaveValue("");
    await page.getByRole("button", { name: stop, exact: true }).click();
    await expect(frame.getByRole("dialog")).toBeVisible();
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
