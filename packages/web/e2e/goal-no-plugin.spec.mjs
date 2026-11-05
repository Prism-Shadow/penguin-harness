/**
 * Goal mode on an Agent without the goal plugin, in a real browser against the real server.
 *
 * - Given the plugin check cannot be read (so nothing holds Send) and the sidebar's list
 *   answers slowly, when a goal is sent from the new-chat page, the server refuses its first
 *   Task and the Session created for it is deleted: no row is left in the sidebar, even once
 *   the list answer that read the Session lands, and the draft is kept.
 * - Given the check can be read, engaging goal mode shows the plugin notice and holds Send,
 *   creating nothing; installing from the notice releases Send, and sending opens the new
 *   conversation.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const OBJECTIVE = "Write hello.txt containing hello";
/** How long the sidebar's list answers are held in the first half: past the refusal and the delete. */
const LIST_DELAY_MS = 1500;

test.setTimeout(60_000);
test.use({ actionTimeout: 10_000 });

const isListFetch = (req) => new URL(req.url()).pathname.endsWith("/sessions/batch");
const isCreate = (req) =>
  req.method() === "POST" && /\/agents\/[^/]+\/sessions$/.test(new URL(req.url()).pathname);

/** Engages goal mode from the composer's "+" menu. */
async function engageGoal(page) {
  await page.getByRole("button", { name: "更多输入方式" }).click();
  await page.getByRole("button", { name: /^目标模式 / }).click();
}

test("goal mode without its plugin leaves no row behind, and installs from the composer", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "goalnoplugin", "password123");
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
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
  const stripped = await page.request.delete(
    `${BASE}/api/projects/${projectId}/agents/default_agent/hooks/goal`,
  );
  expect(stripped.status()).toBe(204);

  let creates = 0;
  let listFetchesInFlight = 0;
  page.on("request", (req) => {
    if (isCreate(req)) creates += 1;
    if (isListFetch(req)) listFetchesInFlight += 1;
  });
  const settled = (req) => {
    if (isListFetch(req)) listFetchesInFlight -= 1;
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);

  // —— The server's refusal: the check is unreadable, so the goal goes out and is refused.
  await page.route("**/api/projects/*/agents/*/plugins", (route) => route.abort());
  await page.route("**/api/projects/*/sessions/batch", async (route) => {
    // Read from the server now, answered late: the reload the new Session's announcement starts
    // reads it while it exists and lands after it was deleted.
    const res = await route.fetch();
    const body = await res.body();
    await new Promise((resolve) => setTimeout(resolve, LIST_DELAY_MS));
    await route.fulfill({ status: res.status(), headers: res.headers(), body });
  });
  await page.goto("/chat/new");
  const input = page.getByPlaceholder(/输入消息/);
  await expect(input).toBeVisible();
  await engageGoal(page);
  await input.fill(OBJECTIVE);
  const refused = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/tasks"),
  );
  const deleted = page.waitForResponse((res) => res.request().method() === "DELETE");
  await input.press("Enter");
  expect((await refused).status()).toBe(409);
  expect((await deleted).status()).toBe(204);
  await expect.poll(() => listFetchesInFlight).toBe(0);
  const sidebar = page.locator("aside");
  await expect(sidebar.getByText("新对话", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("临时工作区", { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue(OBJECTIVE);
  expect(creates).toBe(1);
  await page.unrouteAll({ behavior: "wait" });

  // —— The composer's check: engaged again, the plugin is found missing before anything is sent.
  await page.getByRole("button", { name: "退出目标模式" }).click();
  await engageGoal(page);
  const notice = page.getByText("目标模式需要 goal 插件：安装到此 Agent 后即可发起目标。");
  await expect(notice).toBeVisible();
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(send).toBeDisabled();
  await input.press("Enter");
  expect(creates).toBe(1);

  await page.getByRole("button", { name: "安装到此 Agent" }).click();
  await expect(notice).toHaveCount(0);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page).toHaveURL(/\/chat\/session-/);
  expect(creates).toBe(2);
  // The goal now loops against the mock model: stop it so it does not outlive the test.
  const sessionId = new URL(page.url()).pathname.split("/").pop();
  await page.request.post(`${BASE}/api/sessions/${sessionId}/abort`);
});
