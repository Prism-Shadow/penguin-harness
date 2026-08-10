/**
 * Steering across a reload (#136/#140): a message steered into a running Task must
 *  (a) leave no composer draft behind — reloading must not resurrect the sent text (the
 *      old behavior revived it as a draft, and re-sending duplicated the steering);
 *  (b) keep its "queued" hint — content included — across the reload (the server's
 *      pending-steering mirror rides task_state events and the SSE subscribe snapshot);
 *  (c) land in the transcript exactly once, as a [user_steering] chip, once delivered.
 *
 * The LLM is mock-llm.mjs's "slow stream test": a ~8s exec_command keeps the Task busy,
 * leaving a wide window to steer and reload before delivery (steering is delivered at the
 * next input assembly, i.e. when the tool output returns).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "steeruser";
const P = "password123";
const STEER_TEXT = "steer: also check the logs";

/** Create a session for the user's auto-provisioned project (models PUT is idempotent). */
async function createSession(page, approvalMode) {
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
  const res = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8", approvalMode } },
  );
  expect(res.ok(), `create session: ${await res.text()}`).toBeTruthy();
  return (await res.json()).session.sessionId;
}

test("a steered message survives reload as a queued hint with its content — not a draft — and lands exactly once", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const sessionId = await createSession(page, "always-ask");
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.locator("textarea").first();
  await ta.waitFor();
  await ta.fill("slow stream test");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("exec_command").first()).toBeVisible();
  await page.getByRole("button", { name: "允许" }).click();

  // Steer while the ~8s tool run keeps the Task busy (default mid-run mode is steer).
  await ta.fill(STEER_TEXT);
  await ta.press("Enter");
  // The queued hint shows the content (the server mirror, not just the local flag), and
  // the composer is cleared.
  await expect(page.getByText(`插话已排队，将随下一轮送达：${STEER_TEXT}`)).toBeVisible();
  await expect(ta).toHaveValue("");

  // Reload mid-run: the sent text must NOT come back as a draft (#136 — that resurrection
  // is what produced duplicates), while the queued hint returns with its content.
  await page.reload();
  const ta2 = page.locator("textarea").first();
  await ta2.waitFor();
  await expect(page.getByText(`插话已排队，将随下一轮送达：${STEER_TEXT}`)).toBeVisible({
    timeout: 5000,
  });
  await expect(ta2).toHaveValue("");

  // Delivered with the next turn: the [user_steering] chip carries the text exactly once
  // (one paragraph holds the chip label and the text), and the queued hint retires — one
  // paragraph total also proves the hint no longer repeats the content.
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("用户插话").first()).toBeVisible();
  await expect(page.locator("p", { hasText: STEER_TEXT })).toHaveCount(1);
  await expect(page.getByText(/插话已排队/)).toHaveCount(0);
});
