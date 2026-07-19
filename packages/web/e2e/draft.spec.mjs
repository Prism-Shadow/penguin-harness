/**
 * End-to-end test for the draft-state new-conversation flow:
 * - /chat/new lets you pick Model / approval mode up front; the Session is only created when
 *   the first message is sent, and all four selections land faithfully in its meta;
 * - the draft auto-caches (body persisted via debounce): after a page reload, both the body and
 *   the selections are restored, and the cache clears once sending succeeds;
 * - the sidebar group header's "+" creates a draft scoped to that group's Agent (explicitly set
 *   via router state, overriding the cache).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "draftuser";
const P = "password123";

test("draft: 选模型/审批 → 刷新保留 → 发送建会话并清缓存 → 侧栏 + 指定 Agent", async ({ page }) => {
  // Draft keys are isolated by user x Project/Session (#68); building the key needs userId (i.e. the username).
  const userId = (await provisionAndLogin(page.request, U, P)).userId;

  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  // Two models: claude-4-8 as default, plus claude-4-8-mini for the draft to switch to (both point at the mock).
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
        },
        {
          provider: "custom",
          modelId: "claude-4-8-mini",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 100000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  // The only builtin Agent is default_agent, so the @ delegation and sidebar group-header "+" targets use a custom-created Agent.
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_helper", name: "Helper Agent" },
  });
  expect(created.ok(), "create helper agent").toBeTruthy();

  // No Session exists yet: entering the site lands on the draft page (the brand heading marks the draft page).
  await page.goto(`${BASE}/chat`);
  await expect(page.getByRole("heading", { name: "PenguinHarness" })).toBeVisible();

  const ta = page.getByPlaceholder(/输入消息/);
  await ta.fill("草稿正文不能丢");

  // The @ delegation target is also draft content: typing an @ prefix at the end summons the
  // menu, selecting it turns into a chip (the @token in the body text is stripped out).
  await ta.fill("草稿正文不能丢 @agent_hel");
  await page.getByRole("button", { name: /@agent_helper/ }).click();
  await expect(page.getByText("@agent_helper")).toBeVisible();
  await expect(ta).toHaveValue("草稿正文不能丢");

  // Switch the model: the selector sits to the left of the send button, opens downward, with a quick-search field at the top.
  await page.getByRole("button", { name: "选择模型" }).click();
  await page.getByPlaceholder(/搜索模型/).fill("mini");
  await page.getByRole("button", { name: /claude-4-8-mini/ }).click();

  // Switch the approval mode to read-only (the trigger button shows the Chinese description).
  await page.getByRole("button", { name: "审批模式" }).click();
  await page.getByRole("button", { name: /放行只读/ }).click();
  await expect(page.getByRole("button", { name: "审批模式" })).toContainText("放行只读");

  // Reload only after the body is persisted via debounce: both the body and the two selections should restore from the cache.
  const draftKey = `penguin.chatDraft.${userId}.${projectId}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), draftKey))
    .toContain("草稿正文不能丢");

  await page.reload();
  await expect(ta).toHaveValue("草稿正文不能丢");
  // After restoring, the cursor lands at the end of the draft (focus defaults to the start, so it must be explicitly moved to the end to keep typing).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector("textarea");
        return el ? el.selectionStart === el.value.length && el.value.length > 0 : false;
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("claude-4-8-mini");
  await expect(page.getByRole("button", { name: "审批模式" })).toContainText("放行只读");
  // The @ target restores along with the draft; removing it falls back to a normal send (no delegation triggered).
  await expect(page.getByText("@agent_helper")).toBeVisible();
  await page.getByRole("button", { name: "移除 @ 目标" }).click();
  await expect(page.getByText("@agent_helper")).toHaveCount(0);

  // Send: the Session is only created now, and the selections land faithfully in its meta.
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const firstSessionId = page.url().split("/chat/")[1];
  const first = await (await page.request.get(`${BASE}/api/sessions/${firstSessionId}`)).json();
  expect(first.session.agentId).toBe("default_agent");
  expect(first.session.modelId).toBe("claude-4-8-mini");
  expect(first.session.provider).toBe("custom");
  expect(first.session.approvalMode).toBe("read-only");

  // The cache clears as soon as sending succeeds.
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), draftKey)).toBeNull();

  // —— Sidebar group-header "+": create a draft with that group's Agent (overrides the previously cached Agent) ——
  const helperHeader = page.getByText("Helper Agent", { exact: true }).first();
  await expect(helperHeader).toBeVisible();
  const groupRow = helperHeader.locator("xpath=ancestor::div[contains(@class,'items-center')][1]");
  await groupRow.getByRole("button", { name: "新建对话" }).click();

  await expect(page.getByLabel("选择 Agent")).toContainText("Helper Agent");
  await ta.fill("给 helper 的第一条");
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const secondSessionId = page.url().split("/chat/")[1];
  expect(secondSessionId).not.toBe(firstSessionId);
  const second = await (await page.request.get(`${BASE}/api/sessions/${secondSessionId}`)).json();
  expect(second.session.agentId).toBe("agent_helper");
  // No selection was changed: the model falls back to the project default, and approval mode falls back to allow-all (the previous draft was cleared, so read-only doesn't linger).
  expect(second.session.modelId).toBe("claude-4-8");
  expect(second.session.provider).toBe("custom");
  expect(second.session.approvalMode).toBe("allow-all");

  // Under allow-all, the mock's exec_command is auto-approved, so the round runs to completion (turn 2 text lands).
  await expect(page.getByText("命令已执行完成，结果符合预期。")).toBeVisible();

  // —— Input draft for an existing session: cached by user x Session, restored on reload, cleared once sending succeeds ——
  await ta.fill("会话里的草稿");
  const sessionKey = `penguin.chatDraft.session.${userId}.${secondSessionId}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey))
    .toContain("会话里的草稿");

  await page.reload();
  await expect(ta).toHaveValue("会话里的草稿");
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey)).toBeNull();
});
