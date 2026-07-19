/**
 * Regression: clicking the "currently selected" Project in the Project dropdown must not clear
 * the Agent list and the Sessions under it.
 *
 * Old bug: setCurrentProjectId unconditionally called setAgents([]) + setAgentsLoading(true),
 * while currentProjectId itself didn't change — reloadAgents' effect depends on it and wouldn't
 * re-run, so the sidebar's Agents and the Sessions hanging under them would all disappear and
 * never come back (reproducible by simply clicking the current Project in the dropdown).
 *
 * A Project is deliberately created with a display name different from the username: a newly
 * registered user's initial Project display name defaults to the username, and the bottom-left
 * user menu also shows the username, so locating by name would match both.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "projswitcher";
const P = "password123";
const PROJ = "SwitchTarget";

test("下拉里点当前 Project：Agent 与 Session 列表不消失", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);

  const initial = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0];

  // A non-admin's Project id must be prefixed with <username>-.
  const created = await page.request.post(`${BASE}/api/projects`, {
    data: { projectId: `${U}-target`, name: PROJ },
  });
  expect(created.ok(), "create project").toBeTruthy();
  const projectId = (await created.json()).project.projectId;

  // Configure Model + credentials on both Projects: a Project without credentials pops an
  // onboarding overlay (fixed inset-0) as soon as the page loads, which would block every click on the sidebar.
  for (const id of [initial.projectId, projectId]) {
    const put = await page.request.put(`${BASE}/api/projects/${id}/models`, {
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
    expect(put.ok(), `put models ${id}`).toBeTruthy();
  }

  await page.goto("/");

  // First wait for the initial Project's sidebar to settle: during this time it fetches the
  // Agent list and lands on the draft page (the brand heading marks the draft page); operating
  // the dropdown midway through would get closed by a subsequent re-render.
  const generalAgent = page.getByText("General Agent").first();
  const draftTitle = page.getByRole("heading", { name: "PenguinHarness" });
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // Switch to this newly created Project (a different id: takes the normal switch path).
  const byName = page.getByRole("button", { name: PROJ });
  await page.getByRole("button", { name: U }).first().click(); // the initial Project's display name defaults to the username
  await byName.first().click();

  // Wait for the new Project's sidebar to settle too (Agent list + draft page).
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // The key action: click this "currently selected" Project again in the dropdown.
  await byName.first().click(); // the top trigger button (currently displaying PROJ)
  await expect(byName).toHaveCount(2); // the trigger button + the same-named item in the menu
  await byName.nth(1).click();

  // The regression point: both the Agent and the draft page are still there (before the fix,
  // these two assertions would fail — the sidebar gets cleared and stuck in loading).
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // —— Regression (#74 comment): switching Project on the skill library page must not leave
  // installation state from the previous Project —— both Projects' default_agent share the same
  // name (agentId is the page state table's key): first uninstall agent-creation from the current
  // (target) Project via the API, then switch over from the initial Project's skill library page
  // — before the fix, the old Project's snapshot would overwrite the freshly fetched data, so
  // "Manage installation" would always show "Installed."
  const del = await page.request.delete(
    `${BASE}/api/projects/${projectId}/agents/default_agent/skills/agent-creation`,
  );
  expect(del.ok(), "uninstall agent-creation on target project").toBeTruthy();

  // Switch back to the initial Project, populating the skill library page's snapshot (default_agent has everything preinstalled -> Installed).
  await byName.first().click();
  await page.getByRole("button", { name: U }).first().click();
  await expect(generalAgent).toBeVisible();
  await page.getByRole("link", { name: "技能库" }).click();
  await expect(page).toHaveURL(/\/skills$/);
  await page.getByRole("button", { name: "管理安装 agent-creation" }).click();
  await expect(page.getByRole("button", { name: "卸载 default_agent" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Staying on the skill library page while switching to target: the same-named default_agent's state must flip to "Install" (not installed).
  await page.getByRole("button", { name: U }).first().click();
  await byName.first().click();
  await page.getByRole("button", { name: "管理安装 agent-creation" }).click();
  await expect(page.getByRole("button", { name: "安装 default_agent" })).toBeVisible();
  await page.keyboard.press("Escape");
});
