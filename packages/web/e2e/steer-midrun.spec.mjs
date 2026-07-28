/**
 * Mid-run sends from the composer, both paths of the single action button:
 *  - steering carries text AND images, so an image with no caption is a complete steering
 *    message: the button is a live steer send, the whole draft goes out, and the delivered
 *    message renders as a steering chip with the image inside the running Task;
 *  - a draft steering genuinely cannot carry (skills selected, no text and no image) falls
 *    back to the follow-up queue for that send, so the button still works instead of sitting
 *    disabled while having displaced Stop.
 * In both cases the emptied draft flips the button back to Stop.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Logs in, points the project at the mock LLM and opens an idle session's chat page. */
async function openSession(page, user) {
  await provisionAndLogin(page.request, user, "password123");
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
  // always-ask: a run blocks on a pending tool approval, keeping the session RUNNING.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "always-ask" },
    })
  ).json();

  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  return sess.session.sessionId;
}

/**
 * Waits for the run to park on its approval — the state every assertion below runs in. The
 * action button is deliberately NOT asserted here: it is Stop only while the draft is empty,
 * which is exactly what each test is about.
 */
async function expectRunning(page) {
  await expect(page.getByRole("button", { name: "允许" })).toBeVisible();
}

/** Attaches one 1x1 PNG to the composer through the (hidden) file input. */
async function attachImage(page) {
  await page.setInputFiles('input[type="file"]', {
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1, "base64"),
  });
  await expect(page.getByRole("button", { name: "移除图片" }).first()).toBeVisible();
}

test("steer mode: an image-only draft mid-run steers, image and all", async ({ page }) => {
  await openSession(page, "steerimages");
  await page.getByPlaceholder(/输入消息/).fill("Help me set up @theme");
  await page.getByRole("button", { name: "发送" }).click();
  await expectRunning(page);
  // Empty draft while running: the action button is Stop.
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();

  // Attach ONE image, type nothing: steering carries it, so the action button must be a LIVE
  // steer send (not Stop, and not the follow-up queue).
  await attachImage(page);
  const steerSend = page.getByRole("button", { name: "发送给运行中的 Agent" });
  await expect(steerSend).toBeEnabled();
  await steerSend.click();

  // The draft (text and image) is emptied by the send, which restores Stop.
  await expect(page.getByRole("button", { name: "移除图片" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();

  // Approve the parked tool: the steering message rides the next turn's input and comes back
  // over the stream as a steering chip — with its image inside it, still in the same Task.
  await page.getByRole("button", { name: "允许" }).click();
  // The image lives INSIDE the chip, not in a bubble of its own: the div matched here has the
  // steering label as its complete text (so it is the chip, never a shared ancestor of the
  // conversation) and holds the image itself.
  const chip = page
    .locator("div")
    .filter({ hasText: /^用户插话$/ })
    .filter({ has: page.locator('img[alt="用户上传的图片"]') })
    .first();
  await expect(chip).toBeVisible({ timeout: 20000 });
  // And it stayed one Task: the image never became a Prompt of its own.
  await expect(page.locator('img[alt="用户上传的图片"]')).toHaveCount(1);
});

test("steer mode: a skills-only draft falls back to the follow-up queue", async ({ page }) => {
  const sessionId = await openSession(page, "steerfallback");

  // Select a skill with no text and no image. The picker is only enabled while idle, so the
  // run is started from the API — the same shape a schedule firing (or another client) leaves
  // behind: a running session with a skills-only draft sitting in the composer.
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByRole("button", { name: /^agent-creation/ }).click();
  await page.keyboard.press("Escape");
  await page.request.post(`${BASE}/api/sessions/${sessionId}/tasks`, {
    data: { input: [{ type: "text", text: "Help me set up @theme" }] },
  });
  await expectRunning(page);

  // A [use_skills] block is task-level setup, which the steer channel does not carry — so the
  // button stays live as the queue action instead of going dead with Stop displaced.
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
