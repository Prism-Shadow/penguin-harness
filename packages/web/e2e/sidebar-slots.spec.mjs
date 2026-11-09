/**
 * The sidebar as a frame filled from module slots, end to end.
 *
 * - A conversation row's menu carries the session list's own actions with the contributed
 *   messaging binding right after rename, and choosing it opens the binding dialog.
 * - The session list's state lives as long as the sidebar, not as long as its mode: a search
 *   typed in development mode is still there after a round trip through company mode.
 *
 * Company mode is off on a fresh server, so the spec turns the admin master switch on first
 * (company.spec.mjs does the same).
 */
import { test, expect, request } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
// Unique per run: the persisted work mode belongs to the user.
const U = `slots_${Date.now().toString(36)}`;
const P = "password123";
const TITLE = "Slots row alpha";

async function enableCompanyMode() {
  const adminCtx = await request.newContext();
  try {
    await login(adminCtx, ADMIN_ID, ADMIN_PASSWORD);
    const res = await adminCtx.put(`${BASE}/api/admin/settings`, { data: { companyMode: true } });
    expect(res.ok(), "enable company mode").toBeTruthy();
  } finally {
    await adminCtx.dispose();
  }
}

test("sidebar slots: the row menu's contributed entry, and the list surviving a mode switch", async ({
  page,
}) => {
  await enableCompanyMode();
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [{ provider: "custom", modelId: "claude-4-8", apiKey: "sk-mock" }],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const created = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8" } },
  );
  expect(created.ok(), "create session").toBeTruthy();
  const sessionId = (await created.json()).session.sessionId;
  const titled = await page.request.patch(`${BASE}/api/sessions/${sessionId}`, {
    data: { title: TITLE },
  });
  expect(titled.ok(), "title session").toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/chat`);
  const sidebar = page.locator("aside").first();
  const row = sidebar.locator(`[data-session-id="${sessionId}"]`);
  await expect(row).toBeVisible();

  // --- The row menu: the built-in actions, the messaging binding contributed after rename ---
  await row.click({ button: "right" });
  // The row's menu is a portaled panel of plain buttons, top to bottom in menu order.
  const entry = (name) => page.getByRole("button", { name, exact: true });
  const order = ["置顶", "重命名对话", "远程控制", "复制 Session ID", "删除对话"];
  await expect(entry("远程控制")).toBeVisible();
  const tops = [];
  for (const name of order) tops.push((await entry(name).last().boundingBox()).y);
  expect(tops, "menu order: pin, rename, the binding, …, copy id, delete").toEqual(
    [...tops].sort((a, b) => a - b),
  );
  await entry("远程控制").click();
  await expect(page.getByRole("dialog", { name: "远程控制" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "远程控制" })).toHaveCount(0);

  // --- The list's state outlives its mode: search, go to company mode and back ---
  await sidebar.getByRole("button", { name: /^搜索会话/ }).click();
  const search = sidebar.getByRole("searchbox", { name: "搜索会话" });
  await search.fill("alpha");
  await expect(row).toBeVisible();
  const modeSwitch = page.getByRole("group", { name: "工作模式" });
  await modeSwitch.getByRole("button", { name: /^公司/ }).click();
  await expect(page).toHaveURL(/\/org/);
  await expect(row).toHaveCount(0);
  await modeSwitch.getByRole("button", { name: "开发", exact: true }).click();
  await expect(search).toHaveValue("alpha");
  await expect(row).toBeVisible();
});
