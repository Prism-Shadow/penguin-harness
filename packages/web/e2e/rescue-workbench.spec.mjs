/** Route-local render failures and the one app-wide palette on both full-page entry paths.
 * Only the workbench API/iframe are fixtures; the real router, app root and palette mount.
 * A malformed workbench name is rendered by WorkbenchFrame BELOW RouterProvider, unlike
 * rescue.spec.mjs's malformed contributions (which fail above RouterProvider).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const paletteInput = (page) => page.getByPlaceholder("输入以筛选命令…");
const panel = (page) => page.getByRole("alert").filter({ hasText: "界面出错了" });

async function fixture(page) {
  await provisionAndLogin(page.request, `rescue_wb_${Date.now().toString(36)}`, "password123");
  // Keep fixture APIs on HTTP, as in rescue.spec.mjs. Not a socket transport test.
  await page.addInitScript(() => {
    Object.defineProperty(window, "WebSocket", { value: undefined, configurable: true });
  });
  const projects = await page.request.get(`${BASE}/api/projects`);
  expect(projects.ok()).toBeTruthy();
  const project = (await projects.json()).projects[0].projectId;
  const state = { broken: false, requests: 0 };
  await page.route("**/api/contributions", (route) =>
    route.fulfill({ json: { pages: [], agentTabs: [], sessionTabs: [] } }),
  );
  await page.route(`**/api/projects/${project}/agents/default_agent/workbenches`, (route) => {
    state.requests++;
    return route.fulfill({
      json: {
        workbenches: [
          {
            id: "rescue-board",
            name: state.broken ? { routeRenderFailure: true } : "Rescue board",
            revision: "fixture",
            uiRev: "fixture",
            version: null,
            error: null,
            hints: [],
            tabs: [
              {
                id: "rescue-board.main",
                key: "main",
                title: "Rescue board",
                renderer: { iframe: { src: "/rescue-board.html" } },
              },
            ],
          },
        ],
      },
    });
  });
  await page.route("**/rescue-board.html*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><h1>Rescue board frame</h1>",
    }),
  );
  return { project, state, path: `/app/${project}/default_agent/rescue-board/main` };
}

async function openPalette(page) {
  await page.keyboard.press("Control+Shift+KeyP");
  await expect(paletteInput(page)).toHaveCount(1);
  await expect(paletteInput(page)).toBeVisible();
  // All three belong to the SAME open panel, not two instances with split action sets.
  for (const action of [
    "退出全页模式（回到工作台）",
    "Harness 历史",
    "进入安全模式（不加载服务端贡献）",
  ]) {
    await expect(page.getByRole("option", { name: action, exact: true })).toBeVisible();
  }
}

for (const entry of ["direct", "chat"]) {
  test(`full-page workbench: one complete palette via ${entry}`, async ({ page }) => {
    const { project, path } = await fixture(page);
    if (entry === "direct") {
      await page.goto(`${BASE}${path}`);
    } else {
      // Set a model so the fresh-chat credential dialog does not hide the tab bar.
      const response = await page.request.put(`${BASE}/api/projects/${project}/models`, {
        data: {
          defaultModel: { provider: "custom", modelId: "claude-4-8" },
          models: [
            {
              provider: "custom",
              modelId: "claude-4-8",
              apiKey: "sk-mock",
              baseUrl: process.env.MOCK_URL,
              contextWindow: 200000,
            },
          ],
        },
      });
      expect(response.ok()).toBeTruthy();
      await page.goto(`${BASE}/chat/new`);
      await page.getByRole("tab", { name: "Rescue board", exact: true }).click();
      await page.getByRole("button", { name: "占满应用", exact: true }).click();
      await expect(page).toHaveURL(`${BASE}${path}`);
    }
    await expect(
      page.frameLocator("iframe").getByRole("heading", { name: "Rescue board frame" }),
    ).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);
    await openPalette(page);
    await paletteInput(page).fill("harness");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Harness 历史" })).toBeVisible();
    await page.keyboard.press("Escape");
    await openPalette(page);
    await paletteInput(page).fill("exit");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/chat\/new$/);
    // The page's action registration must be gone once it leaves the route.
    await page.keyboard.press("Control+Shift+KeyP");
    await expect(paletteInput(page)).toBeVisible();
    await expect(
      page.getByRole("option", { name: "退出全页模式（回到工作台）", exact: true }),
    ).toHaveCount(0);
  });
}

test("rescue: a route-local render failure reaches the independent rescue panel", async ({
  page,
}) => {
  const { path, state } = await fixture(page);
  state.broken = true;
  await page.goto(`${BASE}${path}`);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText("routeRenderFailure");
  await expect(page.getByText("Unexpected Application Error!")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Harness 历史", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Harness 历史" })).toBeVisible();
  await page.keyboard.press("Escape");
  const before = state.requests;
  await panel(page).getByRole("button", { name: "重新加载", exact: true }).click();
  await expect.poll(() => state.requests).toBeGreaterThan(before);
  await expect(panel(page)).toBeVisible();
  state.broken = false;
  await panel(page).getByRole("button", { name: "不加载贡献重新加载", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "安全模式：未加载服务端贡献" }),
  ).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "Rescue board frame" }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});
