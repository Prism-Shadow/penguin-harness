/**
 * The LLM stream drops mid-way through writing tool arguments (MMSP cannot parse the
 * half-streamed arguments when the stream ends → malformed): that call closes with its partial
 * stop alone — no complete tool_call is written, the engine never dispatches it and never emits
 * a paired output; reconnect resends the same input verbatim. The frontend settles the broken
 * tool card when its Request ends (no more running timer) and shows a retry hint line (with the
 * attempt count). After a successful retry, subsequent tool calls appear and complete as normal.
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
  await page.getByPlaceholder(/输入消息/).fill("bad stream test");
  await page.getByRole("button", { name: "发送" }).click();

  // The retried exec_command finishes → final answer, proving the retry and the following
  // tool call complete normally.
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible({
    timeout: 20000,
  });

  // Retry hint line: set to "retry attempt 1 started" once request_begin arrives.
  await expect(page.getByText(/已发起第 1 次重试/)).toBeVisible();

  // Trace: the broken call left no complete tool_call — only its fragments streamed, and the
  // Trace keeps none — so every recorded call is one that ran and has its output; the retry is
  // represented by a retryable request_end coded malformed.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const calls = msgs.messages.filter((m) => m.payload.type === "tool_call");
  for (const call of calls) {
    const paired = msgs.messages.find(
      (m) =>
        m.payload.type === "tool_call_output" &&
        m.payload.tool_call_id === call.payload.tool_call_id,
    );
    expect(paired, `recorded call ${call.payload.tool_call_id} has its output`).toBeTruthy();
  }
  const retryEnd = msgs.messages.find(
    (m) =>
      m.payload.type === "request_end" &&
      m.payload.status === "retryable" &&
      m.payload.error_code === "malformed",
  );
  expect(retryEnd, "request_end(retryable, malformed) recorded").toBeTruthy();

  // UI: after expanding the group, the broken tool card shows aborted and is **settled**
  // (no more running timer).
  await page
    .getByRole("button", { name: /运行完毕/ })
    .first()
    .click();
  const group = page.locator(".anim-msg.my-2").first();
  // Visibility is asserted explicitly: `toContainText` walks every descendant except
  // SCRIPT/NOSCRIPT/STYLE, so the StatusIcon's own SVG <title>aborted</title> satisfies it
  // even when nothing is drawn. This call never ran, so it has no output block to expand
  // into — the row's `[aborted]` marker is the only explanation a touch user can reach.
  await expect(
    group.getByText("[aborted]").filter({ visible: true }),
    "the broken tool card shows a visible aborted marker",
  ).toHaveCount(1);
  // A running spinner has role=status; none should remain after the turn ends.
  await expect(page.locator('[role="status"]')).toHaveCount(0);
});
