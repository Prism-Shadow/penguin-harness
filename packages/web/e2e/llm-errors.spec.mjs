/**
 * LLM request-failure recovery:
 *
 * 1. Provider quota exhaustion (403 insufficient_user_quota) is retryable: the mock rejects
 *    the first five requests, GenerativeModel classifies them as timeout, the engine
 *    reconnects with exponential backoff (250/500/1000/2000/4000ms — engine deps are not
 *    env-configurable, so the mock's failure count is chosen to open a ≥2s countdown
 *    window instead of injecting knobs; five failures + five retries sits exactly at the
 *    default cap of 5, so attempt 6 is the last allowed and succeeds). The 4s wait before
 *    retry #5 shows a live countdown whose seconds tick DOWN; clicking "retry now"
 *    (立即重试) skips the rest of the wait and the turn completes normally — no abort.
 * 2. Give-up: a conversation whose quota rejections never stop — clicking 放弃 on the
 *    countdown fires the ordinary abort; the engine's abort-during-backoff path ends the
 *    turn and the composer is immediately usable again.
 * 3. An authentication failure (401 invalid_api_key) marks the Session auth-dead but
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

test("a quota-403 retries with a live countdown; 'retry now' skips the wait and the turn completes", async ({
  page,
}) => {
  const { sessionId } = await makeSession(page, "quotauser");

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("quota retry test");
  await page.getByRole("button", { name: "发送" }).click();

  // Early retries flip fast (250/500ms waits — below the 2s countdown floor they keep the
  // plain waiting/retried text).
  await expect(page.locator("p.text-amber-600", { hasText: "已发起第 1 次重试" })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator("p.text-amber-600", { hasText: "已发起第 2 次重试" })).toBeVisible();

  // The 4s wait before retry #5: a live countdown (whole seconds, ticking down).
  const countdown = page.locator("p.text-amber-600", { hasText: /第 5 次重试，\d+ 秒后发起/ });
  await expect(countdown).toBeVisible({ timeout: 20000 });
  const readSecs = async () => {
    const txt = await countdown.textContent({ timeout: 500 }).catch(() => null);
    const m = txt === null ? null : /第 5 次重试，(\d+) 秒后发起/.exec(txt);
    return m ? parseInt(m[1], 10) : null;
  };
  const first = await readSecs();
  expect(first).not.toBeNull();
  // Poll until the displayed seconds DECREASE (a live ticker, not a static label).
  let second = first;
  for (let i = 0; i < 12 && second !== null && second >= first; i++) {
    await page.waitForTimeout(300);
    second = await readSecs();
  }
  expect(second).not.toBeNull();
  expect(second).toBeLessThan(first);

  // "Retry now" skips the remaining wait: the retry fires promptly — well before the
  // scheduled 4s would have elapsed (the 1.5s expectation window is the proof: without
  // the skip, the natural timer still had >2s to go).
  await page.getByRole("button", { name: "立即重试" }).click();
  await expect(page.locator("p.text-amber-600", { hasText: "已发起第 5 次重试" })).toBeVisible({
    timeout: 1500,
  });

  // Attempt 6 succeeds: the final answer streams in.
  await expect(page.getByText("Quota recovered; the answer is 42.")).toBeVisible({
    timeout: 20000,
  });

  // No abort: the run recovered, the composer stays usable.
  await expect(page.getByText(/已中断/)).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入消息/)).toBeEnabled();

  // Trace: all five quota rejections recorded as request_end(timeout) — the reconnect
  // path — carrying the real failure detail (the Cost center's errors panel reads it from
  // here) and the announced backoff ladder; no abort event.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const timeouts = msgs.messages.filter(
    (m) => m.payload.type === "request_end" && m.payload.status === "timeout",
  );
  expect(timeouts.length).toBe(5);
  for (const t of timeouts) expect(t.payload.message).toContain("insufficient_user_quota");
  expect(timeouts.map((t) => t.payload.retry_in_ms)).toEqual([250, 500, 1000, 2000, 4000]);
  expect(msgs.messages.some((m) => m.payload.type === "abort")).toBe(false);
});

test("'give up' on the countdown aborts the backoff: the turn ends and the composer is usable again", async ({
  page,
}) => {
  const { sessionId } = await makeSession(page, "giveupuser");

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("quota giveup test");
  await page.getByRole("button", { name: "发送" }).click();

  // The mock rejects every request: by the 2s wait before retry #4 the countdown (and its
  // inline controls) are on screen.
  await expect(page.getByRole("button", { name: "放弃" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "放弃" }).click();

  // The ordinary abort lands mid-backoff: the engine's abort-during-backoff path ends the
  // turn (abort line + the waiting notice flips to "stopped"), and the composer is
  // immediately usable again.
  await expect(page.getByText(/已中断/)).toBeVisible({ timeout: 10000 });
  await expect(page.locator("p.text-amber-600", { hasText: "已停止重试" })).toBeVisible();
  await expect(page.getByPlaceholder(/输入消息/)).toBeEnabled();
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

  // Action-only notice (per review: tell the user what to do, no explanations) and the
  // composer disabled with the matching placeholder.
  await expect(page.getByText(/请在模型配置页更新该模型的 API key/)).toBeVisible();
  await expect(page.getByPlaceholder(/模型认证失败/)).toBeDisabled();

  // Trace: the credentials failure is the request's own terminal status (no abort code —
  // "auth" is a stop reason now); the abort event only carries the prose reason.
  const msgs = await (await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)).json();
  const authEnd = msgs.messages.find(
    (m) => m.payload.type === "request_end" && m.payload.status === "auth",
  );
  expect(authEnd).toBeTruthy();
  expect(authEnd.payload.message).toContain("invalid x-api-key");
  const abort = msgs.messages.find((m) => m.payload.type === "abort");
  expect(abort.payload.code).toBeUndefined();

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
