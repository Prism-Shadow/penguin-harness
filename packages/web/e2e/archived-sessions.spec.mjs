/**
 * Archived chats: the sidebar lists the user's active conversations only, and the Settings
 * dialog's archive page lists the rest — the conversations archived by hand, and the Sessions a
 * program opened (`penguin run`, here) that nobody kept.
 *
 * Seeded through the API: three conversations of the user and three `penguin run` Sessions,
 * every one titled.
 *
 * - The `penguin run` Sessions never reach the sidebar; the conversations do.
 * - Archiving a conversation from its row takes it out of the sidebar; archiving the one on
 *   screen lands on New chat, not on its stub.
 * - The archive page lists the archived conversations and the program's Sessions, each program's
 *   with a CLI pill; the search and the source filter narrow the list.
 * - A row's box shows while the row is hovered, and only then: one ticked and unticked again does
 *   not stay painted beside the hovered row's.
 * - Unarchiving a program's Session from its row puts it in the sidebar, wearing its CLI glyph.
 * - Select all chooses the whole group; unticking one row keeps the rest; Deselect all clears it.
 * - Choosing two rows and deleting them asks first, then removes them for good.
 * - An archived Session's URL shows its stub — title, time, source — and unarchiving there loads
 *   the conversation in place and returns it to the sidebar.
 *
 * Standalone spec: shares one server with the other specs, so it registers its own user.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

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
  const scratch = await create("Scratch notes");
  await create("Release checklist");
  await create("Nightly batch", { source: "cli" });
  await create("Index rebuild", { source: "cli" });
  const digest = await create("Weekly digest", { source: "cli" });

  await setAccountPrefs(page.request, { lang: "zh" });
  await page.goto(`${BASE}/chat`);
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText("Quarterly report")).toBeVisible();
  await expect(sidebar.getByText("Release checklist")).toBeVisible();
  // What `penguin run` opened is archived until kept: never in the sidebar.
  for (const title of ["Nightly batch", "Index rebuild", "Weekly digest"]) {
    await expect(sidebar.getByText(title)).toHaveCount(0);
  }

  // Archive a conversation from its row.
  const archiveRow = async (title) => {
    const row = sidebar.locator("li", { hasText: title });
    await row.hover();
    await row.getByRole("button", { name: "更多操作" }).click();
    // The menu's item carries its word; the row's own hover button only an aria-label.
    await page
      .getByRole("button", { name: "归档", exact: true })
      .filter({ hasText: "归档" })
      .click();
    await expect(sidebar.getByText(title)).toHaveCount(0);
  };
  await archiveRow("Quarterly report");

  // Archiving the conversation on screen lands on New chat, not on its stub.
  await page.goto(`${BASE}/chat/${scratch}`);
  await expect(page).toHaveURL(new RegExp(scratch));
  await archiveRow("Scratch notes");
  await expect(page).toHaveURL(/\/chat\/new$/);
  await expect(
    page.getByText("这个对话已归档。取消归档后可以查看内容，它会回到左侧列表。"),
  ).toHaveCount(0);

  // Settings › 已归档对话.
  // The account menu (the Project switcher beside it carries the same name, and no popup).
  await sidebar.getByRole("button", { name: new RegExp(U), expanded: false }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "已归档对话" }).click();
  const dialog = page.getByRole("dialog");
  for (const title of [
    "Quarterly report",
    "Scratch notes",
    "Nightly batch",
    "Index rebuild",
    "Weekly digest",
  ]) {
    await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText("Release checklist")).toHaveCount(0);
  // A program's Session names its source in a pill; a person's conversation carries none.
  await expect(
    dialog.locator("li", { hasText: "Nightly batch" }).getByText("CLI", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("li", { hasText: "Quarterly report" }).getByText("用户")).toHaveCount(
    0,
  );

  // A row's box shows while its row is hovered, and only then — not after it was ticked and
  // unticked, beside the next hovered row's.
  const paintedBoxes = () =>
    dialog.evaluate(
      (root) =>
        [...root.querySelectorAll('input[type="checkbox"]')].filter((box) => {
          for (let el = box; el && el !== root; el = el.parentElement) {
            if (Number(getComputedStyle(el).opacity) < 0.5) return false;
          }
          return true;
        }).length,
    );
  const nightlyBox = dialog.getByRole("checkbox", { name: "选择「Nightly batch」" });
  await dialog.locator("li", { hasText: "Nightly batch" }).hover();
  await nightlyBox.check();
  await nightlyBox.uncheck();
  await dialog.locator("li", { hasText: "Weekly digest" }).hover();
  await expect.poll(paintedBoxes).toBe(1);
  await page.mouse.move(0, 0);
  await expect.poll(paintedBoxes).toBe(0);

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

  // Select all chooses the whole group; unticking one keeps the rest; Deselect all clears it.
  await dialog.getByRole("button", { name: "全选", exact: true }).click();
  await expect(dialog.getByText("已选 4 项")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消全选", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "选择「Scratch notes」" }).uncheck();
  await expect(dialog.getByText("已选 3 项")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "选择「Weekly digest」" })).toBeChecked();
  await dialog.getByRole("button", { name: "全选", exact: true }).click();
  await dialog.getByRole("button", { name: "取消全选", exact: true }).click();
  await expect(dialog.getByText(/^已选 \d+ 项$/)).toHaveCount(0);

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
