/**
 * The PR smoke suite crosses the browser, HTTP server, core and mock provider boundaries.
 *
 * - Given a signed-out browser, when a provisioned user signs in, the chat opens and reload
 *   keeps the user signed in; protected data is unavailable before login.
 * - Given an always-ask tool call, when the browser reloads before approval, the command has
 *   not written its file; approving it executes the command and completes the reply.
 * - Given a completed conversation, when it reloads and receives a follow-up, history appears
 *   once and the new turn completes instead of becoming stranded (the #89 regression).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin, provisionUser } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const PASSWORD = "password123";
const REPLY = "Command finished; the result looks as expected.";

test.setTimeout(45_000);
test.use({ actionTimeout: 10_000 });

async function createSession(page, userId, approvalMode = "always-ask") {
  await provisionAndLogin(page.request, userId, PASSWORD);
  const projects = await page.request.get(`${BASE}/api/projects`);
  expect(projects.ok(), await projects.text()).toBeTruthy();
  const projectId = (await projects.json()).projects[0].projectId;
  const models = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  expect(models.ok(), await models.text()).toBeTruthy();
  const session = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8", approvalMode } },
  );
  expect(session.ok(), await session.text()).toBeTruthy();
  const sessionId = (await session.json()).session.sessionId;
  await page.goto(`/chat/${sessionId}`);
  await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();
  return sessionId;
}

async function send(page, message) {
  await page.getByPlaceholder(/输入消息/).fill(message);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

test("signing in opens the chat and remains signed in after reload", async ({ page }) => {
  await provisionUser("smokelogin", PASSWORD);
  expect((await page.request.get(`${BASE}/api/projects`)).status()).toBe(401);
  await page.goto("/chat");
  await page.getByLabel("用户名").fill("smokelogin");
  await page.getByLabel(/^密码/).fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();
  const projects = await page.request.get(`${BASE}/api/projects`);
  expect(projects.ok()).toBeTruthy();
  expect((await projects.json()).projects.length).toBeGreaterThan(0);
});

test("a pending tool survives reload and writes only after approval", async ({ page }) => {
  const sessionId = await createSession(page, "smokeapproval");
  const fileUrl = `${BASE}/api/sessions/${sessionId}/files/content?path=smoke-approved.txt`;
  await send(page, "files rewrite test printf smoke-approved > smoke-approved.txt");
  const allow = page.getByRole("button", { name: "允许", exact: true });
  await expect(allow).toBeVisible();
  expect((await page.request.get(fileUrl)).status()).toBe(404);

  await page.reload();
  await expect(allow).toBeVisible();
  expect((await page.request.get(fileUrl)).status()).toBe(404);
  await allow.click();
  await expect(page.getByText("The file was rewritten.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  const file = await page.request.get(fileUrl);
  expect(file.ok(), await file.text()).toBeTruthy();
  expect(await file.text()).toBe("smoke-approved");
});

test("completed history reloads once and a follow-up completes", async ({ page }) => {
  await createSession(page, "smokehistory", "allow-all");
  const firstMessage = "smoke first turn before reload";
  await send(page, firstMessage);
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(firstMessage, { exact: true })).toHaveCount(1);
  await expect(page.getByText(REPLY, { exact: true })).toHaveCount(1);
  const followUp = "smoke follow-up after reload";
  await send(page, followUp);
  await expect(page.getByText(REPLY, { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(firstMessage, { exact: true })).toHaveCount(1);
  await expect(page.getByText(followUp, { exact: true })).toHaveCount(1);
  await expect(page.getByText(REPLY, { exact: true })).toHaveCount(2);
});
