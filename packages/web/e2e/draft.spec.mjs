/**
 * End-to-end test for the draft-state new-conversation flow:
 * - /chat/new lets you pick Model and the system-wide approval mode up front; the Session is
 *   only created when the first message is sent, and the model lands faithfully in its meta;
 * - the draft auto-caches (body persisted via debounce): after a page reload, both the body and
 *   the selections are restored, and the cache clears once sending succeeds;
 * - the sidebar defaults to grouping by Workspace: auto temp directories merge into one
 *   "临时工作区" group, a named directory groups under its basename, and that group header's
 *   "+" pre-fills the draft's Workspace (via router state, applied once per navigation — a
 *   manual change made afterwards survives a reload instead of being re-overridden);
 * - the group header's hover pin toggle lifts a group above the unpinned ones in its mode and
 *   persists per Project (order re-checked after a reload);
 * - after switching the sidebar to agent mode (toggle persisted in localStorage), the agent
 *   group header's "+" creates a draft scoped to that group's Agent (explicitly set via router
 *   state, overriding the cache);
 * - both switch commands are **staged**: `/model` and `/agent` pin a chip and send nothing, the
 *   chip is cached with the body text (it survives a reload), and pressing Enter afterwards is
 *   what actually forks the conversation onto the picked model / hands it to the picked Agent —
 *   carrying the text typed after the pick into the new conversation.
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

  // The only builtin Agent is default_agent, so the /agent handoff and sidebar group-header "+" targets use a custom-created Agent.
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_helper", name: "Helper Agent" },
  });
  expect(created.ok(), "create helper agent").toBeTruthy();

  // No Session exists yet: entering the site lands on the draft page (the brand heading marks the draft page).
  await page.goto(`${BASE}/chat`);
  await expect(page.getByRole("heading", { name: "PenguinHarness" })).toBeVisible();

  const ta = page.getByPlaceholder(/输入消息/);

  // `/agent` is a SESSION command: a draft has no conversation to hand over, and its Agent is
  // chosen by the draft page's own selector — so the slash menu must not offer it here (the
  // staged-handoff flow itself is covered in the session section below). The menu does open on
  // the same prefix, matching the installed `/agent-*` skills — which is what makes the absent
  // command row a real assertion rather than a menu that simply never appeared.
  await ta.fill("/agent");
  await expect(page.getByRole("button", { name: /^\/agent-creation/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "/agent 交给其他 Agent，发送时开启新会话" }),
  ).toHaveCount(0);
  await ta.fill("Draft body must not be lost");

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

  // Reload only after the body is persisted via debounce: the body/model restore from the
  // cache, while approval mode reloads from the system setting.
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
  // Send: the Session is only created now, and it observes the current system-wide mode.
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const firstSessionId = page.url().split("/chat/")[1];
  const first = await (await page.request.get(`${BASE}/api/sessions/${firstSessionId}`)).json();
  expect(first.session.agentId).toBe("default_agent");
  expect(first.session.modelId).toBe("claude-4-8-mini");
  expect(first.session.provider).toBe("custom");
  expect(first.session.approvalMode).toBe("read-only");

  // session_meta holds per-session invariants only: the thinking level became a per-turn
  // Task parameter and is no longer recorded in the trace meta. The session composer shows
  // the editable per-turn picker instead of the old read-only tag: while the user hasn't
  // picked, it displays the Agent config's level (auto-follow — "high" was written through
  // above) and sends omit the level; a pick sticks and rides on every subsequent send.
  const replay = await (
    await page.request.get(`${BASE}/api/sessions/${firstSessionId}/messages`)
  ).json();
  const meta = replay.messages.find((m) => m.type === "session_meta");
  expect(meta?.payload?.thinking_level).toBeUndefined();
  await expect(page.getByTitle("思考等级：高")).toBeVisible();

  // On a successful send the cache clears — except the model selection. Approval mode never
  // lives in the draft cache; it remains in the system setting.
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

  // —— Pinning: the header's hover pin toggle lifts a group above the others in its mode and
  // persists per Project (localStorage penguin.sidebarPinnedGroups.<projectId>); order is
  // asserted geometrically, like layout.spec does for the login language buttons. ——
  const tempLabel = page.getByText("临时工作区", { exact: true });
  const namedLabel = page.getByText(wsLabel, { exact: true });
  const yOf = async (locator) => (await locator.boundingBox())?.y ?? -1;
  // Unpinned baseline: the merged temp group sits below the named group.
  await expect(tempLabel).toBeVisible();
  expect(await yOf(tempLabel)).toBeGreaterThan(await yOf(namedLabel));
  const tempHeader = tempLabel.locator("xpath=ancestor::div[contains(@class,'items-center')][1]");
  await tempHeader.hover();
  await tempHeader.getByRole("button", { name: "置顶分组" }).click();
  await expect
    .poll(() =>
      page.evaluate((k) => localStorage.getItem(k), `penguin.sidebarPinnedGroups.${projectId}`),
    )
    .toContain("temp-workspaces");
  await expect.poll(async () => (await yOf(tempLabel)) < (await yOf(namedLabel))).toBe(true);
  // Pinned state and order survive a reload. The pin button's accessible name is STATIC
  // ("置顶分组"); the state lives in aria-pressed alone (review: a name swapping to 取消置顶
  // alongside aria-pressed announces the state twice in conflicting ways).
  await page.reload();
  await expect(tempLabel).toBeVisible();
  await expect.poll(async () => (await yOf(tempLabel)) < (await yOf(namedLabel))).toBe(true);
  const tempPin = tempHeader.getByRole("button", { name: "置顶分组" });
  await expect(tempPin).toHaveAttribute("aria-pressed", "true");
  // The pinned pin doubles as the always-visible indicator. toBeVisible() ignores opacity,
  // so assert computed opacity directly: pinned = 1 with the mouse elsewhere; an unpinned
  // header's pin stays hover-gated at 0. Park the mouse first — after the reorder the named
  // header sits where the temp header was clicked, which would otherwise hover-reveal it.
  await page.mouse.move(640, 500);
  await expect.poll(() => tempPin.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await expect
    .poll(() =>
      wsHeader
        .getByRole("button", { name: "置顶分组" })
        .evaluate((el) => getComputedStyle(el).opacity),
    )
    .toBe("0");

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
  // approval mode comes from the system-wide setting.
  expect(second.session.modelId).toBe("claude-4-8-mini");
  expect(second.session.provider).toBe("custom");
  expect(second.session.approvalMode).toBe("read-only");

  // read-only escalates the mock's exec_command. Approve this call, then change the picker to
  // allow-all: the system setting and every existing Session update together, keeping the
  // remaining flow auto-approved.
  await page.getByRole("button", { name: "允许" }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
  await page.getByRole("button", { name: "审批模式" }).click();
  await page.getByRole("button", { name: /全部放行/ }).click();
  await expect(page.getByRole("button", { name: "审批模式" })).toContainText("全部放行");
  await expect
    .poll(async () => {
      const setting = await (await page.request.get(`${BASE}/api/settings/approval-mode`)).json();
      return setting.approvalMode;
    })
    .toBe("allow-all");
  await expect
    .poll(async () => {
      const current = await (
        await page.request.get(`${BASE}/api/sessions/${firstSessionId}`)
      ).json();
      return current.session.approvalMode;
    })
    .toBe("allow-all");

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

  // —— /model stages the fork; Enter is what performs it ——
  // Wait for the run above to finish first: the slash menu is suppressed while a Task runs, and
  // a staged fork deliberately refuses to send until the Session is idle (it continues from a
  // Trace the run is still appending to). Two signals, in order: the second round's closing
  // text lands (this Session has now answered two messages), then the action button stops being
  // Stop — which it is for as long as a Task runs with an empty composer.
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await ta.fill("/model");
  await ta.press("Enter");
  await expect(page.getByText("切换模型", { exact: true })).toBeVisible(); // picker title bar
  await expect(ta).toHaveValue(""); // the command consumed its own token
  await page.getByPlaceholder(/搜索模型/).fill("claude-4-8");
  // Both models match the query (one id is the other's prefix); pick the non-mini one, i.e. not
  // the model this Session already runs on.
  await page
    .getByRole("button", { name: /claude-4-8/ })
    .filter({ hasNotText: "mini" })
    .click();

  // Nothing was sent: we are still in the same Session, with the pick pinned as a chip — which
  // is why the body can be typed AFTER the pick and still ride along.
  await expect(page).toHaveURL(new RegExp(`/chat/${secondSessionId}$`));
  await expect(page.getByLabel("移除切换模型")).toBeVisible();
  await ta.fill("Fork body typed after the pick");

  // The chip is draft content, cached in the SAME entry as the text (poll on the text: it is
  // the debounced field, so its arrival means everything is flushed), and a reload restores
  // BOTH. A chip lost while its text survived would send that text to the current Session on
  // the old model — the opposite of what was staged.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey))
    .toContain("Fork body typed after the pick");
  expect(await page.evaluate((k) => localStorage.getItem(k), sessionKey)).toContain("claude-4-8");
  await page.reload();
  await expect(ta).toHaveValue("Fork body typed after the pick");
  await expect(page.getByLabel("移除切换模型")).toBeVisible();

  // Enter performs the fork: a NEW Session on the picked model, same Agent, carrying the body.
  await ta.press("Enter");
  await page.waitForURL(
    (url) => /\/chat\/session-/.test(url.pathname) && !url.href.endsWith(secondSessionId),
  );
  const thirdSessionId = page.url().split("/chat/")[1];
  const third = await (await page.request.get(`${BASE}/api/sessions/${thirdSessionId}`)).json();
  expect(third.session.modelId).toBe("claude-4-8");
  expect(third.session.agentId).toBe("agent_helper");
  // The source block collapses into the "switched model" banner, and the typed body follows it.
  await expect(page.getByText(/已切换模型（原为 claude-4-8-mini）/)).toBeVisible();
  await expect(page.getByText("Fork body typed after the pick")).toBeVisible();

  // —— /agent stages the handoff; Enter is what performs it ——
  // The forked Session started its own run; wait it out the same way (a fresh stream, so its
  // first closing text is the only one).
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
  await ta.fill("/agent");
  await ta.press("Enter");
  await page.getByPlaceholder(/搜索 Agent/).fill("default");
  await page.getByRole("button", { name: /default_agent/ }).click();
  // Staged only: still in the forked Session, still able to type the message to hand over.
  await expect(page).toHaveURL(new RegExp(`/chat/${thirdSessionId}$`));
  await expect(page.getByLabel("移除交接目标")).toBeVisible();
  await ta.fill("Handoff body typed after the pick");

  await ta.press("Enter");
  await page.waitForURL(
    (url) => /\/chat\/session-/.test(url.pathname) && !url.href.endsWith(thirdSessionId),
  );
  const fourthSessionId = page.url().split("/chat/")[1];
  const fourth = await (await page.request.get(`${BASE}/api/sessions/${fourthSessionId}`)).json();
  expect(fourth.session.agentId).toBe("default_agent");
  // The [handoff_from] block collapses into the origin banner (the source agent is named
  // without an @ sigil, matching the composer chip), and the typed body follows it.
  await expect(page.getByText(/由 .*agent_helper.* 的对话交接而来/)).toBeVisible();
  await expect(page.getByText("Handoff body typed after the pick")).toBeVisible();
});
