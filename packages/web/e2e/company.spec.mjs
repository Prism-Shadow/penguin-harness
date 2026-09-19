/**
 * Company mode, end to end through the browser with the mock LLM: switch modes, create the
 * marketplace organization from the switcher, land on the CEO's desk conversation (its
 * initialization run is answered by the mock), find the CEO on the org chart and a ticket on
 * the board, open a desk from the sidebar's 工位 group and another from the org chart, work the
 * board — a click on a card opens its ticket, a mouse drag onto another column moves it, and a
 * ticket session opened from the dialog stays on screen and joins the sidebar's 临时 group,
 * which survives a reload and empties only through its ✕ and its 全部关闭 — then work in the
 * channels — post in the all-hands channel and see the mention reach the CEO's
 * desk as an `[org_trigger]` work run, create a channel, invite the CEO into it, and post a
 * mention there — and finally check that development mode lists none of the organization's
 * own sessions. The desk row's run mark is checked on both sides of the initialization run:
 * it turns itself off when the run ends, which no server event announces.
 *
 * Company mode is off on a fresh server, so the spec turns the admin master switch on through
 * /api/admin/settings before it signs in as the board member — without it there is no mode
 * switch to click and every organization route answers 404.
 */
import { test, expect, request } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
// Unique per run: the organization and the persisted work mode belong to the user, so a rerun
// against the same data root must start from a fresh one.
const U = `boardmember_${Date.now().toString(36)}`;
const P = "password123";
const ORG = "marketplace";
// "slow text test" makes the mock stream its answer for ~8 s, so the page can be checked
// while the CEO's initialization run is still in flight.
const MISSION =
  "slow text test: 做一个 DeepSeek Harness 插件 Marketplace，通过社交媒体和 SEO 把搜索排名做到前三，靠首页限时置顶曝光位盈利。";

/** The admin master switch, off by default: turned on server-wide before the flow starts. */
async function enableCompanyMode() {
  const adminCtx = await request.newContext();
  try {
    await login(adminCtx, ADMIN_ID, ADMIN_PASSWORD);
    const res = await adminCtx.put(`${BASE}/api/admin/settings`, { data: { companyMode: true } });
    if (!res.ok()) {
      throw new Error(`enable company mode failed: ${res.status()} ${await res.text()}`);
    }
  } finally {
    await adminCtx.dispose();
  }
}

test("company mode: create the organization, meet the CEO, see the board and the chat work", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await enableCompanyMode();
  await provisionAndLogin(page.request, U, P);
  const project = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0];
  const projectId = project.projectId;
  const api = (path) => `${BASE}/api/projects/${projectId}${path}`;

  // A model that talks to the mock, so the CEO's desk can actually run its initialization.
  const put = await page.request.put(api("/models"), {
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
  expect(put.ok(), "put models").toBeTruthy();

  await page.goto("/");
  await expect(page.getByText("General Agent").first()).toBeVisible();

  // The mode switch sits above the Project switcher; company mode shows the organization switcher.
  const modeSwitch = page.getByRole("group", { name: "工作模式" });
  await expect(modeSwitch).toBeVisible();
  // The option's accessible name carries the beta tag as a suffix ("公司 · 内测版").
  await modeSwitch.getByRole("button", { name: /^公司/ }).click();
  await expect(page).toHaveURL(/\/org/);
  // With no organization yet, the landing page offers creation directly (the switcher does too).
  await page.getByRole("button", { name: "新建组织", exact: true }).first().click();

  // The modal is a headed card; its fields are named by their labels (hint text included).
  await expect(page.getByRole("heading", { name: "新建组织" })).toBeVisible();
  await page.getByRole("textbox", { name: /^组织 id/ }).fill(ORG);
  await page.getByRole("textbox", { name: /^显示名/ }).fill("Plugin Marketplace");
  await page.getByRole("textbox", { name: /^使命/ }).fill(MISSION);
  // The CEO's budget is the whole company's, and the dialog offers the default it would send.
  await expect(page.getByRole("spinbutton", { name: /^CEO 预算/ })).toHaveValue("100");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  // Creation opens the CEO's desk conversation: an ordinary chat page that renders while the
  // initialization run is still streaming (the trigger banner and the live state appear at
  // once, not after the run ends).
  await expect(page).toHaveURL(/\/chat\/session-/, { timeout: 30_000 });
  await expect(page.getByText(/由组织「marketplace」触发/).first()).toBeVisible({ timeout: 3_000 });
  const detail = await (await page.request.get(api(`/organizations/${ORG}`))).json();
  expect(detail.employeeCount).toBe(1);
  expect(detail.ceoDeskSessionId).toBeTruthy();
  expect(page.url()).toContain(detail.ceoDeskSessionId);
  const agents = (await (await page.request.get(api("/agents"))).json()).agents;
  expect(agents.some((a) => a.agentId === `${ORG}_ceo`)).toBe(true);

  // The initialization run reached the desk as an [org_trigger] input the mock answered.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${BASE}/api/sessions/${detail.ceoDeskSessionId}/messages`,
        );
        const text = await res.text();
        return text.includes("[org_trigger]") && text.includes("kind: init");
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  // The org chart shows the CEO by its display name.
  await page.goto(`/org/${projectId}/${ORG}/chart`);
  await expect(page.getByText("Plugin Marketplace CEO").first()).toBeVisible();

  // The sidebar lists the organization itself under its channels: a 工位 row per employee.
  // Opening one renders the ordinary conversation view with the company sidebar around it,
  // and the sidebar marks the desk that is open.
  const sidebar = page.getByRole("complementary");
  const ceoDeskRow = sidebar.getByRole("button", { name: /Plugin Marketplace CEO 的工位/ });
  await expect(sidebar.getByRole("button", { name: /^工位（/ })).toBeVisible();
  await ceoDeskRow.click();
  await expect(page).toHaveURL(new RegExp(`/chat/${detail.ceoDeskSessionId}$`));
  await expect(page.getByText(/由组织「marketplace」触发/).first()).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /^全员频道/ })).toBeVisible();
  await expect(ceoDeskRow).toHaveAttribute("aria-current", "true");

  // The desk row's run mark is live. Nothing on the wire says a run ENDED — the organization's
  // session snapshot is re-read when a run is dispatched and when a ticket moves, and neither
  // happens here — so the row takes its state from the session list's own status. Once the
  // mock's answer has landed the row says nothing at all, and the composer is back to taking
  // an ordinary message rather than steering a run in flight.
  await expect(page.getByText("chunk-40").first()).toBeVisible({ timeout: 30_000 });
  await expect(ceoDeskRow).toHaveAttribute("aria-label", "Plugin Marketplace CEO 的工位");
  await expect(page.getByPlaceholder(/输入消息/)).toBeEnabled();

  // A desk opened from the org chart renders too: the routed Session is not in the
  // development list at all, so the page has to resolve it by id (the batch-3 regression).
  const hired = await page.request.post(api(`/organizations/${ORG}/employees`), {
    data: {
      newAgent: { agentId: `${ORG}_dev`, name: "Dana Dev" },
      title: "站点工程师",
      reportsTo: `${ORG}_ceo`,
      duties: "把站点从零搭到上线",
    },
  });
  expect(hired.ok(), "hire").toBeTruthy();
  await page.goto(`/org/${projectId}/${ORG}/chart`);
  // The card's face is inert; its kebab menu is the way into the desk session.
  await page.getByRole("button", { name: "Dana Dev · 员工操作" }).click();
  await page.getByRole("button", { name: "打开工位会话" }).click();
  await expect(page).toHaveURL(/\/chat\/session-/);
  await expect(page.getByText("Dana Dev 的工位").first()).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /Dana Dev 的工位/ })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // A ticket filed against the CEO shows on the board in the proposed column.
  const created = await page.request.post(api(`/organizations/${ORG}/tickets`), {
    data: {
      title: "Build the marketplace site",
      goal: "A site that lists DeepSeek Harness plugins with search and a featured row.",
      owner: `agent:${ORG}_ceo`,
      priority: "P1",
    },
  });
  expect(created.ok(), "create ticket").toBeTruthy();
  const ticket = await created.json();
  expect(ticket.status).toBe("proposed");
  await page.goto(`/org/${projectId}/${ORG}/tickets`);
  await expect(page.getByText("Build the marketplace site").first()).toBeVisible();

  // A click anywhere on a card opens its ticket in place.
  const board = `/org/${projectId}/${ORG}/tickets`;
  const card = (title) => page.locator("[data-ticket-column] button", { hasText: title }).first();
  await card("Build the marketplace site").click();
  const siteDialog = page.getByRole("dialog", { name: "Build the marketplace site" });
  await expect(siteDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(siteDialog).toHaveCount(0);

  // A mouse drag onto another column lifts the card as soon as it moves and asks to move the
  // ticket there; confirming moves it.
  const from = await card("Build the marketplace site").boundingBox();
  const to = await page.locator('[data-ticket-column="in_progress"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Near the column's top rather than its middle: a tall column can end below the viewport.
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(60, to.height / 2), { steps: 12 });
  await page.mouse.up();
  const moveConfirm = page.getByRole("dialog", { name: "移动工单" });
  await expect(
    moveConfirm.getByText("将「Build the marketplace site」移到「进行中」？"),
  ).toBeVisible();
  await moveConfirm.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.locator('[data-ticket-column="in_progress"]').getByText("Build the marketplace site"),
  ).toBeVisible();

  // A ticket session opened from the dialog lands on its conversation and STAYS there: the
  // board, still mounted while the router commits the new location, must not write its
  // `?ticket=` query back over the conversation's history entry.
  const startSession = async (ticketId) => {
    const res = await page.request.post(api(`/organizations/${ORG}/tickets/${ticketId}/start`), {
      data: { message: "Pick this up." },
    });
    expect(res.ok(), "start ticket session").toBeTruthy();
    return (await res.json()).sessionId;
  };
  const openFromTicket = async (title, sessionId) => {
    await page.goto(board);
    await card(title).click();
    const dialog = page.getByRole("dialog", { name: title });
    await dialog.getByRole("button", { name: /^关联工单会话/ }).click();
    await dialog.locator('button[title="打开会话"]').first().click();
    await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`));
    await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/chat/${sessionId}`);
  };
  const siteSession = await startSession(ticket.ticketId);
  await openFromTicket("Build the marketplace site", siteSession);

  // It joins the 临时 group below 工位, marked as the session on screen, and a reload keeps it.
  const tempHeader = (n) => sidebar.getByRole("button", { name: `临时（${n}）` });
  const anyTempHeader = sidebar.getByRole("button", { name: /^临时（/ });
  const removeRow = sidebar.getByRole("button", { name: "从「临时」中移除" });
  await expect(tempHeader(1)).toBeVisible();
  const desksTop = (await sidebar.getByRole("button", { name: /^工位（/ }).boundingBox()).y;
  expect((await tempHeader(1).boundingBox()).y).toBeGreaterThan(desksTop);
  await expect(sidebar.locator('li button[aria-current="true"]')).toHaveCount(1);
  await page.reload();
  await expect(tempHeader(1)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/chat/${siteSession}$`));

  // A second one goes on top. Its ✕ removes only its row, even while it is on screen: the
  // page stays on the conversation and the other entry stays listed.
  const launch = await page.request.post(api(`/organizations/${ORG}/tickets`), {
    data: { title: "Write the launch post", goal: "Announce the site.", owner: `agent:${ORG}_ceo` },
  });
  expect(launch.ok(), "create second ticket").toBeTruthy();
  const launchSession = await startSession((await launch.json()).ticketId);
  await openFromTicket("Write the launch post", launchSession);
  await expect(tempHeader(2)).toBeVisible();
  await removeRow.first().click();
  await expect(tempHeader(1)).toBeVisible();
  await expect(sidebar.locator('li button[aria-current="true"]')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/chat/${launchSession}$`));

  // 全部关闭 empties the group in one click, with no confirmation, and it stays empty.
  await openFromTicket("Write the launch post", launchSession);
  await expect(tempHeader(2)).toBeVisible();
  await sidebar.getByRole("button", { name: "全部关闭", exact: true }).click();
  await expect(anyTempHeader).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/chat/${launchSession}$`));
  await page.reload();
  await expect(sidebar.getByRole("button", { name: /^工位（/ })).toBeVisible();
  await expect(anyTempHeader).toHaveCount(0);

  // An organization opens on its overview; its channels are the sidebar's own list, where
  // development mode lists conversations, with the all-hands channel pinned at its top.
  await page.goto(`/org/${projectId}/${ORG}`);
  await expect(page).toHaveURL(/\/overview$/);
  await page
    .getByRole("link", { name: /^全员频道/ })
    .first()
    .click();
  await expect(page).toHaveURL(/channels\/default_channel/);
  await expect(page.getByRole("heading", { name: /全员频道/ })).toBeVisible();

  // A mention typed in the all-hands channel lands on the CEO's desk as a mention work run.
  const input = page.getByRole("textbox", { name: /输入消息/ });
  await expect(input).toBeVisible();
  await input.fill(`@${ORG}_ceo 先把站点搭起来，验收标准写在工单里。`);
  await input.press("Enter");
  await expect(page.getByText("先把站点搭起来").first()).toBeVisible();
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${BASE}/api/sessions/${detail.ceoDeskSessionId}/messages`,
        );
        return (await res.text()).includes("kind: mention");
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  // A new channel: created from the channel list header's own "+", the dialog validates the
  // id here, the sidebar gains a row, and the view opens on it.
  await page.getByRole("button", { name: "新建频道", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "新建频道" })).toBeVisible();
  await page.getByRole("textbox", { name: /^频道 id/ }).fill("site");
  await page.getByRole("textbox", { name: /^显示名/ }).fill("Site launch");
  await page.getByRole("textbox", { name: /^主题/ }).fill("站点从零到上线的一切");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page).toHaveURL(/channels\/site/);
  await expect(page.getByRole("heading", { name: /Site launch/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Site launch/ })).toBeVisible();

  // Inviting the CEO: only then does an @ in this channel reach it (the server refuses a
  // mention that leaves the channel's membership).
  await page.getByRole("button", { name: "邀请", exact: true }).click();
  // Scoped to the picker: the sidebar's 工位 group carries the CEO's name too.
  const invite = page.getByRole("dialog", { name: "邀请到频道" });
  await invite.getByRole("textbox", { name: "搜索员工或成员" }).fill("ceo");
  await invite.getByRole("button", { name: /Plugin Marketplace CEO/ }).click();
  await expect(page.getByText("已邀请").first()).toBeVisible();

  // …and the mention posts, appears in this channel's stream, and reaches the desk.
  const siteInput = page.getByRole("textbox", { name: /输入消息/ });
  await siteInput.fill(`@${ORG}_ceo 站点频道成立，先出一版信息架构。`);
  await siteInput.press("Enter");
  await expect(page.getByText("站点频道成立").first()).toBeVisible();
  const siteDay = await (
    await page.request.get(api(`/organizations/${ORG}/channels/site/messages`))
  ).json();
  expect(siteDay.messages.some((m) => m.text.includes("站点频道成立"))).toBe(true);
  expect(siteDay.messages.some((m) => m.mentions.includes(`agent:${ORG}_ceo`))).toBe(true);

  // The overview shows the organization, its mission on screen.
  await page.goto(`/org/${projectId}/${ORG}/overview`);
  await expect(page.getByText("Plugin Marketplace").first()).toBeVisible();

  // Switching back to development mode from an organization page takes effect at once: the
  // development sidebar (with its new-chat entry) replaces the company one.
  await page
    .getByRole("group", { name: "工作模式" })
    .getByRole("button", { name: "开发", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "新建对话" }).first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page).not.toHaveURL(/\/org\//);
  // …and it lists the user's own conversations only: the organization's desks are the
  // company sidebar's rows, and the old 「组织」 folder is gone with them.
  await expect(sidebar.getByText("Dana Dev 的工位")).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /^组织（/ })).toHaveCount(0);
  const overview = await (await page.request.get(api(`/organizations/${ORG}`))).json();
  expect(overview.board.proposed).toBe(1);
  expect(overview.board.in_progress).toBe(1);
  expect(overview.openTickets).toBe(2);
});
