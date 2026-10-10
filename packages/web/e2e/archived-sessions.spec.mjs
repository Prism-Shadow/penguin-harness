/**
 * Archived chats: the sidebar lists the user's active conversations only, and the Settings
 * dialog's archive page lists the rest — the conversations archived by hand, and the Sessions a
 * program opened (`penguin run`, here) that nobody kept.
 *
 * Seeded through the API: two conversations of the user and three `penguin run` Sessions,
 * every one titled.
 *
 * - The `penguin run` Sessions never reach the sidebar; the conversations do.
 * - Archiving a conversation from its row takes it out of the sidebar.
 * - The archive page lists the archived conversation and the program's Sessions; the search
 *   and the source filter narrow the list.
 * - Unarchiving a program's Session from its row puts it in the sidebar, wearing its CLI glyph.
 * - Choosing two rows and deleting them asks first, then removes them for good.
 * - An archived Session's URL shows its stub — title, time, source — and unarchiving there loads
 *   the conversation in place and returns it to the sidebar.
 *
 * Standalone spec: shares one server with the other specs, so it registers its own user.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = `archiveuser${process.pid}`;
const P = "password123";

test("archived chats live on the Settings page, and an archived URL shows its stub", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const create = async (title, data = {}) => {
    const res = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      { data },
    );
    expect(res.ok(), `create ${title}: ${await res.text()}`).toBeTruthy();
    const { session } = await res.json();
    const renamed = await page.request.patch(`${BASE}/api/sessions/${session.sessionId}`, {
      data: { title },
    });
    expect(renamed.ok(), `rename ${title}`).toBeTruthy();
    return session.sessionId;
  };
  await create("Quarterly report");
  await create("Release checklist");
  await create("Nightly batch", { source: "cli" });
  await create("Index rebuild", { source: "cli" });
  const digest = await create("Weekly digest", { source: "cli" });

  await page.addInitScript(() => localStorage.setItem("penguin.lang", "zh"));
  await page.goto(`${BASE}/chat`);
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText("Quarterly report")).toBeVisible();
  await expect(sidebar.getByText("Release checklist")).toBeVisible();
  // What `penguin run` opened is archived until kept: never in the sidebar.
  for (const title of ["Nightly batch", "Index rebuild", "Weekly digest"]) {
    await expect(sidebar.getByText(title)).toHaveCount(0);
  }

  // Archive a conversation from its row.
  const report = sidebar.locator("li", { hasText: "Quarterly report" });
  await report.hover();
  await report.getByRole("button", { name: "更多操作" }).click();
  // The menu's item carries its word; the row's own hover button only an aria-label.
  await page.getByRole("button", { name: "归档", exact: true }).filter({ hasText: "归档" }).click();
  await expect(sidebar.getByText("Quarterly report")).toHaveCount(0);

  // Settings › 已归档对话.
  // The account menu (the Project switcher beside it carries the same name, and no popup).
  await sidebar.getByRole("button", { name: new RegExp(U), expanded: false }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "已归档对话" }).click();
  const dialog = page.getByRole("dialog");
  for (const title of ["Quarterly report", "Nightly batch", "Index rebuild", "Weekly digest"]) {
    await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText("Release checklist")).toHaveCount(0);

  // The search narrows by title; the source filter by who opened it.
  const search = dialog.getByPlaceholder("搜索已归档对话");
  await search.fill("nightly");
  await expect(dialog.getByText("Nightly batch", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Index rebuild", { exact: true })).toHaveCount(0);
  await search.fill("");
  await dialog.getByRole("button", { name: "来源" }).click();
  await page.getByRole("option", { name: "用户" }).click();
  await expect(dialog.getByText("Quarterly report", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Nightly batch", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "来源" }).click();
  await page.getByRole("option", { name: "全部来源" }).click();
  await expect(dialog.getByText("Nightly batch", { exact: true })).toBeVisible();

  // Unarchive one of the program's Sessions: it joins the sidebar, with its CLI mark.
  const rebuild = dialog.locator("li", { hasText: "Index rebuild" });
  await rebuild.getByRole("button", { name: "取消归档" }).click();
  await expect(dialog.getByText("Index rebuild", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Index rebuild")).toBeVisible();

  // Choose two rows and delete them: asked first, then gone.
  await dialog.getByRole("checkbox", { name: "选择「Quarterly report」" }).check({ force: true });
  await dialog.getByRole("checkbox", { name: "选择「Nightly batch」" }).check({ force: true });
  await expect(dialog.getByText("已选 2 项")).toBeVisible();
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "确定删除这 2 个对话" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog.getByText("Quarterly report", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Nightly batch", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Weekly digest", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // An archived Session's URL: the stub, then the conversation once unarchived.
  await page.goto(`${BASE}/chat/${digest}`);
  await expect(page.getByRole("heading", { name: "Weekly digest", level: 2 })).toBeVisible();
  await expect(
    page.getByText("这个对话已归档。取消归档后可以查看内容，它会回到左侧列表。"),
  ).toBeVisible();
  await expect(page.getByPlaceholder(/输入消息/)).toHaveCount(0);
  await page.getByRole("button", { name: "取消归档" }).click();
  await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();
  await expect(sidebar.getByText("Weekly digest")).toBeVisible();
});
