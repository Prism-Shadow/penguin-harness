/**
 * Given the hero's embedded new conversation, when visible, it types and sends one request,
 * then the real app shows streamed tools and the improved evaluation in either language.
 * Given a frame below the viewport, it waits; showing it starts the walkthrough without
 * stealing the host page's focus or changing its scroll position.
 * Given human input, autoplay yields and preserves the person's draft.
 * Given reduced motion, or an ordinary gallery frame, no request is sent automatically.
 */
import { test, expect } from "@playwright/test";

const composer = '[data-slot="composer"] textarea';
const query = (lang = "en", autoplay = true) =>
  `app.html?route=%2Fchat%2Fnew&theme=modern&mode=light&lang=${lang}&embed=1${autoplay ? "&autoplay=evolution" : ""}`;

test.beforeEach(async ({ page }) => {
  const start = new Date("2026-10-28T00:00:00Z");
  await page.clock.install({ time: start });
});

for (const lang of ["en", "zh"]) {
  test(`types, sends and shows an improved evaluation (${lang})`, async ({ page }) => {
    await page.goto(query(lang));
    await expect(page.locator(composer)).toBeVisible();
    await expect(page.locator(composer)).not.toHaveValue("");
    await page.clock.runFor(4500);
    await expect(
      page.getByRole("button", { name: lang === "zh" ? "停止" : "Stop", exact: true }).first(),
    ).toBeVisible();
    await page.clock.runFor(25_000);
    const result = page.getByRole("table").last();
    await expect(result).toContainText("81");
    await expect(result).toContainText("88.5");
    await expect(page.getByTestId("dock")).toHaveCount(0);
    await expect(page.locator(composer).first()).toHaveValue("");
    await expect(page.locator("body")).not.toContainText(/mock data|模拟数据/i);
  });
}

test("waits below the fold and leaves the host page in place", async ({ page, baseURL }) => {
  const src = new URL(query(), baseURL).href;
  await page.setContent(
    `<button id="host">Keep page focus</button><div style="height:1600px"></div><iframe title="Evolution" src="${src}" style="width:1280px;height:800px"></iframe>`,
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(composer)).toBeAttached();
  await page.clock.runFor(6000);
  await expect(frame.locator(composer)).toHaveValue("");
  await page.locator("iframe").scrollIntoViewIfNeeded();
  await page.locator("#host").evaluate((button) => button.focus({ preventScroll: true }));
  const scroll = await page.evaluate(() => scrollY);
  await page.clock.runFor(5000);
  await expect(frame.getByRole("button", { name: "Stop", exact: true }).first()).toBeVisible();
  await page.clock.runFor(25_000);
  await expect(frame.getByRole("table").last()).toContainText("88.5");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("host");
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
});

test("yields to human input and keeps that draft", async ({ page }) => {
  await page.goto(query());
  await expect(page.locator(composer)).toBeVisible();
  await expect(page.locator(composer)).not.toHaveValue("");
  await page.locator(composer).press("Escape");
  await page.locator(composer).fill("Keep my draft");
  await page.clock.runFor(30_000);
  await expect(page.locator(composer)).toHaveValue("Keep my draft");
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("keeps the evaluation panel open when the reader takes over during the run", async ({
  page,
}) => {
  await page.goto(query());
  await expect(page.locator(composer)).toBeVisible();
  await page.clock.runFor(10_000);
  await expect(page.getByTestId("dock-tab").first()).toBeVisible();
  await page.getByTestId("dock-tab").first().click();
  await page.clock.runFor(25_000);
  await expect(page.getByRole("table").last()).toContainText("88.5");
  await expect(page.getByTestId("dock").first()).toBeVisible();
});

for (const mode of ["reduced motion", "ordinary frame"]) {
  test(`stays interactive without autoplay for ${mode}`, async ({ page }) => {
    if (mode === "reduced motion") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(query("en", mode !== "ordinary frame"));
    await expect(page.locator(composer)).toBeVisible();
    await page.clock.runFor(30_000);
    await expect(page.locator(composer)).toHaveValue("");
    await expect(page.getByRole("table")).toHaveCount(0);
  });
}
