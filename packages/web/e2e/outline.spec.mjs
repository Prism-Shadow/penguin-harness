/**
 * Conversation minimap + sticky work-group header + composer input history (the three
 * chat-navigation features), on a viewport whose stream gutter is wide enough for the
 * tick rail (it measures the free margin live and hides itself when a docked panel eats
 * the room — also asserted here).
 *
 * Flow (test 1): five exchanges in one session (the mock answers the first with
 * thinking + exec_command and later ones with plain text — hasToolResult is history-wide),
 * crossing the outline's five-turn visibility gate on the way — at four turns neither the
 * rail nor the toolbar fallback renders — then a fresh session whose FIRST message is
 * "slow stream test" for a 40-line tool output long enough to scroll inside.
 *
 * Test 2 drives one session to 45 exchanges to watch the rail's sliding window: at most
 * 20 ticks either side of the reading position, global turn numbers intact, ellipsis dots
 * standing in for the turns hidden past an edge.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "outlineuser";
const P = "password123";

test.use({ viewport: { width: 1440, height: 860 } });

/** Reply completion marker: every mock turn-2 ends with this exact sentence. */
const REPLY = "Command finished";

/**
 * Provision the shared e2e user, point the project's default model at the mock LLM, and
 * return a factory for fresh sessions in that project (idempotent — both tests call it).
 */
async function setup(page) {
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
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  return async () => {
    const res = await (
      await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
        data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
      })
    ).json();
    return res.session.sessionId;
  };
}

/** Send a message and wait until the body carries `replies` completed mock replies. */
const sender = (page, ta) => async (text, replies) => {
  await ta.click();
  await ta.fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    ([marker, want]) => document.body.innerText.split(marker).length - 1 >= want,
    [REPLY, replies],
    { timeout: 60000 },
  );
};

test("minimap ticks + hover preview + jump, five-turn gate, sticky group header, ArrowUp history recall", async ({
  page,
}) => {
  const newSession = await setup(page);
  const ta = page.getByPlaceholder(/输入消息/);
  const send = sender(page, ta);

  // --- session 1: five exchanges -> visibility gate, outline entries, jump, scrollspy, history ---
  await page.goto(`${BASE}/chat/${await newSession()}`);
  await ta.waitFor();
  await send("第一问：项目结构", 1);
  await send("第二问：运行检查", 2);
  await send("第三问：总结结果", 3);
  await send("第四问：整理清单", 4);

  // Below five turns neither outline shape renders: no rail ticks even though the gutter
  // fits them…
  const ticks = page.locator("[data-outline-tick]");
  const menuButton = page.getByRole("button", { name: "对话索引" });
  await expect(ticks).toHaveCount(0);
  // …and no toolbar fallback either while a docked panel eats the gutter. Wait until the
  // stream really is too narrow for the rail (the exact condition the fallback keys on)
  // plus a paint, so the button's absence proves the gate — not a panel still opening.
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  await page.waitForFunction(() => {
    const c = document.querySelector("[data-outline-anchor]")?.closest(".overflow-y-auto");
    return c ? (c.clientWidth - 768) / 2 < 56 : false;
  });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(menuButton).toHaveCount(0);
  await page.getByTestId("dock-toggle-right").click();

  // The fifth exchange crosses the gate: one tick per exchange in the gutter minimap;
  // auto-follow parked the stream at the bottom, so the newest exchange is the active
  // tick. Message text is NOT duplicated into the DOM at rest — the preview card exists
  // only while hovering. Five entries don't outgrow the rail window: no overflow dots.
  await send("第五问：回顾结论", 5);
  const card = page.locator("[data-outline-card]");
  await expect(ticks).toHaveCount(5);
  await expect(page.locator("[data-outline-overflow]")).toHaveCount(0);
  // Park at the live bottom explicitly before asserting "bottom → newest tick active":
  // that mapping is the semantic under test, not auto-follow's timing under load.
  await page.evaluate(() => {
    const c = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    c.scrollTop = c.scrollHeight;
  });
  await expect(page.locator("[data-outline-tick][aria-current]")).toHaveAttribute(
    "aria-label",
    /第 5 轮/,
  );
  await expect(card).toHaveCount(0);

  // Hovering a tick pops the preview card (question bold + truncated reply); leaving unmounts it.
  await ticks.first().hover();
  await expect(card).toContainText("第一问：项目结构");
  await expect(card).toContainText(REPLY);
  await ta.hover();
  await expect(card).toHaveCount(0);

  // Clicking a tick jumps the stream to that turn and moves the active tick.
  await ticks.first().click();
  await expect(page.locator("[data-outline-tick][aria-current]")).toHaveAttribute(
    "aria-label",
    /第 1 轮/,
  );
  const jumpDelta = await page.evaluate(() => {
    const container = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    const first = document.querySelector("[data-outline-anchor]");
    return first.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  expect(Math.abs(jumpDelta)).toBeLessThan(40);

  // The rail lives in the free gutter: a docked panel that eats the slack hides it and
  // the index moves to the toolbar dropdown (navigation stays reachable, and the dropdown
  // lists ALL entries — no windowing there); closing the panel restores the rail (live
  // measurement, not a breakpoint).
  await page.getByTestId("dock-toggle-right").click();
  await expect(ticks).toHaveCount(0);
  await menuButton.click();
  const menuEntries = page.locator("[data-outline-menu-entry]");
  await expect(menuEntries).toHaveCount(5);
  await expect(menuEntries.first()).toContainText("第一问：项目结构");
  await menuEntries.nth(2).click(); // jump and close
  await expect(menuEntries).toHaveCount(0);
  await page.getByTestId("dock-toggle-right").click();
  await expect(ticks).toHaveCount(5);
  await expect(menuButton).toHaveCount(0);

  // Phone-narrow: no rail either, the toolbar index instead; the agents-panel button
  // drops to icon-only below sm (same rule as the workspace button).
  await page.setViewportSize({ width: 420, height: 820 });
  await expect(ticks).toHaveCount(0);
  await expect(menuButton).toBeVisible();
  await expect(page.getByText("智能体面板")).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 860 });
  await expect(ticks).toHaveCount(5);

  // Scaled root font (browser font-size preference): the max-w-3xl column is rem-based,
  // so at 20px root font it becomes 960px — on a 1000px stream a fixed 768px assumption
  // would still call the gutter wide enough and leave the ticks ON the prose. The fit
  // must track the real column width: rail hidden, toolbar fallback in its place.
  await page.evaluate(() => (document.documentElement.style.fontSize = "20px"));
  await page.setViewportSize({ width: 1000, height: 860 });
  await expect(ticks).toHaveCount(0);
  await expect(menuButton).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  await page.setViewportSize({ width: 1440, height: 860 });
  await expect(ticks).toHaveCount(5);

  // ↑ walks back through this session's inputs, newest first; a second ↑ goes older.
  await ta.click();
  await page.keyboard.press("ArrowUp");
  await expect(ta).toHaveValue("第五问：回顾结论");
  await page.keyboard.press("ArrowUp");
  await expect(ta).toHaveValue("第四问：整理清单");
  // ↓ walks forward and past the newest restores the (empty) draft.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(ta).toHaveValue("");
  // Editing a recalled entry ends navigation: ↑ then goes back to caret movement.
  await page.keyboard.press("ArrowUp");
  await ta.press("End");
  await page.keyboard.type("，补充");
  await page.keyboard.press("ArrowUp");
  await expect(ta).toHaveValue("第五问：回顾结论，补充");
  await ta.fill("");

  // --- session 2: long tool output -> sticky header ---
  await page.goto(`${BASE}/chat/${await newSession()}`);
  await ta.waitFor();
  await send("slow stream test", 1);

  // Expand the settled group, then the tool card with the 40-line output.
  const header = page.locator("[data-group-header]");
  await expect(header).toHaveCount(1);
  await header.click();
  await page.locator("button[aria-expanded]").filter({ hasText: "exec_command" }).first().click();
  await expect(page.getByText("line 40")).toBeVisible();

  // Scrolled into the middle of the tool output, the two sticky levels stack: the group
  // header flush at the scrollport top (-top-4 cancels the container's own py-4), and the
  // tool row pinned right below it (top-4 = the header's offset plus its height) — the bar
  // directly above the content is the section being read, never a skipped level.
  const stuck = await page.evaluate(() => {
    const container = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    const head = document.querySelector("[data-group-header]");
    const card = head.parentElement;
    container.scrollTop = card.offsetTop + 400;
    const ct = container.getBoundingClientRect().top;
    const row = [...document.querySelectorAll("button[aria-expanded]")].find((b) =>
      b.textContent.includes("exec_command"),
    );
    return {
      delta: Math.abs(head.getBoundingClientRect().top - ct),
      rowDelta: row.getBoundingClientRect().top - ct,
      headerHeight: head.getBoundingClientRect().height,
      cardAboveFold: card.getBoundingClientRect().top < ct,
    };
  });
  expect(stuck.delta).toBeLessThan(2);
  expect(Math.abs(stuck.rowDelta - stuck.headerHeight)).toBeLessThan(2); // stacked right below
  expect(stuck.cardAboveFold).toBeTruthy();

  // Collapsing from the stuck header lands the view back on the group, not on unrelated content.
  await header.click();
  const landed = await page.evaluate(() => {
    const container = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    const card = document.querySelector("[data-group-header]").parentElement;
    return card.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  expect(landed).toBeGreaterThan(-5);
  expect(landed).toBeLessThan(300);
});

test("the tick rail windows to the turns around the reading position on long conversations", async ({
  page,
}) => {
  // 45 sequential exchanges against a 90s default budget: give the loop room. Only the
  // first send takes the mock's two-round tool path (hasToolResult is history-wide), so
  // the other 44 are single-round text replies.
  test.setTimeout(300_000);
  const TURNS = 45;
  const WINDOW = 41; // 20 ticks before + the active one + 20 after

  const newSession = await setup(page);
  await page.goto(`${BASE}/chat/${await newSession()}`);
  const ta = page.getByPlaceholder(/输入消息/);
  const send = sender(page, ta);
  await ta.waitFor();
  for (let n = 1; n <= TURNS; n++) await send(`第 ${n} 问`, n);

  // Parked at the live bottom the active turn is the newest, and the rail shows the LAST
  // 41 turns: labels keep their GLOBAL numbers (the first visible tick is turn 5, not a
  // renumbered turn 1) and the ellipsis dots mark the turns hidden above — none below.
  const ticks = page.locator("[data-outline-tick]");
  await page.evaluate(() => {
    const c = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    c.scrollTop = c.scrollHeight;
  });
  await expect(ticks).toHaveCount(WINDOW);
  await expect(page.locator("[data-outline-tick][aria-current]")).toHaveAttribute(
    "aria-label",
    /第 45 轮/,
  );
  await expect(ticks.first()).toHaveAttribute("aria-label", /第 5 轮/);
  await expect(ticks.last()).toHaveAttribute("aria-label", /第 45 轮/);
  await expect(page.locator('[data-outline-overflow="above"]')).toHaveCount(1);
  await expect(page.locator('[data-outline-overflow="below"]')).toHaveCount(0);

  // Jumping to the earliest visible tick (turn 5) recenters the window at the start:
  // turns 1–41 render and the hidden turns move below the window.
  await ticks.first().click();
  await expect(page.locator("[data-outline-tick][aria-current]")).toHaveAttribute(
    "aria-label",
    /第 5 轮/,
  );
  await expect(ticks.first()).toHaveAttribute("aria-label", /第 1 轮/);
  await expect(ticks.last()).toHaveAttribute("aria-label", /第 41 轮/);
  await expect(page.locator('[data-outline-overflow="above"]')).toHaveCount(0);
  await expect(page.locator('[data-outline-overflow="below"]')).toHaveCount(1);

  // The toolbar dropdown (shown once the docked panel hides the rail) still lists EVERY
  // turn — the window is rail-only; the dropdown list scrolls instead.
  await page.getByTestId("dock-toggle-right").click();
  await expect(ticks).toHaveCount(0);
  await page.getByRole("button", { name: "对话索引" }).click();
  await expect(page.locator("[data-outline-menu-entry]")).toHaveCount(TURNS);
});
