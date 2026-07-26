/**
 * Steer-mode queue fallback: a mid-run draft that the text-only steer channel can't carry
 * (here: an image with no text) must still send — through the follow-up queue — instead of
 * stranding the user on a permanently disabled send button that also displaced Stop.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

test("steer mode: an image-only draft mid-run sends via the follow-up queue", async ({ page }) => {
  await provisionAndLogin(page.request, "steerfallback", "password123");
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
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  // always-ask: the run blocks on a pending tool approval, keeping the session RUNNING.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "always-ask" },
    })
  ).json();

  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("Help me set up @theme");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "允许" })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();

  // Attach ONE image, type nothing: steering can't carry it, so the action button must be
  // a LIVE send labeled as the queue action — not Stop, and never a disabled steer send.
  await page.setInputFiles('input[type="file"]', {
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.getByRole("button", { name: "移除图片" }).first()).toBeVisible();
  const queueSend = page.getByRole("button", { name: "排队为下一条消息" });
  await expect(queueSend).toBeEnabled();
  await queueSend.click();

  // Queued server-side; the drained draft flips the button back to Stop.
  await expect(page.getByText(/1 条跟进消息已排队/)).toBeVisible();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();

  // Let the run finish: the queued follow-up auto-starts as the next ordinary task and the
  // queue drains.
  await page.getByRole("button", { name: "允许" }).click();
  await expect(page.getByText(/1 条跟进消息已排队/)).toHaveCount(0, { timeout: 20000 });
});
