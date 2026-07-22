/**
 * End-to-end test for the draft-state new-conversation flow:
 * - /chat/new lets you pick Model / approval mode up front; the Session is only created when
 *   the first message is sent, and all four selections land faithfully in its meta;
 * - the draft auto-caches (body persisted via debounce): after a page reload, both the body and
 *   the selections are restored, and the cache clears once sending succeeds;
 * - the sidebar defaults to grouping by Workspace: auto temp directories merge into one
 *   "临时工作区" group, a named directory groups under its basename, and that group header's
 *   "+" pre-fills the draft's Workspace (via router state, applied once per navigation — a
 *   manual change made afterwards survives a reload instead of being re-overridden);
 * - after switching the sidebar to agent mode (toggle persisted in localStorage), the agent
 *   group header's "+" creates a draft scoped to that group's Agent (explicitly set via router
 *   state, overriding the cache).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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

  // Conversation-time thinking level (backed by the Agent settings): the picker shows the
  // seeded default (medium, short name 中); the menu carries a title bar and the short-name
  // rows 低/中/高/极高 only — no descriptions, no default row, and no 无 (many models cannot
  // disable thinking); picking 高 writes straight through to the Agent config, so the session
  // created on send runs with it and it becomes the Agent's new default.
  const thinkingBtn = page.getByRole("button", { name: "思考等级" });
  await expect(thinkingBtn).toContainText("中");
  await thinkingBtn.click();
  await expect(page.getByText("思考等级", { exact: true })).toBeVisible(); // menu title bar
  await expect(page.getByRole("button", { name: "低", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "无", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "高", exact: true }).click();
  await expect(thinkingBtn).toContainText("高");
  await expect
    .poll(async () => {
      const cfg = await (
        await page.request.get(`${BASE}/api/projects/${projectId}/agents/default_agent/config`)
      ).json();
      return cfg.config.model?.thinkingLevel;
    })
    .toBe("high");

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
  // The thinking level is NOT draft state: it restores from the Agent config (written through above), not the cache.
  await expect(page.getByRole("button", { name: "思考等级" })).toContainText("高");
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

  // The written-through thinking level reached the session: its trace's session_meta records
  // the level llmConfig was assembled with (per-session fixed), and the input area shows the
  // read-only tag next to the locked model.
  const replay = await (
    await page.request.get(`${BASE}/api/sessions/${firstSessionId}/messages`)
  ).json();
  const meta = replay.messages.find((m) => m.type === "session_meta");
  expect(meta?.payload?.thinking_level).toBe("high");
  await expect(page.getByTitle("思考等级：高")).toBeVisible();

  // On a successful send the cache clears — except the model selection, which carries over as
  // the next conversation's default (switch-becomes-default, like the thinking level above).
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), draftKey))
    .toContain("claude-4-8-mini");
  expect(await page.evaluate((k) => localStorage.getItem(k), draftKey)).not.toContain(
    "Draft body must not be lost",
  );

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

  // Regression (review): the route-state prefill applies once per navigation only — after the
  // user picks a different directory and reloads, the restored cached choice must win; the
  // prefill must NOT re-apply (location.state survives a reload inside history.state, so the
  // consumed marker lives in sessionStorage rather than a ref). Browse one level up and select
  // it; the path row mirrors the loaded directory, which orders the two clicks deterministically.
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  // Match by trailing basename: the server realpaths the browsed directory, so the prefix may differ from the raw mkdtemp path.
  await expect(page.getByRole("textbox", { name: "Workspace" })).toHaveValue(
    new RegExp(`${wsLabel}$`),
  );
  await page.getByRole("button", { name: "上级目录" }).click();
  await expect(page.getByRole("textbox", { name: "Workspace" })).not.toHaveValue(
    new RegExp(`${wsLabel}$`),
  );
  await page.getByRole("button", { name: "使用此目录" }).click();
  const parentLabel = basename(dirname(namedWs));
  await expect(page.getByLabel("Workspace")).toContainText(parentLabel);
  await page.reload();
  await expect(page.getByLabel("Workspace")).toContainText(parentLabel);
  await expect(page.getByLabel("Workspace")).not.toContainText(wsLabel);

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
  // The previously picked model carries over as the new default (switch-becomes-default);
  // approval mode falls back to allow-all (the rest of the draft was cleared, so read-only doesn't linger).
  expect(second.session.modelId).toBe("claude-4-8-mini");
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
