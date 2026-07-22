/**
 * End-to-end test for the draft-state new-conversation flow:
 * - /chat/new lets you pick Model / approval mode up front; the Session is only created when
 *   the first message is sent, and all four selections land faithfully in its meta;
 * - the draft auto-caches (body persisted via debounce): after a page reload, both the body and
 *   the selections are restored, and the cache clears once sending succeeds;
 * - the sidebar defaults to grouping by Workspace: auto temp directories merge into one
 *   "临时工作区" group, a named directory groups under its basename, and that group header's
 *   "+" pre-fills the draft's Workspace (via router state);
 * - after switching the sidebar to agent mode (toggle persisted in localStorage), the agent
 *   group header's "+" creates a draft scoped to that group's Agent (explicitly set via router
 *   state, overriding the cache).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "draftuser";
const P = "password123";

test("draft: pick model/approval -> reload restores them -> send creates the session and clears the cache -> sidebar + scopes the Agent", async ({
  page,
}) => {
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
  await ta.fill("Draft body must not be lost");

  // The @ delegation target is also draft content: typing an @ prefix at the end summons the
  // menu, selecting it turns into a chip (the @token in the body text is stripped out).
  await ta.fill("Draft body must not be lost @agent_hel");
  await page.getByRole("button", { name: /@agent_helper/ }).click();
  await expect(page.getByText("@agent_helper")).toBeVisible();
  await expect(ta).toHaveValue("Draft body must not be lost");

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
    .toContain("Draft body must not be lost");

  await page.reload();
  await expect(ta).toHaveValue("Draft body must not be lost");
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

  // —— Default grouping: the sidebar groups Sessions by Workspace — the session just created
  // used the auto temp directory, so it lands in the merged "临时工作区" group. ——
  await expect(page.getByText("临时工作区")).toBeVisible();

  // A session in a named Workspace groups under that directory's basename, and its group
  // header's "+" pre-fills the draft's Workspace selection with the group's path.
  const namedWs = mkdtempSync(join(tmpdir(), "penguin-e2e-ws-"));
  const namedRes = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { workspace: namedWs } },
  );
  expect(namedRes.ok(), "create session in named workspace").toBeTruthy();
  await page.reload();
  const wsLabel = basename(namedWs);
  const wsHeader = page
    .getByText(wsLabel, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'items-center')][1]");
  await wsHeader.getByRole("button", { name: "在此工作区新建对话" }).click();
  await expect(page.getByRole("heading", { name: "PenguinHarness" })).toBeVisible();
  await expect(page.getByLabel("Workspace")).toContainText(wsLabel);

  // —— Switch the sidebar to agent mode via the section-header toggle (persists in localStorage) ——
  await page.getByRole("button", { name: "按 Agent 分组" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("penguin.sidebarGroupMode")))
    .toBe("agent");

  // —— Sidebar group-header "+": create a draft with that group's Agent (overrides the previously cached Agent) ——
  const helperHeader = page.getByText("Helper Agent", { exact: true }).first();
  await expect(helperHeader).toBeVisible();
  const groupRow = helperHeader.locator("xpath=ancestor::div[contains(@class,'items-center')][1]");
  await groupRow.getByRole("button", { name: "新建对话" }).click();

  await expect(page.getByLabel("选择 Agent")).toContainText("Helper Agent");
  await ta.fill("First message for helper");
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
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // —— Input draft for an existing session: cached by user x Session, restored on reload, cleared once sending succeeds ——
  await ta.fill("Draft inside the session");
  const sessionKey = `penguin.chatDraft.session.${userId}.${secondSessionId}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey))
    .toContain("Draft inside the session");

  await page.reload();
  await expect(ta).toHaveValue("Draft inside the session");
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey)).toBeNull();
});
