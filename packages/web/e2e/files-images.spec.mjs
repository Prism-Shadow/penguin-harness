/**
 * Workspace image sizing through the real file endpoint and Files panel.
 *
 * - Given a viewBox-only or percentage-sized SVG, when opened in each theme, it fills the available preview
 *   width with its aspect ratio intact and remains visible when enlarged.
 * - Given an image with fixed dimensions (SVG or PNG), when opened, it keeps its size
 *   unless the preview is narrower, in which case it fits without horizontal overflow.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;

async function openImage(page, name, dataBase64, theme = null) {
  await provisionAndLogin(page.request, "imagepreview", "password123");
  // The theme is the account's, and every test signs in as the same user: each states its own,
  // null being the default (account-prefs.mjs).
  await setAccountPrefs(page.request, { themeId: theme });
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const created = await page.request.post(
    `${BASE}/api/projects/${projects[0].projectId}/agents/default_agent/sessions`,
    { data: {} },
  );
  expect(created.ok()).toBeTruthy();
  const { session } = await created.json();
  const uploaded = await page.request.put(
    `${BASE}/api/sessions/${session.sessionId}/files/content?path=${name}`,
    { data: { dataBase64 } },
  );
  expect(uploaded.ok()).toBeTruthy();
  await page.goto(`${BASE}/chat/${session.sessionId}`);
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  const dock = page.getByTestId("dock");
  await dock.locator(`[data-tree-path="${name}"]`).click();
  const image = dock.getByRole("img", { name, exact: true });
  await expect(image).toBeVisible();
  await image.evaluate((img) => img.decode());
  return image;
}

const svg = (dimensions = "") =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" ${dimensions}><rect width="800" height="600" fill="#168080"/></svg>`,
  ).toString("base64");

for (const [theme, dimensions] of ["modern", "github", "geek"].flatMap((theme) =>
  ["", 'width="100%" height="100%"'].map((dimensions) => [theme, dimensions]),
)) {
  test(`SVG without fixed dimensions is visible in preview and lightbox (${theme}, ${dimensions || "viewBox"})`, async ({
    page,
  }, testInfo) => {
    const image = await openImage(page, "viewbox.svg", svg(dimensions), theme);
    const size = await image.evaluate((img) => ({
      width: img.clientWidth,
      height: img.clientHeight,
      available: img.parentElement.clientWidth,
    }));
    expect(size.width).toBeGreaterThan(100);
    expect(Math.abs(size.width - size.available)).toBeLessThanOrEqual(2);
    expect(Math.abs(size.width / size.height - 4 / 3)).toBeLessThan(0.02);
    await page.screenshot({ path: testInfo.outputPath(`${theme}-preview.png`) });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
    await image.click();
    const enlarged = page.locator(".ui-scrim").getByRole("img", { name: "viewbox.svg" });
    await expect(enlarged).toBeVisible();
    await expect.poll(() => enlarged.evaluate((img) => img.clientWidth)).toBeGreaterThan(100);
    const large = await enlarged.evaluate((img) => ({
      width: img.clientWidth,
      height: img.clientHeight,
    }));
    expect(large.height).toBeGreaterThan(75);
    expect(Math.abs(large.width / large.height - 4 / 3)).toBeLessThan(0.02);
    await page.screenshot({ path: testInfo.outputPath(`${theme}-lightbox-opening.png`) });
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await cdp.detach();
    await page.keyboard.press("Escape");
    await expect(enlarged).toHaveCount(0);
    await expect(image).toBeVisible();
  });
}

for (const format of ["svg", "png"]) {
  test(`fixed-size ${format} keeps its dimensions and fits a narrow preview`, async ({ page }) => {
    const data =
      format === "svg"
        ? svg('width="80" height="60"')
        : await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = 80;
            canvas.height = 60;
            canvas.getContext("2d").fillRect(0, 0, 80, 60);
            return canvas.toDataURL("image/png").split(",")[1];
          });
    const image = await openImage(page, `fixed.${format}`, data);
    const box = await image.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(80);
    expect(box.width).toBeLessThanOrEqual(82);
    expect(box.height).toBeGreaterThanOrEqual(60);
    expect(box.height).toBeLessThanOrEqual(62);
    // Constrain the preview's container itself, independent of dock and sidebar breakpoints.
    await image.evaluate((img) => (img.parentElement.parentElement.style.width = "50px"));
    const narrow = await image.boundingBox();
    expect(narrow.width).toBeGreaterThan(0);
    expect(narrow.width).toBeLessThanOrEqual(50);
    expect(narrow.height).toBeLessThan(box.height);
  });
}
