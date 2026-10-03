/**
 * A real plugin's page, end to end: nothing here is intercepted.
 *
 * run.sh enables plugins/example-hello-page for default_project before the server starts (its
 * built entry by absolute path in `.project_config.toml`). What a Project lists is loaded for
 * the whole server, so this spec's own user sees the page too: the server answers
 * GET /api/contributions with it and serves its document from the plugin's `ui/`.
 *
 * - The row sits indented directly under the Evaluation Center, named in Chinese and in English.
 * - Opening it draws the plugin's document; its button shows "Hello World".
 * - The collapsed rail draws no row for it and lights the Evaluation Center while it is open.
 * - With `?safe` the row is gone and its path is not routed.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = `plugpage_${Date.now().toString(36)}`;
const P = "password123";
const PATH = "/example-hello";

test.beforeEach(async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("plugin page: a row under the Evaluation Center opens the plugin's own page", async ({
  page,
}) => {
  // Not /chat: a fresh user's chat page opens the "no model credential" dialog over the nav.
  await page.goto(`${BASE}/agents`);
  const sidebar = page.locator("aside").first();
  const parent = sidebar.locator('a[href="/benchmark"]');
  const row = sidebar.locator(`a[href="${PATH}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveText("你好世界");

  // Directly below its parent, and indented.
  const [p, r] = [await parent.boundingBox(), await row.boundingBox()];
  expect(r.x, "indented under the parent").toBeGreaterThan(p.x);
  expect(r.y, "below the parent").toBeGreaterThan(p.y);
  expect(r.y - (p.y + p.height), "nothing between them").toBeLessThan(4);

  await row.click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  const frame = page.frameLocator('iframe[title="Hello World"]');
  await expect(frame.getByRole("button", { name: "Say hello" })).toBeVisible();
  await expect(frame.getByText("Hello World", { exact: true })).toHaveCount(0);
  await frame.getByRole("button", { name: "Say hello" }).click();
  await expect(frame.getByText("Hello World", { exact: true })).toBeVisible();

  // The collapsed rail: no row of its own, the parent lit while it is open.
  await page.getByRole("button", { name: "收起侧栏" }).click();
  const rail = page.locator("aside nav");
  await expect(rail.locator(`a[href="${PATH}"]`)).toHaveCount(0);
  await expect(rail.locator('a[href="/benchmark"]')).toHaveAttribute("aria-current", "page");
});

test("plugin page: the row is named in English too", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await page.goto(`${BASE}/agents`);
  await expect(page.locator("aside").first().locator(`a[href="${PATH}"]`)).toHaveText(
    "Hello World",
  );
});

test("plugin page: safe mode drops the row and the route", async ({ page }) => {
  await page.goto(`${BASE}/agents?safe`);
  const sidebar = page.locator("aside").first();
  await expect(sidebar.locator('a[href="/benchmark"]')).toBeVisible();
  await expect(sidebar.locator(`a[href="${PATH}"]`)).toHaveCount(0);
  await page.goto(`${BASE}${PATH}`);
  await expect(page).toHaveURL(/\/chat$/);
});
