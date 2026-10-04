/**
 * A real plugin removes a page, end to end: nothing here is intercepted.
 *
 * run.sh runs this spec in a plugin set of its own ("no-evaluation-center"): a server whose
 * default_project enables plugins/example-no-evaluation-center, which removes the page keyed
 * `benchmark`, and plugins/example-hello-page, whose Hello World page sits under it. What a
 * Project lists is loaded for the whole server, so no other spec runs against this one.
 *
 * - The server's answer carries the removal and the Hello World page; the Evaluation Center has
 *   no row in the sidebar or the collapsed rail, nor has the page under it.
 * - /benchmark, one Benchmark's /benchmark/<id> and the child's path all fall to the catch-all.
 * - With `?safe` nothing is read from the server: the Evaluation Center is back and opens; leaving
 *   safe mode removes it again, and the open page falls to the catch-all.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = `noeval_${Date.now().toString(36)}`;
const P = "password123";
const CHILD = "/example-hello";

// The catch-all leads to /chat, which a fresh user's chat page turns into /chat/new.
const AT_CHAT = /\/chat(\/new)?$/;
const marker = (page) => page.getByRole("status").filter({ hasText: "安全模式：未加载服务端贡献" });

test.beforeEach(async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("page removal: the plugin removes the Evaluation Center, its routes and the page under it", async ({
  page,
}) => {
  // Asked here rather than watched: the app's own API calls ride its socket, which a response
  // listener does not see. The request shares the signed-in page's cookies.
  const body = await (await page.request.get(`${BASE}/api/contributions`)).json();
  expect(body.pageRemovals.map((r) => r.key)).toEqual(["benchmark"]);
  expect(body.pages.map((p) => p.key)).toContain("example-hello");
  // Not /chat: a fresh user's chat page opens the "no model credential" dialog over the nav.
  await page.goto(`${BASE}/agents`);

  const sidebar = page.locator("aside").first();
  await expect(sidebar.locator('a[href="/agents"]')).toBeVisible();
  await expect(sidebar.locator('a[href="/benchmark"]')).toHaveCount(0);
  await expect(sidebar.locator(`a[href="${CHILD}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: "收起侧栏" }).click();
  const rail = page.locator("aside nav");
  await expect(rail.locator('a[href="/agents"]')).toBeVisible();
  await expect(rail.locator('a[href="/benchmark"]')).toHaveCount(0);

  for (const path of ["/benchmark", "/benchmark/some-benchmark", CHILD]) {
    await page.goto(`${BASE}${path}`);
    await expect(page, path).toHaveURL(AT_CHAT);
  }
});

test("page removal: safe mode brings the Evaluation Center back, leaving it removes it again", async ({
  page,
}) => {
  await page.goto(`${BASE}/agents?safe`);
  await expect(marker(page)).toBeVisible();
  const sidebar = page.locator("aside").first();
  await expect(sidebar.locator('a[href="/benchmark"]')).toBeVisible();
  await expect(sidebar.locator(`a[href="${CHILD}"]`)).toHaveCount(0);

  await sidebar.locator('a[href="/benchmark"]').click();
  await expect(page).toHaveURL(/\/benchmark$/);
  await expect(sidebar.locator('a[href="/benchmark"]')).toHaveAttribute("aria-current", "page");

  await marker(page).getByRole("button", { name: "离开安全模式", exact: true }).click();
  await expect(marker(page)).toHaveCount(0);
  await expect(page).toHaveURL(AT_CHAT);
  await expect(sidebar.locator('a[href="/benchmark"]')).toHaveCount(0);
});
