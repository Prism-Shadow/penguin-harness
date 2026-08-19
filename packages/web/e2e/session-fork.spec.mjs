/**
 * Session fork e2e: the reply footer's fork action (right of copy, confirm-gated) and the
 * delete-the-fork flow.
 *
 * - The fork button sits to the RIGHT of the copy button (review request), and clicking it
 *   only opens the shared ConfirmModal — Cancel fires no fork request, Confirm creates the
 *   fork and navigates to it. Copy itself stays a plain unconfirmed click.
 * - Deleting the fork while it is the open chat must not fire any follow-up request against
 *   the deleted id. Regression: the sidebar's remove() used to commit one render before
 *   navigate()'s router transition, and in that intermediate commit the chat page's
 *   deep-link probe re-fetched the just-deleted Session — the server logged a
 *   session_not_found 404 on every fork deletion (the natural fork workflow always deletes
 *   the fork it is looking at).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "forkuser";
const P = "password123";

test("fork from reply: button order + confirm gate + clean fork deletion", async ({ page }) => {
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

  // Default approval mode (allow-all): the mock's turn-1 tool call auto-runs and turn 2
  // completes the reply, which is what makes the footer's fork action appear.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  const sourceId = sess.session.sessionId;

  // Record every /api request (method + url + status) to prove which ids get re-fetched.
  const apiLog = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/"))
      apiLog.push({ t: Date.now(), kind: "req", m: r.method(), url: r.url() });
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/"))
      apiLog.push({ t: Date.now(), kind: "res", status: r.status(), url: r.url() });
  });

  await page.goto(`${BASE}/chat/${sourceId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("Fork e2e message");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible({
    timeout: 30_000,
  });

  // Reveal the reply footer.
  await page.getByText("Command finished; the result looks as expected.").first().hover();
  const copyBtn = page.getByRole("button", { name: "复制回复" }).first();
  const forkBtn = page.getByRole("button", { name: "从这里分叉对话" }).first();
  await expect(copyBtn).toBeVisible();
  await expect(forkBtn).toBeVisible();

  // The fork action sits to the RIGHT of copy (review request).
  const [copyBox, forkBox] = await Promise.all([copyBtn.boundingBox(), forkBtn.boundingBox()]);
  expect(copyBox, "copy button rendered").not.toBeNull();
  expect(forkBox, "fork button rendered").not.toBeNull();
  expect(forkBox.x, "fork is right of copy").toBeGreaterThan(copyBox.x + copyBox.width - 1);

  // Copy stays a plain unconfirmed click: no dialog appears and the text lands on the clipboard.
  await copyBtn.click();
  await expect(page.getByRole("button", { name: "分叉", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Command finished");

  // Fork asks first: the click opens the confirm dialog and fires NO fork request by itself.
  await page.getByText("Command finished; the result looks as expected.").first().hover();
  await forkBtn.click();
  await expect(page.getByText("将把这段对话（截至这条回复）复制为一个新对话")).toBeVisible();
  // Cancel: dialog closes, still on the source chat, and no /fork request was made.
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText("将把这段对话（截至这条回复）复制为一个新对话")).toHaveCount(0);
  expect(page.url()).toContain(sourceId);
  expect(
    apiLog.filter((e) => e.kind === "req" && /\/api\/sessions\/[^/]+\/fork$/.test(e.url)),
    "cancel fires no fork request",
  ).toHaveLength(0);

  // Confirm: the fork request fires and the app navigates to the new Session.
  await page.getByText("Command finished; the result looks as expected.").first().hover();
  await forkBtn.click();
  await page.getByRole("button", { name: "分叉", exact: true }).click();
  await page.waitForURL(
    (u) => /\/chat\/session-/.test(u.pathname) && !u.pathname.includes(sourceId),
    { timeout: 15_000 },
  );
  const forkId = decodeURIComponent(page.url().split("/chat/")[1]);
  expect(forkId).not.toBe(sourceId);
  // The fork carries the copied transcript.
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // Delete the fork (it is the open chat — the standard try-then-discard fork flow).
  const sidebar = page.getByRole("complementary");
  const forkRow = sidebar.locator("li", { hasText: "(1)" }).first();
  await forkRow.hover();
  await forkRow.getByRole("button", { name: "对话选项" }).click();
  await page.getByRole("button", { name: "删除对话" }).click();
  const tDelete = Date.now();
  await page.getByRole("button", { name: "删除", exact: true }).click();

  // The app must land somewhere else and the fork row must be gone.
  await page.waitForURL((u) => !u.pathname.includes(forkId), { timeout: 15_000 });
  await expect(sidebar.locator("li", { hasText: "(1)" })).toHaveCount(0);
  await page.waitForTimeout(1500); // window for any stray follow-up request to show itself

  // Regression: after the DELETE nothing may request the deleted id again (the server used
  // to log an expected-but-noisy session_not_found 404 here), and nothing may 4xx at all.
  const strays = apiLog.filter(
    (e) => e.t >= tDelete && e.kind === "req" && e.m !== "DELETE" && e.url.includes(forkId),
  );
  expect(
    strays,
    `no follow-up requests for the deleted fork id: ${JSON.stringify(strays)}`,
  ).toHaveLength(0);
  const errors = apiLog.filter((e) => e.t >= tDelete && e.kind === "res" && e.status >= 400);
  expect(errors, `no error responses after fork deletion: ${JSON.stringify(errors)}`).toHaveLength(
    0,
  );
});
