/**
 * Interrupt, then send: the run stops and the message goes out right after the turn it cut.
 *
 * Two ways in: the Interrupt link on a queued steering line, and the Interrupt mid-run send
 * mode. Either way the message is delivered as the next Task's input — not handed back to the
 * composer the way a plain Stop hands back undelivered steering — and the conversation goes
 * on from the cut turn.
 *
 * The LLM is mock-llm.mjs's "slow stream test": a ~8s exec_command keeps the Task busy. Cut
 * there, the turn's tool call is already committed, so the next request carries its (aborted)
 * result and the mock answers with its turn-2 text.
 */
import { test, expect } from "@playwright/test";
import { setAccountPrefs } from "./account-prefs.mjs";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const P = "password123";
const REPLY = "Command finished; the result looks as expected.";

/** Create a session for the user's auto-provisioned project (models PUT is idempotent). */
async function createSession(page) {
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
    { data: { provider: "custom", modelId: "claude-4-8", approvalMode: "always-ask" } },
  );
  expect(res.ok(), `create session: ${await res.text()}`).toBeTruthy();
  return (await res.json()).session.sessionId;
}

/** Opens the session and starts the slow tool run, approved; resolves with the composer. */
async function startSlowRun(page, sessionId) {
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.locator("textarea").first();
  await ta.waitFor();
  await ta.fill("slow stream test");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("执行命令").first()).toBeVisible();
  await page.getByRole("button", { name: "允许" }).click();
  return ta;
}

test("the Interrupt link on a queued steering line sends it right after the turn it cut", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "interruptlinkuser", P);
  const sessionId = await createSession(page);
  const ta = await startSlowRun(page, sessionId);

  const text = "steer: stop and summarize what you have";
  await ta.fill(text);
  await ta.press("Enter");
  await expect(page.getByText(`插话已排队，将随下一轮送达：${text}`)).toBeVisible();

  await page.getByRole("button", { name: "打断", exact: true }).click();

  // Delivered as the next message, and the conversation goes on from the cut turn.
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(REPLY)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/插话已排队/)).toHaveCount(0);
  // Not handed back the way a plain Stop hands back undelivered steering.
  await expect(ta).toHaveValue("");
});

test("in Interrupt mode a message sent mid-run stops the run and goes out next", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "interruptmodeuser", P);
  await setAccountPrefs(page.request, { steerMode: "interrupt" });
  const sessionId = await createSession(page);
  const ta = await startSlowRun(page, sessionId);

  const text = "never mind the loop, just summarize";
  await ta.fill(text);
  await expect(page.getByRole("button", { name: "打断并发送" })).toBeVisible();
  await ta.press("Enter");
  await expect(ta).toHaveValue("");

  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(REPLY)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/插话已排队|正在打断/)).toHaveCount(0);
});
