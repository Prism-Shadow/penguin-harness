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

import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const PASSWORD = "password123";
const REPLY = "Command finished; the result looks as expected.";

test.setTimeout(45_000);
test.use({ actionTimeout: 10_000 });

async function createSession(page, userId, approvalMode = "always-ask", themeId = null) {
  await provisionAndLogin(page.request, userId, PASSWORD);
  await setAccountPrefs(page.request, { themeId });
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

async function changeActivityDisplay(page, userId, label) {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(userId), expanded: false })
    .click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "外观", exact: true }).click();
  const option = dialog.getByRole("button", { name: label, exact: true });
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

const activityRoot = (page) => page.locator(".ui-frame[data-step-view]").first();
const activityRows = (group) => group.locator(".ui-tree > [data-depth]");
async function openSteps(group) {
  const toggle = group.locator("[data-group-header]");
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}
const expectFoldedBodies = async (group) => {
  await expect(group).not.toContainText(/I will check|I will compare|printf|entry [12]/, {
    useInnerText: true,
  });
};

test("the account's display setting changes saved history and survives a different theme and a reload", async ({
  page,
}) => {
  const userId = "smokeactivityhistory";
  await createSession(page, userId, "allow-all", "doodle");
  await send(page, "activity pages test");
  await expect(page.getByText("Both tools finished.", { exact: true })).toBeVisible();
  await page.reload();

  const group = activityRoot(page),
    rows = activityRows(group);
  // A new account starts in Standard on every theme, including Doodle.
  await openSteps(group);
  await expect(rows).toHaveCount(4);
  await expectFoldedBodies(group);
  await expect(group.locator("[data-step-navigation]")).toHaveCount(0);
  await changeActivityDisplay(page, userId, "展开");
  await openSteps(group);
  await expect(rows).toHaveCount(4);
  await expect(group.getByText("I will check the first entry.", { exact: true })).toBeVisible();
  await expect(group.getByText("entry 2", { exact: true })).toBeVisible();
  await changeActivityDisplay(page, userId, "紧凑");

  const nav = group.locator("[data-step-navigation]");
  await expect(nav).toContainText("5/5");
  await expect(group.locator("[data-step-terminal]")).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expectFoldedBodies(group);
  await group.getByRole("button", { name: "上一步" }).click();
  await expect(nav).toContainText("4/5");
  await expect(rows).toHaveCount(0);
  await openSteps(group);
  await expect(rows).toHaveCount(1);
  await expectFoldedBodies(group);
  await rows.locator("button[aria-expanded]").first().click();
  await expect(rows.getByText("entry 2", { exact: true })).toBeVisible();

  await setAccountPrefs(page.request, { themeId: "github" });
  await page.reload();
  await expect(nav).toContainText("5/5");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("Both tools finished.", { exact: true })).toHaveCount(1);
});

test("compact navigation stays on one line while the run advances and preserves a reader's earlier page", async ({
  page,
  context,
}) => {
  const userId = "smokeactivity";
  const sessionId = await createSession(page, userId, "always-ask", "modern");
  await changeActivityDisplay(page, userId, "紧凑");
  await send(page, "activity pages test");
  const group = activityRoot(page),
    nav = group.locator("[data-step-navigation]"),
    rows = activityRows(group);
  const previous = group.getByRole("button", { name: "上一步" }),
    next = group.getByRole("button", { name: "下一步" });
  await expect(nav).toContainText("2/2");
  await expect(rows).toHaveCount(0);
  await expectFoldedBodies(group);

  const reviewer = await context.newPage();
  await reviewer.goto(`/chat/${sessionId}`);
  const reviewing = activityRoot(reviewer);
  await previous.click();
  await expect(nav).toContainText("1/2");
  await openSteps(group);
  await expectFoldedBodies(group);
  await rows.locator("button[aria-expanded]").first().click();
  await expect(group.getByText("I will check the first entry.", { exact: true })).toBeVisible();

  // A second, real reader approves the very same Session. Neither advancing nor finishing
  // the run may take the first reader off their chosen page.
  await openSteps(reviewing);
  const allow = reviewing.getByRole("button", { name: "允许", exact: true });
  if (!(await allow.isVisible()))
    await activityRows(reviewing).locator("button[aria-expanded]").first().click();
  await allow.click();
  await expect(nav).toContainText("1/4");
  await expect(group.getByText("I will check the first entry.", { exact: true })).toBeVisible();
  await group.locator("[data-group-header]").click();
  await expect(rows).toHaveCount(0);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const head = group.locator("[data-group-header]");
    const [labelBox, navBox] = await Promise.all([head.boundingBox(), nav.boundingBox()]);
    expect(Math.abs(labelBox.y + labelBox.height / 2 - navBox.y - navBox.height / 2)).toBeLessThan(
      3,
    );
    await expect
      .poll(() =>
        nav.locator("button:enabled").evaluateAll((buttons) =>
          buttons.every((button) => {
            const r = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        ),
      )
      .toBe(true);
    await next.focus();
    await page.keyboard.press("ArrowRight");
    await expect(nav).toContainText("2/4");
    await previous.click();
    await expect(nav).toContainText("1/4");
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(reviewing.locator("[data-step-navigation]")).toContainText("4/4");
  await openSteps(reviewing);
  if (!(await allow.isVisible()))
    await activityRows(reviewing).locator("button[aria-expanded]").first().click();
  await allow.click();
  await expect(page.getByText("Both tools finished.", { exact: true })).toBeVisible();
  await expect(nav).toContainText("1/5");
  await expect(rows).toHaveCount(0);
  await expect(reviewing.locator("[data-step-navigation]")).toContainText("5/5");
  await reviewer.close();
});
