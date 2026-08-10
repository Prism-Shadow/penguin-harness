/**
 * Session background-process list (details popover):
 * a task whose exec_command outlives its yield window becomes a background process —
 * the header's stats trigger gains a running-services count, the details card lists the
 * process (cmd + pid + start time) with a stop button, stopping it clears both, and the
 * card's other rows (model / workspace / created / per-line stats / trace file path)
 * render in their new layout. The mock's "background server test" branch drives it
 * (`sleep 600` with a 300ms yield — see mock-llm.mjs).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "procuser";
const P = "password123";

test("background process appears in the details card and can be stopped", async ({ page }) => {
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

  // allow-all: the exec runs without a manual approval stop.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("background server test");
  await page.getByRole("button", { name: "发送" }).click();

  // The turn finishes with the command promoted to background: the stats trigger (far
  // right; it doubles as the "Session 信息" details button) gains the services count.
  const detailsBtn = page.locator('button[title="Session 信息"]');
  await expect(detailsBtn.locator('span[title="1 个运行中的服务"]')).toBeVisible({
    timeout: 30_000,
  });

  // Open the details card by clicking the stats themselves (no separate info icon at
  // this width — the chips are the trigger).
  await detailsBtn.click();

  // New layout: one stat per line, tokens first with the bucketed breakdown in parens.
  await expect(page.getByText("Token 累计").first()).toBeVisible();
  await expect(page.getByText(/输入 tokens/).first()).toBeVisible();
  // Trace file row names the actual .jsonl path.
  await expect(page.getByText("轨迹文件")).toBeVisible();
  await expect(page.getByText(/\.jsonl/).first()).toBeVisible();

  // The process list row: the command, its pid line, and a working stop button.
  await expect(page.getByText("会话进程")).toBeVisible();
  const row = page.locator("li", { hasText: "sleep 600" }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText(/pid \d+/)).toBeVisible();
  await row.getByRole("button", { name: "停止" }).click();

  // The kill drops the process from the registry: the row disappears on the follow-up
  // refresh and the header count goes with it.
  await expect(page.getByText("会话进程")).toHaveCount(0, { timeout: 10_000 });
  await expect(detailsBtn.locator('span[title="1 个运行中的服务"]')).toHaveCount(0);

  // The server-side list agrees (the registry entry is gone, not merely marked exited).
  const procs = await (
    await page.request.get(`${BASE}/api/sessions/${sessionId}/processes`)
  ).json();
  expect(procs.processes).toEqual([]);
});
