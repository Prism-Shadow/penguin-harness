/**
 * Workspace removal through the real sidebar, server and shared mock LLM.
 *
 * - Given a group with no registration (including one affected by the old Remove bug),
 *   Remove remains available; cancelling keeps the group, and confirming hides it.
 * - Given a manually added Workspace with completed conversation history, removing it and
 *   reloading hides its group without archiving/deleting the conversation or changing files.
 * - With more than one page of groups, adding the directory again reveals its pinned group
 *   and original history; a second reload and removal work as well.
 */
import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

test("removing and re-adding a Workspace preserves its conversations and files", async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), "penguin-remove-workspace-"));
  const marker = join(workspace, "keep.txt");
  await writeFile(marker, "Keep this file and the conversation.");
  try {
    await provisionAndLogin(page.request, "workspaceremoval", "password123");
    await setAccountPrefs(page.request, { lang: "en" });
    await page.addInitScript(() => localStorage.setItem("penguin.sidebarGroupMode", "workspace"));
    const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
    const projectId = projects.projects[0].projectId;
    const models = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
    expect(models.ok(), await models.text()).toBeTruthy();
    const created = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      {
        data: { workspace, approvalMode: "allow-all" },
      },
    );
    expect(created.ok(), await created.text()).toBeTruthy();
    const sessionId = (await created.json()).session.sessionId;
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${BASE}/chat/${sessionId}`);

    const sidebar = page.getByRole("complementary");
    const group = sidebar
      .locator('div[class*="relative pt-2.5"]')
      .filter({ has: page.getByText(basename(workspace), { exact: true }) });
    const row = sidebar.locator(`[data-session-id="${sessionId}"]`);
    const remove = async () => {
      await group.getByRole("button", { name: "Workspace options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Remove workspace", exact: true }).click();
    };
    const add = async () => {
      await sidebar.getByRole("button", { name: "New workspace", exact: true }).click();
      const finder = page.getByRole("dialog");
      await finder.getByRole("button", { name: "Edit path", exact: true }).click();
      const path = finder.getByRole("textbox", { name: "Path", exact: true });
      await path.fill(workspace);
      await path.press("Enter");
      const choose = finder.getByRole("button", { name: "Choose", exact: true });
      await expect(choose).toHaveAttribute("data-tooltip", workspace);
      await choose.click();
      await expect(row).toBeVisible();
    };

    // This group came from a conversation, with no local registration for Remove to depend on.
    await expect(row).toBeVisible();
    await remove();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(row).toBeVisible();
    await remove();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(group).toHaveCount(0);
    await add();

    const prompt = "Keep this conversation when its workspace is removed.";
    const reply = "Command finished; the result looks as expected.";
    await page.getByPlaceholder(/Type a message/).fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    const messages = async () =>
      (await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json())
        .messages;
    const before = await messages();
    expect(before.length).toBeGreaterThan(0);

    // A restored group can belong before the last page: keep its pin and reveal that page.
    await group.getByRole("button", { name: "Pin group", exact: true }).click();
    for (let i = 0; i < 11; i++) {
      const other = join(workspace, `other-${i}`);
      await mkdir(other);
      const result = await page.request.post(
        `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
        { data: { workspace: other } },
      );
      expect(result.ok(), await result.text()).toBeTruthy();
    }
    await page.reload();
    await expect(row).toBeVisible();

    await remove();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(group).toHaveCount(0);
    await page.reload();
    await expect(sidebar.getByRole("button", { name: "New workspace", exact: true })).toBeVisible();
    await expect(group).toHaveCount(0);
    expect(await messages()).toEqual(before);
    const sessions = await (
      await page.request.get(
        `${BASE}/api/projects/${projectId}/agents/default_agent/sessions?category=active`,
      )
    ).json();
    expect(sessions.sessions.map((s) => s.sessionId)).toContain(sessionId);
    expect(await readFile(marker, "utf8")).toBe("Keep this file and the conversation.");

    await add();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`));
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1);
    await page.reload();
    await expect(row).toBeVisible();
    expect(await messages()).toEqual(before);
    await remove();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(group).toHaveCount(0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
