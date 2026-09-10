/**
 * Interrupting while a tool runs must not eat a queued steering message.
 *
 * Core drops its steering queue as the run exits, so a message queued for "the next tool
 * round" used to vanish on abort, taking whatever the user had typed into it with it. The
 * server now hands the undelivered entry back and the composer takes it into its draft, so
 * the message returns to the input box and can be sent again.
 *
 * The LLM is mock-llm.mjs's "slow stream test": a ~8s exec_command keeps the Task busy, which
 * is the window this whole case lives in — steer, then stop before delivery.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "steerabortuser";
const P = "password123";
const STEER_TEXT = "steer: actually stop and summarize instead";

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

test("interrupting mid-tool-call returns the queued steering message to the composer", async ({
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

  // Steer while the ~8s tool run keeps the Task busy: queued, not yet delivered.
  await ta.fill(STEER_TEXT);
  await ta.press("Enter");
  await expect(page.getByText(`插话已排队，将随下一轮送达：${STEER_TEXT}`)).toBeVisible();
  await expect(ta).toHaveValue("");

  // Interrupt while the tool is still running — the case that used to lose the message.
  await page.getByRole("button", { name: "停止" }).click();

  // It comes back to the input box, ready to send again, and stops claiming to be queued.
  await expect(ta).toHaveValue(STEER_TEXT, { timeout: 15_000 });
  await expect(page.getByText(/插话已排队/)).toHaveCount(0);
});
