import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "e2euser";
const P = "password123";

test("chat + tool approval + stats/cost/copy + traces + files", async ({ page }) => {
  // --- seed via API (cookies land in the browser context) ---
  await provisionAndLogin(page.request, U, P);

  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

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
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  const agents = await (await page.request.get(`${BASE}/api/projects/${projectId}/agents`)).json();
  // The project ships with exactly one builtin agent: default_agent.
  const agentIds = agents.agents.map((a) => a.agentId);
  expect(agentIds).toEqual(["default_agent"]);
  const agentId = "default_agent";

  // Approval defaults to allow-all; this test verifies the manual approval flow, so specify always-ask explicitly.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "always-ask" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  // --- chat ---
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();

  // Approval-mode is a custom dropdown (button), NOT a native <select>.
  await expect(page.locator("select")).toHaveCount(0);

  await ta.fill("Help me set up @theme");
  await page.getByRole("button", { name: "发送" }).click();

  // Tool name is shown on the collapsed tool row + in the pending-approval block.
  await expect(page.getByText("exec_command").first()).toBeVisible();
  // Thinking + tool calls are wrapped in a work group; header shows running/done status.
  await expect(page.getByText("运行中").first()).toBeVisible();
  // The user takes control of the running work group (toggle = userToggled), keeps it open, and
  // opens the exec_command card to watch the arguments. Both must survive the end of the turn.
  //
  // The group deliberately auto-collapses once it is no longer the last segment — but only when the
  // user has NOT toggled it (WorkGroup keeps that in a ref). A remount wipes both the ref and the
  // open state, so the group would collapse anyway and take the card down with it (the body is
  // conditionally rendered). That is what happens if the turn's `group` container is created only
  // when the stats line lands: the already-rendered work group moves into a new parent, React
  // unmounts and remounts it, and the user's open card snaps shut the instant the reply finishes.
  // (aria-expanded can't be asserted in between: a pending approval force-shows the body no matter
  // what `open` says — the approval row lives in there.)
  const runningGroup = page.locator("button[aria-expanded]").filter({ hasText: "运行中" }).first();
  await runningGroup.click(); // toggle → marks the group user-toggled (open := false)
  await runningGroup.click(); // toggle back → the user is deliberately keeping it open

  const toolCard = page
    .locator("button[aria-expanded]")
    .filter({ hasText: "exec_command" })
    .first();
  await toolCard.click();
  await expect(toolCard).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: "允许" }).click();

  // Final assistant answer (turn 2 from mock).
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // Chat links always open in a new tab and never navigate the SPA away — including bare URLs
  // that remark-gfm autolinks (the mock reply carries one inside a CJK sentence).
  const replyLink = page.locator(".md-body a", { hasText: "example.com" }).first();
  await expect(replyLink).toBeVisible();
  await expect(replyLink).toHaveAttribute("href", /^https:\/\/example\.com\//);
  await expect(replyLink).toHaveAttribute("target", "_blank");
  await expect(replyLink).toHaveAttribute("rel", "noreferrer");
  // Wide Markdown tables scroll inside the message body instead of pushing the page wide.
  const replyTable = page.locator(".md-body table").first();
  await expect(replyTable).toBeVisible();
  expect(await replyTable.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");

  // Regression: after entering a session and rendering messages, the page must not overflow
  // horizontally (previously, with the Files dock panel closed, the sr-only upload input was
  // anchored to the initial containing block, bypassing the panel's overflow-hidden and
  // stretching the document wide enough to create a horizontal scrollbar). The turn-2 reply
  // above deliberately contains a ~170-char bare URL in CJK prose and a table with a 118-char
  // unbreakable token — this assertion also proves the URL wraps and the table scrolls inside
  // the message column instead of blowing out the page.
  const docWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(docWidth.scrollWidth, "no horizontal page overflow").toBeLessThanOrEqual(
    docWidth.clientWidth,
  );

  // Turn is over and the stats line has landed. The card is still open — which also proves the
  // group did not collapse (a collapsed group unmounts its body, so the card would be gone).
  await expect(
    page.locator("button[aria-expanded]").filter({ hasText: "exec_command" }).first(),
  ).toHaveAttribute("aria-expanded", "true");

  // The stats line IS the AI reply's footer (bottom-left, mirroring the user footer's bottom-right):
  // stats + reply-time + copy, the whole line hover-gated. Scope assertions to it (NOT page-wide):
  // the top bar also renders a session cost, so a page-wide /$0.\d+/ would match the header and
  // prove nothing about this line.
  const copyBtn = page.getByRole("button", { name: "复制回复" }).first();
  const statsLine = copyBtn.locator("xpath=..");
  await expect(statsLine.locator("text=/\\$0\\.\\d+/")).toBeVisible(); // cost chip (pricing set)

  // Hidden by default but SPACE-RESERVED (opacity-0, not hidden). Park the cursor first: after
  // clicking 允许 ("Allow") the pointer sits where that button was and the re-render can drop a
  // hoverable row right under it, which would flake the "hidden" assert.
  await page.mouse.move(0, 0);
  await expect(statsLine).toHaveCSS("opacity", "0");
  expect(
    await copyBtn.boundingBox(),
    "footer must occupy space even while invisible",
  ).not.toBeNull();

  // Hovering the REPLY ITSELF must reveal it — the reply and its stats line share a `group` wrapper
  // for exactly this. Requiring a hover on the number row would make the footer undiscoverable.
  await page.getByText("Command finished; the result looks as expected.").first().hover();
  await expect(statsLine).toHaveCSS("opacity", "1");
  await expect(statsLine.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible();
  await copyBtn.click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("Command finished");

  // The AI reply's time + copy live on the stats line (it sits right under the reply and IS its
  // footer) — the assistant message must NOT render a second footer, or one spot grows two copy
  // buttons. So the only per-message footer is the user's.
  await expect(page.getByRole("button", { name: "复制消息" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "复制回复" })).toHaveCount(1);

  // User-message footer: hidden by default but SPACE-RESERVED (opacity-0, not hidden) — with
  // `hidden` the footer would appear on hover and shove everything below it down, making the list
  // jitter as the mouse crosses it.
  const msgCopy = page.getByRole("button", { name: "复制消息" });
  const meta = msgCopy.locator("xpath=..");
  await expect(meta).toHaveCSS("opacity", "0");
  expect(
    await msgCopy.boundingBox(),
    "footer must occupy space even while invisible",
  ).not.toBeNull();

  // Hover the user bubble → its footer fades in (human-readable time + copy).
  await page.getByText("Help me set up @theme").first().hover();
  await expect(meta).toHaveCSS("opacity", "1");
  await expect(meta.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible();
  await msgCopy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Help me set up @theme");

  // --- traces --- (scope to <main>; the global sidebar also lists the session title)
  await page.goto(`${BASE}/traces`);
  const main = page.locator("main");
  // Auto-generated title should appear in the traces tree (agents default-expanded).
  const titleNode = main.getByText("Configure Tailwind theme").first();
  await expect(titleNode).toBeVisible();
  await titleNode.click();
  await expect(main.getByText("轨迹观测").first()).toBeVisible();
  // Legend shows the 5 fixed categories (tool-exec renamed).
  await expect(main.getByText("工具调用执行").first()).toBeVisible();
  await expect(main.getByText("模型回复").first()).toBeVisible();
  // Per-task label.
  await expect(main.getByText("第 1 轮").first()).toBeVisible();
  // Global summary is grouped (counts / tokens / time-cost-TPS). The old "Request 耗时" item is
  // gone — its label said "duration" while it actually rendered a count.
  await expect(main.getByText("全局统计")).toBeVisible();
  await expect(main.getByText("Request 耗时")).toHaveCount(0);
  for (const label of ["轮次", "工具调用", "压缩次数", "输入 tokens", "输出 TPS"]) {
    await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // Time-axis zoom: Premiere-style scrubber (role=scrollbar) + −/＋ buttons.
  await expect(main.getByText("缩放", { exact: true })).toBeVisible();
  await expect(main.getByRole("scrollbar").first()).toBeVisible();
  await expect(main.getByText("1.00×")).toBeVisible();
  const timeline = main.locator(".no-scrollbar.overflow-x-auto").first();
  // Wheel-to-zoom is deliberately NOT supported (#58): scrolling the page over the timeline must
  // not change the zoom by accident — the ratio stays at 1.00×. Settle first, otherwise the
  // assertion could pass on its first poll before a (regressed) wheel handler re-rendered.
  await timeline.hover();
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  await expect(main.getByText("1.00×")).toBeVisible();
  // Zoom is still reachable through the ＋ button (1 × 1.4 = 1.40×).
  await main.getByRole("button", { name: "放大" }).click();
  await expect(main.getByText("1.00×")).toHaveCount(0);
  await expect(main.getByText("1.40×")).toBeVisible();
  // Timeline scroll container disables the vertical scrollbar (only horizontal on zoom).
  const overflowY = await timeline.evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflowY).toBe("hidden");
  // Hover a timeline tool-exec segment → the matching event row highlights (cross-link).
  const seg = main.getByTitle(/exec_command · 工具调用执行/).first();
  await expect(seg).toBeVisible();
  await seg.hover();
  await expect(main.locator("button.bg-amber-50").first()).toBeVisible();

  // --- files: HTML preview (scripts run in sandbox, localStorage shim) + path hidden ---
  // Script uses localStorage: without the shim it would throw SecurityError (opaque origin);
  // with the shim it runs and appends #shim-ok.
  const html = Buffer.from(
    "<html><body><h1>Hello E2E</h1><script>localStorage.setItem('e2e','1');" +
      "document.body.insertAdjacentHTML('beforeend','<p id=\\'shim-ok\\'>'+localStorage.getItem('e2e')+'</p>')" +
      "</script></body></html>",
  ).toString("base64");
  const up = await page.request.put(
    `${BASE}/api/sessions/${sessionId}/files/content?path=demo.html`,
    { data: { dataBase64: html } },
  );
  expect(up.ok(), "upload html").toBeTruthy();

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByRole("button", { name: "打开工作区" }).click();
  const fileNode = page.getByText("demo.html").first();
  await expect(fileNode).toBeVisible();
  await fileNode.click();
  // Rendered iframe present; the localStorage script ran (shim) → #shim-ok appended.
  await expect(page.locator("iframe")).toBeVisible();
  await expect(page.frameLocator("iframe").locator("#shim-ok")).toHaveText("1");
  // The list and the preview are mutually exclusive: the toolbar only appears after
  // returning to the list (which also triggers #59's return-refresh).
  await page.getByRole("button", { name: "返回列表" }).click();
  await expect(page.getByText("demo.html").first()).toBeVisible();
  // Workspace path is hidden until the 详情 ("Details") toggle is used.
  const workspaceAbs = sess.session.workspace;
  await expect(page.getByText(workspaceAbs, { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "详情" }).click();
  await expect(page.getByText(workspaceAbs, { exact: false }).first()).toBeVisible();

  // --- message files card: only files that really exist in the workspace make the card ---
  // The mock reply mentions two backtick paths: demo.html was truly uploaded above via
  // files/content; missing-report.pdf exists nowhere. The card must render after the
  // files/stat round-trip with a single row for the existing file only.
  await ta.fill("files card test");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/Report generated/)).toBeVisible();
  await expect(page.getByText("1 个文件")).toBeVisible();
  // Card rows carry the 点击预览 ("click to preview") affordance — that distinguishes them from
  // the Files panel tree rows, which also use title=<name> on their buttons.
  const cardRow = page.locator('button[title="demo.html"]').filter({ hasText: "点击预览" });
  await expect(cardRow).toBeVisible();
  await expect(page.locator('button[title="missing-report.pdf"]')).toHaveCount(0);
  // Clicking the row opens the Files panel preview via the normalized relative path.
  await cardRow.click();
  await expect(page.locator("iframe")).toBeVisible();
  await expect(page.frameLocator("iframe").locator("#shim-ok")).toHaveText("1");

  // --- sidebar collapse / expand ---
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible();
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect(page.getByRole("button", { name: "收起侧栏" })).toBeVisible();

  const sidebar = page.getByRole("complementary");

  // --- group collapse / expand (the header button shows the group name, so its state
  //     lives on aria-label rather than a duplicate title tooltip) ---
  await expect(sidebar.getByText("Configure Tailwind theme")).toBeVisible();
  await sidebar.locator('button[aria-label="折叠"]').first().click();
  await expect(sidebar.getByText("Configure Tailwind theme")).toHaveCount(0);
  // The collapse state persists across a reload (localStorage, keyed per Project): the group
  // comes back rendered collapsed (an "展开" header), with its rows still hidden.
  await page.reload();
  await expect(sidebar.locator('button[aria-label="展开"]').first()).toBeVisible();
  await expect(sidebar.getByText("Configure Tailwind theme")).toHaveCount(0);
  await sidebar.locator('button[aria-label="展开"]').first().click();
  await expect(sidebar.getByText("Configure Tailwind theme")).toBeVisible();

  // --- settings: adjustable accent color + font size (default gray/white) ---
  // The username button shares its name with the Project switcher (the initial Project's
  // display name defaults to the username), so take the last match — the bottom user menu.
  await page.getByRole("button", { name: "e2euser" }).last().click();
  await page.getByRole("button", { name: "蓝", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.accent))
    .toBe("blue");
  await page.getByRole("button", { name: "大", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.fontSize))
    .toBe("20px");
  await page.keyboard.press("Escape");

  // --- session rename (manual title wins over the auto-generated one) ---
  const renameTarget = sidebar.locator("li", { hasText: "Configure Tailwind theme" }).first();
  await renameTarget.hover();
  await renameTarget.getByRole("button", { name: "重命名对话" }).click();
  await page.getByLabel("标题").fill("My renamed title");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(sidebar.getByText("My renamed title")).toBeVisible();
  await page.reload();
  await expect(sidebar.getByText("My renamed title")).toBeVisible();

  // --- session archive + delete (throwaway session) ---
  await page.request.post(`${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`, {
    data: { provider: "custom", modelId: "claude-4-8" },
  });
  await page.reload();
  const throwaway = sidebar.locator("li", { hasText: "新对话" }).first();
  await expect(throwaway).toBeVisible();
  // Archive: moves it under the collapsed "已归档" group.
  await throwaway.hover();
  await throwaway.getByRole("button", { name: "归档", exact: true }).click();
  await expect(sidebar.getByText(/已归档（\d+）/).first()).toBeVisible();
  await sidebar
    .getByText(/已归档（\d+）/)
    .first()
    .click();
  const archived = sidebar.locator("li", { hasText: "新对话" }).first();
  await expect(archived).toBeVisible();
  // Delete from the archived group (delete + archive share one action group).
  await archived.hover();
  await archived.getByRole("button", { name: "删除对话" }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(sidebar.getByText("新对话")).toHaveCount(0);

  // --- session expiry: any 401 sends the user back to /login (no stuck error page) ---
  // Clearing the cookie is what a rebuilt web.db looks like to the browser.
  await page.context().clearCookies();
  // Stay in the SPA: navigating to 成本中心 ("Cost Center") fires GET /usage -> 401 -> global redirect.
  await page.getByRole("link", { name: "成本中心" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("form").getByRole("button", { name: "登录" })).toBeVisible();
});
