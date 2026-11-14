/**
 * Archived chats: the sidebar lists the user's active conversations only, and the Settings
 * dialog's archive page lists the rest — the conversations archived by hand, and the Sessions a
 * program opened (`penguin run`, here) that nobody kept.
 *
 * Seeded through the API: eleven older `penguin run` Sessions ("Backfill 01" to "Backfill 11"),
 * then three conversations of the user and three more `penguin run` Sessions, every one titled.
 *
 * - The `penguin run` Sessions never reach the sidebar; the conversations do.
 * - Archiving a conversation from its row takes it out of the sidebar; archiving the one on
 *   screen lands on New chat, not on its stub.
 * - The archive page lists the archived conversations and the program's Sessions, each program's
 *   with a CLI pill and each conversation with a User pill; the search and the source filter
 *   narrow the list.
 * - A row's box shows while the row is hovered, and only then: one ticked and unticked again does
 *   not stay painted beside the hovered row's.
 * - Unarchiving a program's Session from its row puts it in the sidebar, wearing its CLI glyph.
 * - Select all chooses the whole group, its second page included; unticking one row keeps the
 *   rest; Deselect all clears it.
 * - Choosing two rows and deleting them asks first, then removes them for good.
 * - A group of more than ten shows ten a page with a pager, in reach on a phone's bottom sheet
 *   too: rows chosen on either page stay chosen across pages, and once the last page's rows are
 *   gone the group steps back to the page before, its pager gone with the second page.
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
  // Older than the rest: they fill the group's second page.
  for (let i = 1; i <= 11; i++)
    await create(`Backfill ${String(i).padStart(2, "0")}`, { source: "cli" });
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
  // Every row names its source in a pill: a program's Session, and a person's conversation too.
  await expect(
    dialog.locator("li", { hasText: "Nightly batch" }).getByText("CLI", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.locator("li", { hasText: "Quarterly report" }).getByText("用户", { exact: true }),
  ).toBeVisible();

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

  // Select all chooses the whole group, the page not shown included; unticking one keeps the
  // rest; Deselect all clears it.
  await dialog.getByRole("button", { name: "全选", exact: true }).click();
  await expect(dialog.getByText("已选 15 项")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消全选", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "选择「Scratch notes」" }).uncheck();
  await expect(dialog.getByText("已选 14 项")).toBeVisible();
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

  // Thirteen left: ten a page, and the pager under them.
  const rowBoxes = dialog.getByRole("checkbox", { name: /^选择「/ });
  await expect(rowBoxes).toHaveCount(10);
  const next = dialog.getByRole("button", { name: "下一页", exact: true });
  const back = dialog.getByRole("button", { name: "上一页", exact: true });
  await expect(dialog.getByText("1/2", { exact: true })).toBeVisible();
  await expect(back).toBeDisabled();
  await expect(dialog.getByText("Backfill 03", { exact: true })).toHaveCount(0);
  await next.click();
  await expect(dialog.getByText("2/2", { exact: true })).toBeVisible();
  for (const title of ["Backfill 03", "Backfill 02", "Backfill 01"]) {
    await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText("Weekly digest", { exact: true })).toHaveCount(0);
  await expect(next).toBeDisabled();
  // On a phone the dialog is a bottom sheet: the pager under ten rows is still in reach.
  await page.setViewportSize({ width: 390, height: 844 });
  await back.click();
  await expect(dialog.getByText("1/2", { exact: true })).toBeVisible();
  await next.click();
  await expect(dialog.getByText("2/2", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  // A row chosen on each page: both stay chosen whichever page shows.
  await dialog.getByRole("checkbox", { name: "选择「Backfill 02」" }).check({ force: true });
  await back.click();
  await dialog.getByRole("checkbox", { name: "选择「Backfill 11」" }).check();
  await expect(dialog.getByText("已选 2 项")).toBeVisible();
  await next.click();
  await expect(dialog.getByRole("checkbox", { name: "选择「Backfill 02」" })).toBeChecked();
  // Unarchived from the second page: the rows below close up, and it still has one.
  await dialog.getByRole("button", { name: "取消归档", exact: true }).first().click();
  await expect(dialog.getByText(/^已选 \d+ 项$/)).toHaveCount(0);
  await expect(dialog.getByText("Backfill 02", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("2/2", { exact: true })).toBeVisible();
  await expect(rowBoxes).toHaveCount(1);

  // Its last row deleted, the second page is gone: back on the first, with no pager.
  await dialog
    .locator("li", { hasText: "Backfill 01" })
    .getByRole("button", { name: /^删除/ })
    .click();
  const confirmOne = page.getByRole("dialog").filter({ hasText: "确定删除「Backfill 01」" });
  await confirmOne.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog.getByText("Weekly digest", { exact: true })).toBeVisible();
  await expect(rowBoxes).toHaveCount(10);
  await expect(next).toHaveCount(0);
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
