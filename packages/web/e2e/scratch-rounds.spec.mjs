import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
test("scratch: rounds render as bubbles", async ({ page }) => {
  await provisionAndLogin(page.request, "scratchr2", "password123");
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: { defaultModel: { provider: "custom", modelId: "claude-4-8" }, models: [{ provider: "custom", modelId: "claude-4-8", apiKey: "sk-mock", baseUrl: MOCK, contextWindow: 200000, pricing: { cacheRead: 1, cacheWrite: 5, output: 10 } }] },
  });
  const sess = await (await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, { data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" } })).json();
  await page.request.post(`${BASE}/api/sessions/${sess.session.sessionId}/tasks`, {
    data: { input: [{ type: "text", text: "根据今天新闻写篇作文" }], goal: { budget: 300 } },
  });
  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  await expect(page.getByText("预算耗尽").first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("目标 · 第 2 轮").first()).toBeVisible();
  await page.screenshot({ path: "/tmp/goal-rounds.png", fullPage: false });
});
