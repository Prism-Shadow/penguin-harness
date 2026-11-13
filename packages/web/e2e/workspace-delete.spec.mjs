/**
 * Every Workspace group that is one directory can be renamed and deleted — not only one added
 * by hand. Deleting archives the group's active conversations, the ones the sidebar has not
 * loaded included, and unarchiving any of them brings the group back.
 *
 * Seeded through the API: one conversation in "wsdel-beta", then eleven in "wsdel-alpha" (more
 * than a group shows at once), every one titled. Neither Workspace was added by hand.
 *
 * - The More menu of a group formed by its conversations offers Rename workspace and Delete
 *   workspace.
 * - A rename survives a reload.
 * - The delete confirmation names all eleven conversations; confirming takes the group off the
 *   sidebar and a toast counts the archived ones, and the other Workspace stays.
 * - Settings › Archived chats lists the eleven under that Workspace.
 * - Unarchiving one brings the group back under its directory name, with that one conversation.
 *
 * Standalone spec: shares one server with the other specs, so it registers its own user.
 */
import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = `wsdeleteuser${process.pid}`;
const P = "password123";

/** One group's block in the sidebar, located by its label. */
const groupBlock = (sidebar, label) =>
  sidebar.locator('div[class*="relative pt-2.5"]').filter({ hasText: label });

test("a Workspace formed by its conversations is renamed, deleted, and comes back when one is unarchived", async ({
  page,
}) => {
  // Real directories: a Workspace is validated by realpath and must exist.
  const root = await mkdtemp(join(tmpdir(), "penguin-wsdel-"));
  const alpha = join(root, "wsdel-alpha");
  const beta = join(root, "wsdel-beta");
  await mkdir(alpha);
  await mkdir(beta);

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
  const create = async (workspace, title) => {
    const res = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      { data: { workspace } },
    );
    expect(res.ok(), `create ${title}: ${await res.text()}`).toBeTruthy();
    const { session } = await res.json();
    const renamed = await page.request.patch(`${BASE}/api/sessions/${session.sessionId}`, {
      data: { title },
    });
    expect(renamed.ok(), `rename ${title}`).toBeTruthy();
  };
  await create(beta, "Beta 01");
  for (let i = 1; i <= 11; i++) await create(alpha, `Alpha ${String(i).padStart(2, "0")}`);

  await setAccountPrefs(page.request, { lang: "zh" });
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(`${BASE}/chat`);
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText("wsdel-alpha", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("wsdel-beta", { exact: true })).toBeVisible();

  const openMenu = async (label) => {
    const block = groupBlock(sidebar, label);
    await block.hover();
    await block.getByRole("button", { name: "工作区选项" }).click();
  };

  // A group formed by its conversations offers both, and the rename survives a reload.
  await openMenu("wsdel-alpha");
  await expect(page.getByRole("menuitem", { name: "删除工作区" })).toBeVisible();
  await page.getByRole("menuitem", { name: "重命名工作区" }).click();
  const rename = page.getByRole("dialog").filter({ hasText: "重命名工作区" });
  await rename.getByLabel("名称").fill("Alpha project");
  await rename.getByRole("button", { name: "保存", exact: true }).click();
  await expect(sidebar.getByText("Alpha project", { exact: true })).toBeVisible();
  await page.reload();
  await expect(sidebar.getByText("Alpha project", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("wsdel-alpha", { exact: true })).toHaveCount(0);

  // The delete names all eleven, the ten on screen and the one behind "show more".
  await openMenu("Alpha project");
  await page.getByRole("menuitem", { name: "删除工作区" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "其中的 11 个对话将被归档" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("已归档 11 个对话", { exact: false })).toBeVisible();
  await expect(sidebar.getByText("Alpha project", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Alpha 01")).toHaveCount(0);
  await expect(sidebar.getByText("Beta 01")).toBeVisible();

  // Settings › 已归档对话 lists the eleven under their Workspace.
  await sidebar.getByRole("button", { name: new RegExp(U), expanded: false }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "已归档对话", exact: true }).click();
  const settings = page.getByRole("dialog");
  const archivedGroup = settings.locator("section").filter({ hasText: "wsdel-alpha" });
  await expect(archivedGroup.getByText("11 条对话")).toBeVisible();

  // Unarchiving one brings the group back, under its directory name, with that conversation.
  await archivedGroup
    .locator("li", { hasText: "Alpha 11" })
    .getByRole("button", { name: "取消归档" })
    .click();
  await expect(archivedGroup.getByText("10 条对话")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(sidebar.getByText("wsdel-alpha", { exact: true })).toBeVisible();
  await expect(groupBlock(sidebar, "wsdel-alpha").locator("li")).toHaveCount(1);
  await expect(sidebar.getByText("Alpha 11")).toBeVisible();
});
