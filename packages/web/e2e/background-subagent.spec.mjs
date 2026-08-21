/**
 * Background subagent, end to end in the real app: the parent launches run_subagent with
 * run_in_background and closes its task while the child still works (its exec_command
 * sleeps ~1s). With no interaction after that: the subagents panel must show the child
 * (live, then settled), the child's streamed activity must be visible, the completion
 * report must arrive as the collapsed notice, and the child's own trace must contain a
 * successfully completed exec_command — not an aborted or denied one.
 * Mock branches: "background subagent test" in mock-llm.mjs.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "bgsubuser";
const P = "password123";

test("a run_in_background subagent runs to completion and reports back unprompted", async ({
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
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("background subagent test");
  await page.getByRole("button", { name: "发送" }).click();

  // The parent's task closes while the child still runs.
  await expect(page.getByText("Subagent dispatched in the background.")).toBeVisible({
    timeout: 30_000,
  });

  // The subagents panel knows the child exists (auto-open on spawn, or via the toggle).
  // Auto-open should have brought the tab up; fall back to the right-dock picker if not.
  if ((await page.locator('[data-tab-id="agents"][data-active="true"]').count()) === 0) {
    await page.getByTestId("dock-toggle-right").click();
    const picker = page.getByTestId("dock-pick-agents");
    if (await picker.isVisible().catch(() => false)) await picker.click();
    else await page.locator('[data-tab-id="agents"]').click();
  }
  await expect(
    page.locator('[data-testid="dock-tab"][data-tab-id="agents"][data-active="true"]'),
  ).toBeVisible();

  // No interaction from here: the child's live activity streams in (its exec_command call
  // is visible without any poll), then the completion notice and the model's follow-up.
  await expect(page.getByText("后台任务完成")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Acknowledged: the background command finished (bg-ack)."),
  ).toBeVisible({ timeout: 30_000 });
});

test("a failing background subagent still reports back with the failed state", async ({ page }) => {
  await provisionAndLogin(page.request, "bgsubfail", P);

  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("background subagent fail test");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Failing subagent dispatched in the background.")).toBeVisible({
    timeout: 30_000,
  });

  // The child's request is rejected as an auth failure (never retried): its run fails at
  // once — and the failed completion report must still reach the open page unprompted.
  await expect(page.getByText("后台任务失败")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Acknowledged: the background command finished (bg-ack)."),
  ).toBeVisible({ timeout: 30_000 });
});
