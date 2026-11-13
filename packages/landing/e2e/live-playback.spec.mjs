/**
 * Given an autoplay frame, its window-bar button pauses typing and resumes the existing draft.
 * Given a running evolution, the button pauses emitted steps and navigation, then resumes to the curve.
 * Given reduced motion, or ordinary frames, no autoplay control is offered.
 * Given the AMSP player, the same control pauses and continues its streamed events.
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
  const iframe = page.locator('iframe[src*="autoplay=evolution"]');
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

test("pauses typing and resumes the same prompt on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { frame } = await openHero(page);
  await expect(frame.locator(composer)).not.toHaveValue("");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const draft = await frame.locator(composer).inputValue();
  await page.clock.fastForward(30_000);
  await expect(frame.locator(composer)).toHaveValue(draft);
  await expect(frame.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  for (
    let step = 0;
    step < 6 && (await frame.getByRole("button", { name: "停止", exact: true }).count()) === 0;
    step++
  )
    await page.clock.runFor(1000);
  await expect(frame.getByRole("button", { name: "停止", exact: true }).first()).toBeVisible();
});

test("pauses the stream, pauses between loops and resumes the next round", async ({ page }) => {
  const { frame } = await openHero(page, "en");
  await expect(frame.locator(composer)).not.toHaveValue("");
  await page.clock.runFor(6500);
  await expect(frame.getByRole("button", { name: "Stop", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const before = await frame.locator("main .md-body").allTextContents();
  await page.clock.fastForward(30_000);
  await expect(frame.getByRole("heading", { name: "Docs QA v1", exact: true })).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "Stop", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(await frame.locator("main .md-body").allTextContents()).toEqual(before);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  for (
    let step = 0;
    step < 16 &&
    (await frame.getByRole("heading", { name: "Docs QA v1", exact: true }).count()) === 0;
    step++
  )
    await page.clock.runFor(2000);
  await expect(frame.getByRole("heading", { name: "Docs QA v1", exact: true })).toBeVisible();
  await expect(frame.locator('main svg.ui-chart [data-part="series"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.clock.fastForward(30_000);
  await expect(frame.getByRole("heading", { name: "Docs QA v1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  for (let step = 0; step < 10 && (await frame.locator(composer).count()) === 0; step++)
    await page.clock.runFor(1000);
  await expect(frame.locator(composer)).toBeVisible();
});

test("does not offer autoplay controls under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { frame } = await openHero(page);
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toHaveCount(0);
  await page.clock.fastForward(30_000);
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
