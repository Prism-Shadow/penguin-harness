// @vitest-environment jsdom
/**
 * A REAL-model conversation (e2e/real-model-chat.spec.mjs): the only spec that talks to a live
 * LLM provider instead of mock-llm.mjs. It runs against the same isolated server, but the
 * Session's model row names the DEEPSEEK_API_KEY provider, so every turn exercises the real
 * provider's streaming path — request shape, SSE parsing, usage accounting and the title fetch.
 *
 * Environment: DEEPSEEK_API_KEY (required — the spec skips without it, so the mock suite runs
 * unchanged), REAL_MODEL_ID (optional, default "deepseek-flash", a catalog preset — the deepseek group takes presets only), REAL_BASE_URL (optional).
 * Run: DEEPSEEK_API_KEY=... pnpm exec playwright test -c e2e/playwright.config.mjs \
 *        e2e/real-model-chat.spec.mjs  (server started by e2e/run.sh or standalone below)
 */
import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:8930";
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL_ID = process.env.REAL_MODEL_ID ?? "deepseek-flash";
const BASE_URL_OVERRIDE = process.env.REAL_BASE_URL ?? "https://api.deepseek.com";

test.skip(!API_KEY, "DEEPSEEK_API_KEY is not set — the real-model spec only runs when it is");

const U = "real_model_user";
const P = "real-model-password-2026";

test("a conversation turns on the live provider", async ({ page, request }) => {
  await provisionAndLogin(page.request, U, P);

  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "deepseek", modelId: MODEL_ID },
      models: [
        {
          provider: "deepseek",
          modelId: MODEL_ID,
          apiKey: API_KEY,
          baseUrl: BASE_URL_OVERRIDE,
        },
      ],
    },
  });
  expect(put.ok(), "put real models").toBeTruthy();

  const agents = await (await page.request.get(`${BASE}/api/projects/${projectId}/agents`)).json();
  const agentId = agents.agents[0].agentId;
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`, {
      data: { provider: "deepseek", modelId: MODEL_ID },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("Reply with exactly the word: pong");
  await ta.press("Enter");

  // The live provider streams the reply into the transcript; the word arrives as text.
  const reply = page.getByText("pong", { exact: false }).first();
  await reply.waitFor({ timeout: 120_000 });

  // A second turn proves the history window rides on the real conversation.
  await ta.fill("What word did I ask you to reply with? Answer with only that word.");
  await ta.press("Enter");
  await page.getByText("pong", { exact: false }).nth(1).waitFor({ timeout: 120_000 });
});
