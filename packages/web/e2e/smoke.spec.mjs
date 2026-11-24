/**
 * The PR smoke suite crosses the browser, HTTP server, core and mock provider boundaries.
 *
 * - Given a signed-out browser, when a provisioned user signs in, the chat opens and reload
 *   keeps the user signed in; protected data is unavailable before login.
 * - Given an always-ask tool call, when the browser reloads before approval, the command has
 *   not written its file; approving it executes the command and completes the reply.
 * - Given a completed conversation, when it reloads and receives a follow-up, history appears
 *   once and the new turn completes instead of becoming stranded (the #89 regression).
 * - Work displays share the count and elapsed time, including after a completed turn is reopened.
 * - Given a Compact run waiting on an approval, its line opens by itself with Allow and Deny.
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
  await expect(group.locator("[data-step-count]")).toHaveText("4 步");
  await changeActivityDisplay(page, userId, "展开");
  await openSteps(group);
  await expect(rows).toHaveCount(4);
  await expect(group.getByText("I will check the first entry.", { exact: true })).toBeVisible();
  await expect(group.getByText("entry 2", { exact: true })).toBeVisible();
  await changeActivityDisplay(page, userId, "紧凑");

  const count = group.locator("[data-step-count]");
  await expect(count).toHaveText("4 步");
  await expect(group.locator("[data-step-terminal]")).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expectFoldedBodies(group);
  await openSteps(group);
  await expect(rows).toHaveCount(4);
  await expectFoldedBodies(group);
  await rows.last().locator("button[aria-expanded]").first().click();
  await expect(rows.getByText("entry 2", { exact: true })).toBeVisible();

  await setAccountPrefs(page.request, { themeId: "github" });
  await page.reload();
  await expect(count).toHaveText("4 步");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("Both tools finished.", { exact: true })).toHaveCount(1);
});

test("compact activity follows two approvals while preserving the first reader's open details", async ({
  page,
  context,
}) => {
  const userId = "smokeactivity";
  const sessionId = await createSession(page, userId, "always-ask", "modern");
  await changeActivityDisplay(page, userId, "紧凑");
  await send(page, "activity pages test");
  const group = activityRoot(page),
    count = group.locator("[data-step-count]"),
    rows = activityRows(group);
  await expect(count).toHaveText("2 步");
  // The run waits on an approval: the line opens by itself, so Allow and Deny show at once.
  await expect(rows).toHaveCount(2);
  await expect(group.getByRole("button", { name: "允许", exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "拒绝", exact: true })).toBeVisible();
  await expect(rows.first()).not.toContainText("I will check");

  const total = group.locator("[data-step-elapsed] .font-mono");
  const runningTime = await total.innerText();
  await expect(total).not.toHaveText(runningTime);
  const reviewer = await context.newPage();
  await reviewer.goto(`/chat/${sessionId}`);
  const reviewing = activityRoot(reviewer);
  await rows.locator("button[aria-expanded]").first().click();
  await expect(group.getByText("I will check the first entry.", { exact: true })).toBeVisible();

  // The second reader approves the same Session while the first keeps the original thinking open.
  await openSteps(reviewing);
  const allow = reviewing.getByRole("button", { name: "允许", exact: true });
  if (!(await allow.isVisible()))
    await activityRows(reviewing).locator("button[aria-expanded]").first().click();
  await allow.click();
  await expect(count).toHaveText("4 步");
  await expect(group.getByText("I will check the first entry.", { exact: true })).toBeVisible();
  await group.locator("[data-group-header]").click();
  await expect(rows).toHaveCount(0);
  await openSteps(reviewing);
  if (!(await allow.isVisible()))
    await activityRows(reviewing).locator("button[aria-expanded]").first().click();
  await allow.click();
  await expect(page.getByText("Both tools finished.", { exact: true })).toBeVisible();
  await expect(count).toHaveText("4 步");
  await expect(rows).toHaveCount(0);
  await expect(reviewing.locator("[data-step-terminal] [data-slot=label]")).toHaveText("已完成");
  await reviewer.close();
});

test("the current step leaves room for the same count and clock in each display mode", async ({
  page,
}) => {
  const sessionId = await createSession(page, "smokeliveworkalignment", "always-ask", "modern");
  await send(page, "ten-step work history");
  const group = activityRoot(page),
    header = group.locator("[data-group-header]");
  for (const lang of ["en", "zh"]) {
    const first = new Map();
    for (const activityDisplayMode of ["standard", "expanded", "compact"]) {
      await setAccountPrefs(page.request, { lang, activityDisplayMode, toolAliases: false });
      await page.reload();
      await expect(group).toHaveAttribute("data-step-view", activityDisplayMode);
      await expect(header.locator("[data-step-count]")).toHaveText(
        lang === "zh" ? "2 步" : "2 steps",
      );
      await expect(header).not.toHaveAttribute("data-step-terminal", "true");
      if (activityDisplayMode === "compact") await expect(header).toContainText("起草评审记录");
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 800 });
        const [box, count, clock] = await Promise.all(
          [header, header.locator("[data-step-count]"), header.locator("[data-step-elapsed]")].map(
            (part) => part.boundingBox(),
          ),
        );
        const positions = [count.x - box.x, clock.x - box.x, count.y - box.y, clock.y - box.y];
        if (!first.has(width)) first.set(width, positions);
        for (const [i, pos] of positions.entries())
          expect(Math.abs(pos - first.get(width)[i])).toBeLessThanOrEqual(1);
        expect(clock.x + clock.width).toBeLessThanOrEqual(width);
      }
    }
  }
  await expect(await page.request.post(`/api/sessions/${sessionId}/abort`, { data: {} })).toBeOK();
  await expect(header.locator('[data-slot="label"]')).toHaveText("已停止");
  await page.reload();
  await expect(header.locator('[data-slot="label"]')).toHaveText("已停止");
});

test("reopened ten-step history keeps its compact header together on desktop and narrow screens", async ({
  page,
}) => {
  await createSession(page, "smokeworkhistory", "allow-all", "doodle");
  await setAccountPrefs(page.request, { activityDisplayMode: "compact", toolAliases: false });
  await page.reload();
  await send(page, "ten-step work history");
  await expect(page.getByText("The review notes are ready.", { exact: true })).toBeVisible();
  const group = activityRoot(page),
    head = group.locator("[data-group-header]"),
    count = head.locator("[data-step-count]"),
    elapsed = head.locator("[data-step-elapsed]"),
    arrow = head.locator('[data-slot="toggle"]'),
    rows = activityRows(group);
  for (const [lang, n] of [
    ["zh", "10 步"],
    ["en", "10 steps"],
  ]) {
    const positions = new Map();
    let time;
    for (const activityDisplayMode of ["standard", "expanded", "compact"]) {
      await setAccountPrefs(page.request, { lang, activityDisplayMode });
      await page.reload();
      await expect(group).toHaveAttribute("data-step-view", activityDisplayMode);
      await expect(head).toHaveAttribute("data-step-terminal", "true");
      await expect(head.locator('[data-slot="label"]')).toHaveText(
        lang === "zh" ? "已完成" : "Done",
      );
      await expect(head).not.toContainText("read_file");
      await expect(count).toHaveText(n);
      await expect(rows).toHaveCount(activityDisplayMode === "expanded" ? 10 : 0);
      time ??= await elapsed.locator(".font-mono").innerText();
      await expect(elapsed.locator(".font-mono")).toHaveText(time);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        const [box, title, tally, clock, toggle] = await Promise.all(
          [head, head.locator('[data-slot="label"]'), count, elapsed, arrow].map((el) =>
            el.boundingBox(),
          ),
        );
        const offsets = [tally.x - box.x, clock.x - box.x, tally.y - box.y, clock.y - box.y];
        const reference = positions.get(width) ?? offsets;
        positions.set(width, reference);
        for (const [i, value] of offsets.entries()) {
          expect(Math.abs(value - reference[i])).toBeLessThanOrEqual(1);
        }
        for (const part of [tally, clock, toggle]) {
          expect(part.x).toBeGreaterThanOrEqual(box.x);
          expect(part.x + part.width).toBeLessThanOrEqual(Math.min(width, box.x + box.width) + 1);
          expect(Math.abs(part.y + part.height / 2 - (title.y + title.height / 2))).toBeLessThan(5);
        }
        expect(clock.x - tally.x - tally.width).toBeLessThan(18);
        expect(toggle.x - clock.x - clock.width).toBeLessThan(18);
        await expect(head.locator("button,input")).toHaveCount(0);
      }
    }
    await head.focus();
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(10);
    await rows.first().locator("button[aria-expanded]").first().click();
    await expect(rows.first()).toContainText("Reviewing item 1.");
    await expect(elapsed.locator(".font-mono")).toHaveText(time);
  }
});

test("the reply form stays inside the conversation and fills the composer from the keyboard", async ({
  page,
}) => {
  await createSession(page, "smokea2uireview", "allow-all");
  await send(page, "prepare the A2UI review card");
  const card = page.locator('[data-a2ui="form"]');
  for (const [width, themeId, themeMode] of [
    [1280, "modern", "dark"],
    [320, "doodle", "light"],
  ]) {
    await setAccountPrefs(page.request, { themeId, themeMode });
    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    await expect(
      page.getByText("Review the changes before scheduling the release.", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("Review request", { exact: true })).toBeVisible();
    const surface = await card.evaluate((el) => ({
      border: getComputedStyle(el).borderTopWidth,
      inset: getComputedStyle(el).paddingInlineStart,
      fill: getComputedStyle(el).backgroundColor,
      width: el.clientWidth,
      content: el.scrollWidth,
      right: el.getBoundingClientRect().right,
    }));
    expect(parseFloat(surface.border)).toBeGreaterThan(0);
    expect(parseFloat(surface.inset)).toBeGreaterThanOrEqual(8);
    expect(surface.fill).not.toEqual("rgba(0, 0, 0, 0)");
    expect(surface.content).toBeLessThanOrEqual(surface.width + 1);
    expect(surface.right).toBeLessThanOrEqual(width);
    await expect(card.getByRole("button", { name: "Use answers" })).toBeDisabled();
  }
  const reviewer = card.getByRole("textbox", { name: /Reviewer/ });
  await reviewer.fill("Morgan");
  await reviewer.press("Enter");
  await expect(page.locator('[data-slot="composer"] textarea:visible')).toHaveValue(
    /Reviewer.*Morgan/,
  );
  await expect(
    page.getByText("Send the review when you are ready.", { exact: true }),
  ).toBeVisible();
});
