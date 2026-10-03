/**
 * Server-contributed pages, end to end against a real server.
 *
 * No plugin on this line contributes a page yet, so the spec answers GET /api/contributions
 * itself (and serves the page's document): one iframe page in the main nav, one with a builtin
 * renderer this build does not carry, and one claiming the Agents page's key.
 *
 * - Only the iframe page joins the nav; opening it draws its document in the content area,
 *   and its URL opened directly lands on it too (the catch-all waits for the answer).
 * - When the request fails, the app is the compiled one: no extra row, and the page's URL
 *   falls through to the chat page.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = `contrib_${Date.now().toString(36)}`;
const P = "password123";
const TEXT = "Hello from a contributed page";

const CONTRIBUTIONS = {
  pages: [
    {
      id: "hello.page",
      from: "HelloModule",
      key: "hello",
      path: "/plugin-hello",
      nav: "main",
      admin: false,
      renderer: { iframe: { src: "/plugin-hello.html", namespace: "hello" } },
    },
    {
      id: "later.page",
      from: "HelloModule",
      key: "later",
      path: "/later",
      nav: "main",
      admin: false,
      renderer: { builtin: "NotBuiltHere" },
    },
    {
      id: "shadow.page",
      from: "HelloModule",
      key: "agents",
      path: "/shadow",
      nav: "main",
      admin: false,
      renderer: { iframe: { src: "/plugin-hello.html", namespace: "shadow" } },
    },
  ],
  agentTabs: [],
  sessionTabs: [],
};

test.beforeEach(async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("**/plugin-hello.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><p>${TEXT}</p></body></html>`,
    }),
  );
});

test("contributions: a server page reaches the nav and draws its iframe", async ({ page }) => {
  await page.route("**/api/contributions", (route) => route.fulfill({ json: CONTRIBUTIONS }));
  await page.goto(`${BASE}/chat`);
  const sidebar = page.locator("aside").first();
  const row = sidebar.locator('a[href="/plugin-hello"]');
  await expect(row).toBeVisible();
  await expect(sidebar.locator('a[href="/later"]')).toHaveCount(0);
  await expect(sidebar.locator('a[href="/shadow"]')).toHaveCount(0);
  await expect(sidebar.locator('a[href="/agents"]')).toHaveCount(1);

  await row.click();
  await expect(page).toHaveURL(/\/plugin-hello$/);
  await expect(page.frameLocator('iframe[title="hello"]').getByText(TEXT)).toBeVisible();

  await page.goto(`${BASE}/plugin-hello`);
  await expect(page.frameLocator('iframe[title="hello"]').getByText(TEXT)).toBeVisible();
  await expect(page).toHaveURL(/\/plugin-hello$/);
});

test("contributions: a failed request leaves the compiled app", async ({ page }) => {
  await page.route("**/api/contributions", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal", message: "boom" } } }),
  );
  await page.goto(`${BASE}/plugin-hello`);
  await expect(page).toHaveURL(/\/chat$/);
  const sidebar = page.locator("aside").first();
  await expect(sidebar.locator('a[href="/agents"]')).toBeVisible();
  await expect(sidebar.locator('a[href="/plugin-hello"]')).toHaveCount(0);
});
