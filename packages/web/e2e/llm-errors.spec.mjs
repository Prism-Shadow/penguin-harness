/**
 * LLM request-failure recovery:
 *
 * 1. Provider quota exhaustion (403 insufficient_user_quota) is retryable: the mock rejects
 *    the first two requests, GenerativeModel classifies them as timeout, the engine
 *    reconnects (amber retry lines with attempt numbers) and the turn completes normally —
 *    no abort. With the exponential ladder the two waits are 250ms + 500ms, well within
 *    timeouts, so no backoff knobs are injected.
 * 2. An authentication failure (401 invalid_api_key) marks the Session auth-dead but
 *    RECOVERABLE: only the model reference is fixed at creation — credentials come from the
 *    current Project config — so the notice points at the Models page, updating the key
 *    auto-unlocks the composer (live via the credentials_updated event; across reloads via
 *    the credentials-updated-vs-abort time gate), Retry is the manual escape hatch (and the
 *    dead state re-arms if the key is still bad), and New Session stays as the way out.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

/** Provision a user with a configured mock model and one session; returns ids for later config updates. */
async function makeSession(page, userId, apiKey = "sk-mock") {
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
          apiKey,
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
  return { sessionId: sess.session.sessionId, projectId };
}

test("a quota-403 retries like a network problem: amber retry lines, then the turn completes", async ({
  page,
}) => {
  const { sessionId } = await makeSession(page, "quotauser");

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("quota retry test");
  await page.getByRole("button", { name: "发送" }).click();

  // Attempt 3 succeeds: the final answer streams in (exponential backoff 250ms + 500ms
  // sits well within the timeout).
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
  // carrying the real failure detail (the Cost center's errors panel reads it from here),
  // and no abort event.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const timeouts = msgs.messages.filter(
    (m) => m.payload.type === "request_end" && m.payload.status === "timeout",
  );
  expect(timeouts.length).toBe(2);
  for (const t of timeouts) expect(t.payload.message).toContain("insufficient_user_quota");
  expect(msgs.messages.some((m) => m.payload.type === "abort")).toBe(false);
});

test("an auth-401 marks the Session dead but recoverable: Models CTA, key update auto-unlocks, Retry re-arms", async ({
  page,
}) => {
  // The mock rejects the provisioned key (`sk-auth-bad`) with a 401 and accepts any other.
  const { sessionId, projectId } = await makeSession(page, "authuser", "sk-auth-bad");

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("auth dead test");
  await page.getByRole("button", { name: "发送" }).click();

  // The existing abort line renders unchanged (the notice is additional).
  await expect(page.getByText(/已中断/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/llm request error/)).toBeVisible();

  // Corrected notice: credentials come from the current Project config (not "locked at
  // creation"), and the composer is disabled with the matching placeholder.
  await expect(page.getByText(/凭据取自当前 Project 配置/)).toBeVisible();
  await expect(page.getByPlaceholder(/模型认证失败/)).toBeDisabled();

  // Trace: the abort event carries the machine-readable code.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const abort = msgs.messages.find((m) => m.payload.type === "abort");
  expect(abort.payload.code).toBe("auth");

  // Reload: the state is rebuilt from Trace replay (the abort event is persisted) and the
  // key has not changed, so the session stays dead.
  await page.reload();
  await expect(page.getByText(/模型 API 认证失败/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByPlaceholder(/模型认证失败/)).toBeDisabled();

  // Primary CTA targets the Models page — where the credential is actually fixed.
  await page.getByRole("button", { name: "打开模型配置" }).click();
  await expect(page).toHaveURL(/\/models$/);
  await page.goBack();
  await expect(page.getByText(/模型 API 认证失败/)).toBeVisible({ timeout: 15000 });

  // Secondary escape: New Session still jumps to a usable fresh draft.
  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page).toHaveURL(/\/chat\/new$/);
  const draftInput = page.getByPlaceholder(/输入消息/);
  await expect(draftInput).toBeVisible();
  await expect(draftInput).toBeEnabled();
  await page.goBack();
  await expect(page.getByText(/模型 API 认证失败/)).toBeVisible({ timeout: 15000 });

  // Retry (escape hatch) WITHOUT fixing the key: the composer re-enables for one more
  // attempt, the mock rejects again, and the dead state re-arms.
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText(/模型 API 认证失败/)).toHaveCount(0);
  const input = page.getByPlaceholder(/输入消息/);
  await expect(input).toBeEnabled();
  await input.fill("auth dead test again");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/模型 API 认证失败/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByPlaceholder(/模型认证失败/)).toBeDisabled();

  // PRIMARY PATH: update the model's key (as the Models page would). The server
  // invalidates the Project's cached runtimes and publishes credentials_updated to this
  // open tab — the composer unlocks WITHOUT a reload and WITHOUT clicking Retry.
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-auth-good",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.status()).toBe(200);
  await expect(page.getByText(/模型 API 认证失败/)).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByPlaceholder(/输入消息/)).toBeEnabled();

  // The SAME conversation continues on the new key (the rebuilt runtime re-reads the
  // Project config): the send completes and the notice stays gone.
  await page.getByPlaceholder(/输入消息/).fill("auth dead test after fix");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Auth restored; hello again.")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/模型 API 认证失败/)).toHaveCount(0);

  // Reload AFTER the success: replay still contains the auth aborts, but they are followed
  // by a completed request AND predate the credential update (the time gate) — the dead
  // state must not resurrect.
  await page.reload();
  await expect(page.getByText("Auth restored; hello again.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/模型 API 认证失败/)).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入消息/)).toBeEnabled();
});
