/**
 * The LLM stream drops mid-way through writing tool arguments (AgentHub judges the "stream
 * incomplete" → malformed): that tool_call was never committed into AgentHub's history — the
 * engine never dispatches it and never emits a paired output; reconnect resends the same input
 * verbatim. The frontend settles the broken tool card as soon as the settle reason arrives (no
 * more running timer) and shows a retry hint line (with the attempt count). After a successful
 * retry, subsequent tool calls appear and complete as normal.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

test("a malformed tool_call settles unpaired; the retry line shows and the retry succeeds", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "maluser", "password123");
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
        },
      ],
    },
  });
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("坏流测试");
  await page.getByRole("button", { name: "发送" }).click();

  // The retried exec_command finishes → final answer, proving the retry and the following
  // tool call complete normally.
  await expect(page.getByText("命令已执行完成，结果符合预期。")).toBeVisible({ timeout: 20000 });

  // Retry hint line: set to "retry attempt 1 started" once request_begin arrives.
  await expect(page.getByText(/已发起第 1 次重试/)).toBeVisible();

  // Trace: the broken tool_call is persisted (stop_reason=malformed) but **no paired output is
  // added** — it never entered AgentHub's history, so there's nothing to pair; the retry is
  // represented by a request_end(malformed) event.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const broken = msgs.messages.find(
    (m) => m.payload.type === "tool_call" && m.payload.stop_reason === "malformed",
  );
  expect(broken, "malformed tool_call recorded").toBeTruthy();
  const paired = msgs.messages.find(
    (m) =>
      m.payload.type === "tool_call_output" &&
      m.payload.tool_call_id === broken.payload.tool_call_id,
  );
  expect(paired, "no paired output for a never-dispatched call").toBeFalsy();
  const retryEnd = msgs.messages.find(
    (m) => m.payload.type === "request_end" && m.payload.status === "malformed",
  );
  expect(retryEnd, "request_end(malformed) recorded").toBeTruthy();

  // UI: after expanding the group, the broken tool card shows malformed and is **settled**
  // (no more running timer).
  await page
    .getByRole("button", { name: /运行完毕/ })
    .first()
    .click();
  const group = page.locator(".anim-msg.my-2").first();
  await expect(group).toContainText("malformed");
  // A running spinner has role=status; none should remain after the turn ends.
  await expect(page.locator('[role="status"]')).toHaveCount(0);
});
