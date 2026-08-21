/**
 * Background completion notification, end to end in the real app: a task launches an
 * exec_command with run_in_background and finishes while the command still runs; when the
 * command exits, the harness-injected [background_task_done] user message must appear in
 * the OPEN chat page — collapsed into the one-line notice banner — followed by the model's
 * acknowledgement turn, with NO manual interaction in between. Also checks the launched
 * command shows up in the session's process list like any promoted background process.
 * Mock branches: "background notify test" in mock-llm.mjs.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "bgnotifyuser";
const P = "password123";

test("a run_in_background completion reaches the open chat page unprompted", async ({ page }) => {
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
  await ta.fill("background notify test");
  await page.getByRole("button", { name: "发送" }).click();

  // Turn 2 closes the task while the background command is still running.
  await expect(page.getByText("Started in the background; the report will follow.")).toBeVisible({
    timeout: 30_000,
  });

  // The launched command is a normal background process: the header stats show a running
  // service (same registry as the promoted-past-yield path).
  const detailsBtn = page.locator('button[title="Session 信息"]');
  await expect(detailsBtn.locator('span[title="1 个运行中的服务"]')).toBeVisible({
    timeout: 10_000,
  });

  // From here on: NO interaction. The command exits ~6s in; the harness user message must
  // appear as the collapsed one-line banner, and the model's acknowledgement turn after it.
  await expect(page.getByText("后台命令完成")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Acknowledged: the background command finished (bg-ack)."),
  ).toBeVisible({ timeout: 30_000 });
});
