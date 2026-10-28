/**
 * The LLM stream drops mid-way through writing tool arguments (MMSP cannot parse the
 * half-streamed arguments when the stream ends → malformed): that call is written whole with the
 * arguments that arrived, in a Request that ends retryable — the engine never dispatches it and
 * never emits a paired output; reconnect resends the same input verbatim. The frontend settles
 * the broken tool card when its Request ends (no more running timer) and shows a retry hint line
 * (with the attempt count). After a successful retry, subsequent tool calls appear and complete
 * as normal.
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

  // Trace: the broken call is recorded whole with the arguments that arrived, and the Request
  // holding it ended retryable, coded malformed. It never ran, so no output is paired with it;
  // every other recorded call ran and has its output.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const unpaired = msgs.messages.filter(
    (call) =>
      call.payload.type === "tool_call" &&
      !msgs.messages.some(
        (m) =>
          m.payload.type === "tool_call_output" &&
          m.payload.tool_call_id === call.payload.tool_call_id,
      ),
  );
  expect(unpaired, "only the broken call has no output").toHaveLength(1);
  const itsEnd = msgs.messages
    .slice(msgs.messages.indexOf(unpaired[0]))
    .find((m) => m.payload.type === "request_end");
  expect(itsEnd?.payload.status, "its Request ended retryable").toBe("retryable");
  expect(itsEnd?.payload.error_code, "coded malformed").toBe("malformed");

  // UI: after expanding the group, the broken tool card shows aborted and is **settled**
  // (no more running timer).
  await page
    .getByRole("button", { name: /运行完毕/ })
    .first()
    .click();
  const group = page.locator(".anim-msg.my-2").first();
  // The broken call never ran and gets no result: its status icon names it aborted (the icon's
  // aria-label and tooltip), the only explanation a touch user can reach.
  await expect(
    group.locator('[role="img"][aria-label="aborted"]'),
    "the broken tool card is settled as aborted",
  ).toHaveCount(1);
  // A running spinner has role=status; none should remain after the turn ends.
  await expect(page.locator('[role="status"]')).toHaveCount(0);
});
