/**
 * LLM request-failure recovery:
 *
 * 1. Provider quota exhaustion (403 insufficient_user_quota) is retryable: the mock rejects
 *    the first two requests, GenerativeModel classifies them as timeout, the engine
 *    reconnects (amber retry lines with attempt numbers) and the turn completes normally —
 *    no abort.
 * 2. An authentication failure (401 invalid_api_key) is dead-end for the whole Session (its
 *    model + credentials are fixed at creation): the abort event carries code "auth", the
 *    composer disables and grays itself with a notice (which survives a reload via Trace
 *    replay), and the "New Session" button jumps to a usable /chat/new draft.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

/** Provision a user with a configured mock model and one session; returns the session id. */
async function makeSession(page, userId) {
  await provisionAndLogin(page.request, userId, "password123");
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
  return sess.session.sessionId;
}

test("a quota-403 retries like a network problem: amber retry lines, then the turn completes", async ({
  page,
}) => {
  const sessionId = await makeSession(page, "quotauser");

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("quota retry test");
  await page.getByRole("button", { name: "发送" }).click();

  // Attempt 3 succeeds: the final answer streams in (default backoff 250ms×n sits well
  // within the timeout).
  await expect(page.getByText("Quota recovered; the answer is 42.")).toBeVisible({
    timeout: 20000,
  });

  // Two amber retry hint lines, with attempt numbers (marked "sent" once the retry request
  // began; both remain visible after success).
  await expect(page.locator("p.text-amber-600", { hasText: "已发起第 1 次重试" })).toBeVisible();
  await expect(page.locator("p.text-amber-600", { hasText: "已发起第 2 次重试" })).toBeVisible();

  // No abort: the run recovered, the composer stays usable.
  await expect(page.getByText(/已中断/)).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入消息/)).toBeEnabled();

  // Trace: both quota rejections recorded as request_end(timeout) — the reconnect path —
  // and no abort event.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const timeouts = msgs.messages.filter(
    (m) => m.payload.type === "request_end" && m.payload.status === "timeout",
  );
  expect(timeouts.length).toBe(2);
  expect(msgs.messages.some((m) => m.payload.type === "abort")).toBe(false);
});

test("an auth-401 kills the Session: abort line + disabled composer + New Session CTA", async ({
  page,
}) => {
  const sessionId = await makeSession(page, "authuser");

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("auth dead test");
  await page.getByRole("button", { name: "发送" }).click();

  // The existing abort line renders unchanged (the notice is additional).
  await expect(page.getByText(/已中断/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/llm request error/)).toBeVisible();

  // Dead-session notice + the composer disabled with the swapped placeholder.
  await expect(page.getByText(/模型 API 认证失败/)).toBeVisible();
  await expect(page.getByPlaceholder("会话已不可用，请新建会话")).toBeDisabled();

  // Trace: the abort event carries the machine-readable code.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const abort = msgs.messages.find((m) => m.payload.type === "abort");
  expect(abort.payload.code).toBe("auth");

  // Reload: the flag is rebuilt from Trace replay (the abort event is persisted), so the
  // session stays dead after coming back later.
  await page.reload();
  await expect(page.getByText(/模型 API 认证失败/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByPlaceholder("会话已不可用，请新建会话")).toBeDisabled();

  // The CTA lands on a fresh draft with a usable composer.
  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page).toHaveURL(/\/chat\/new$/);
  const draftInput = page.getByPlaceholder(/输入消息/);
  await expect(draftInput).toBeVisible();
  await expect(draftInput).toBeEnabled();
});
