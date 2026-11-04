/**
 * Given the hero's embedded new conversation, when visible, it types and sends one request,
 * then the app shows its score curve, rests and starts another round without reloading the document.
 * Given a frame below the viewport, it waits; showing it starts the walkthrough without
 * stealing the host page's focus or changing its scroll position.
 * Given human input, autoplay yields and preserves the person's draft.
 * Given reduced motion, or an ordinary gallery frame, no request is sent automatically.
 */
import { test, expect } from "@playwright/test";

const composer = '[data-slot="composer"] textarea';
const query = (lang = "en", autoplay = true) =>
  `app.html?route=%2Fchat%2Fnew&theme=modern&mode=light&lang=${lang}&embed=1${autoplay ? "&autoplay=evolution" : ""}`;

async function advanceToCurve(page, frame = page, lang = "en") {
  const heading = frame.getByRole("heading", {
    name: lang === "zh" ? "文档问答 v1" : "Docs QA v1",
    exact: true,
  });
  for (let step = 0; step < 16 && (await heading.count()) === 0; step++)
    await page.clock.runFor(2000);
  await expect(heading).toBeVisible();
  await expect(frame.locator('main svg.ui-chart [data-part="series"]').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const start = new Date("2026-10-28T00:00:00Z");
  await page.clock.install({ time: start });
});

for (const lang of ["en", "zh"]) {
  test(`loops the evolution walkthrough without reloading (${lang})`, async ({ page }) => {
    if (lang === "zh") await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(query(lang));
    await expect(page.locator(composer)).toBeVisible();
    await expect(page.locator(composer)).not.toHaveValue("");
    await page.clock.runFor(4500);
    await expect(
      page.getByRole("button", { name: lang === "zh" ? "停止" : "Stop", exact: true }).first(),
    ).toBeVisible();
    await advanceToCurve(page, page, lang);
    const result = page.getByRole("table").last();
    await expect(result).toContainText("81");
    await expect(result).toContainText("88.5");
    await expect(page.locator('main svg.ui-chart [data-part="series"]').first()).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: lang === "zh" ? "文档问答 v1" : "Docs QA v1",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("dock")).toHaveCount(0);
    await expect(page.locator(composer)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/mock data|模拟数据/i);
    let reloads = 0;
    page.on("framenavigated", () => reloads++);
    await page.clock.runFor(5000);
    await expect(page.locator(composer)).toBeVisible();
    await page.clock.runFor(4500);
    await expect(
      page.getByRole("button", { name: lang === "zh" ? "停止" : "Stop", exact: true }).first(),
    ).toBeVisible();
    await advanceToCurve(page, page, lang);
    expect(reloads).toBe(0);
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
  await page.locator("#host").scrollIntoViewIfNeeded();
  await page.clock.runFor(100);
  const held = await frame.locator("main .md-body").allTextContents();
  await page.clock.fastForward(30_000);
  expect(await frame.locator("main .md-body").allTextContents()).toEqual(held);
  await expect(frame.getByRole("button", { name: "Stop", exact: true }).first()).toBeVisible();
  await page.locator("iframe").scrollIntoViewIfNeeded();
  await page.locator("#host").evaluate((button) => button.focus({ preventScroll: true }));
  await advanceToCurve(page, frame);
  await expect(frame.getByRole("table").last()).toContainText("88.5");
  await expect(frame.locator('main svg.ui-chart [data-part="series"]').first()).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Docs QA v1", exact: true })).toHaveCount(0);
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
