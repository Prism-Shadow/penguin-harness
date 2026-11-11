/**
 * The way back when the UI breaks, end to end against a real server.
 *
 * The spec answers GET /api/contributions itself. A malformed answer — a `null` page entry —
 * makes the contributions merge throw while the shell renders: a real way for what the server
 * contributes to break the page (the merge trusts the answer's shape; should it ever validate,
 * this spec needs another real throw).
 *
 * - The broken page shows the rescue panel; the command palette still opens over it
 *   (Ctrl+Shift+P) and reaches the harness history. "Reload without contributions" brings the
 *   app back in safe mode: marked, no contributions request, kept across an in-app navigation
 *   and a reload. Leaving safe mode from the marker asks again, and the panel is back.
 * - `?safe` opens the app without contributions and drops the parameter; leaving from the
 *   palette brings the contributed page into the nav.
 * - The palette chord opens the palette over an open dialog.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = `rescue_${Date.now().toString(36)}`;
const P = "password123";

const EMPTY = { agentTabs: [], sessionTabs: [] };
const BROKEN = { pages: [null], ...EMPTY };
const HELLO = {
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
  ],
  ...EMPTY,
};

/** Answers the contributions request with `body` and counts the requests. */
async function answerContributions(page, body) {
  const seen = { count: 0 };
  await page.route("**/api/contributions", (route) => {
    seen.count++;
    return route.fulfill({ json: body });
  });
  return seen;
}

const marker = (page) => page.getByRole("status").filter({ hasText: "安全模式：未加载服务端贡献" });
const rescuePanel = (page) => page.getByRole("alert").filter({ hasText: "界面出错了" });

test.beforeEach(async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  // While the page's socket is open the API rides it (api/client.ts), out of `page.route`'s
  // reach; without a WebSocket every call is a fetch, so the spec can answer the contributions.
  await page.addInitScript(() => {
    Object.defineProperty(window, "WebSocket", { value: undefined, configurable: true });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("rescue: a broken contribution answer shows the panel, and safe mode recovers", async ({
  page,
}) => {
  const seen = await answerContributions(page, BROKEN);
  // Not /chat: a fresh user's chat page opens the "no model credential" dialog.
  await page.goto(`${BASE}/agents`);
  await expect(rescuePanel(page)).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);

  // The palette lives outside the broken tree.
  await page.keyboard.press("Control+Shift+KeyP");
  const palette = page.getByPlaceholder("输入以筛选命令…");
  await expect(palette).toBeVisible();
  await palette.fill("harness");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Harness 历史" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Harness 历史" })).toHaveCount(0);

  const before = seen.count;
  await page.getByRole("button", { name: "不加载贡献重新加载" }).click();
  const sidebar = page.locator("aside").first();
  await expect(sidebar.locator('a[href="/agents"]')).toBeVisible();
  await expect(marker(page)).toBeVisible();
  expect(seen.count).toBe(before);

  // Safe mode holds across an in-app navigation and a reload.
  await sidebar.locator('a[href="/models"]').click();
  await expect(page).toHaveURL(/\/models$/);
  await expect(marker(page)).toBeVisible();
  await page.reload();
  await expect(sidebar.locator('a[href="/agents"]')).toBeVisible();
  await expect(marker(page)).toBeVisible();
  expect(seen.count).toBe(before);

  // Leaving asks the server again, and the broken answer breaks the page again.
  await marker(page).getByRole("button", { name: "离开安全模式", exact: true }).click();
  await expect(rescuePanel(page)).toBeVisible();
  await expect(marker(page)).toHaveCount(0);
  expect(seen.count).toBe(before + 1);
});

test("rescue: ?safe opens the app without contributions, and the palette leaves it", async ({
  page,
}) => {
  const seen = await answerContributions(page, HELLO);
  await page.goto(`${BASE}/agents?safe`);
  await expect(page).toHaveURL(/\/agents$/);
  await expect(marker(page)).toBeVisible();
  const sidebar = page.locator("aside").first();
  await expect(sidebar.locator('a[href="/agents"]')).toBeVisible();
  await expect(sidebar.locator('a[href="/plugin-hello"]')).toHaveCount(0);
  expect(seen.count).toBe(0);

  await page.keyboard.press("Control+Shift+KeyP");
  await page.getByPlaceholder("输入以筛选命令…").fill("safe mode");
  await page.keyboard.press("Enter");
  await expect(marker(page)).toHaveCount(0);
  await expect(sidebar.locator('a[href="/plugin-hello"]')).toBeVisible();
  expect(seen.count).toBe(1);
});

test("rescue: the palette chord opens the palette over an open dialog", async ({ page }) => {
  await answerContributions(page, { pages: [], ...EMPTY });
  // A fresh user's chat page opens the "no model credential" dialog.
  await page.goto(`${BASE}/chat`);
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await page.keyboard.press("Control+Shift+KeyP");
  await expect(page.getByPlaceholder("输入以筛选命令…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("输入以筛选命令…")).toHaveCount(0);
  await expect(page.getByRole("dialog").first()).toBeVisible();
});
