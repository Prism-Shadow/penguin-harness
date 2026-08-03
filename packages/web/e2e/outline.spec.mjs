/**
 * Conversation minimap + sticky work-group header + composer input history (the three
 * chat-navigation features), on a viewport whose stream gutter is wide enough for the
 * tick rail (it measures the free margin live and hides itself when a docked panel eats
 * the room — also asserted here).
 *
 * Flow: three exchanges in one session (the mock answers the first with
 * thinking + exec_command and later ones with plain text — hasToolResult is history-wide),
 * then a fresh session whose FIRST message is "slow stream test" for a 40-line tool output
 * long enough to scroll inside.
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

test("minimap ticks + hover preview + jump, sticky group header, ArrowUp history recall", async ({
  page,
}) => {
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

  const newSession = async () => {
    const res = await (
      await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
        data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
      })
    ).json();
    return res.session.sessionId;
  };
  const ta = page.getByPlaceholder(/输入消息/);
  const send = async (text, replies) => {
    await ta.click();
    await ta.fill(text);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      ([marker, want]) => document.body.innerText.split(marker).length - 1 >= want,
      [REPLY, replies],
      { timeout: 60000 },
    );
  };

  // --- session 1: three exchanges -> outline entries, jump, scrollspy, history ---
  await page.goto(`${BASE}/chat/${await newSession()}`);
  await ta.waitFor();
  await send("第一问：项目结构", 1);
  await send("第二问：运行检查", 2);
  await send("第三问：总结结果", 3);

  // One tick per exchange in the gutter minimap; auto-follow parked the stream at the
  // bottom, so the newest exchange is the active tick. Message text is NOT duplicated
  // into the DOM at rest — the preview card exists only while hovering.
  const ticks = page.locator("[data-outline-tick]");
  const card = page.locator("[data-outline-card]");
  await expect(ticks).toHaveCount(3);
  // Park at the live bottom explicitly before asserting "bottom → newest tick active":
  // that mapping is the semantic under test, not auto-follow's timing under load.
  await page.evaluate(() => {
    const c = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    c.scrollTop = c.scrollHeight;
  });
  await expect(page.locator("[data-outline-tick][aria-current]")).toHaveAttribute(
    "aria-label",
    /第 3 轮/,
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

  // The rail lives in the free gutter: a docked panel that eats the slack hides it, and
  // closing the panel brings it back (live measurement, not a breakpoint).
  await page.getByRole("button", { name: "打开工作区" }).click();
  await expect(ticks).toHaveCount(0);
  await page.getByRole("button", { name: "打开工作区" }).click();
  await expect(ticks).toHaveCount(3);

  // ↑ walks back through this session's inputs, newest first; a second ↑ goes older.
  await ta.click();
  await page.keyboard.press("ArrowUp");
  await expect(ta).toHaveValue("第三问：总结结果");
  await page.keyboard.press("ArrowUp");
  await expect(ta).toHaveValue("第二问：运行检查");
  // ↓ walks forward and past the newest restores the (empty) draft.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(ta).toHaveValue("");
  // Editing a recalled entry ends navigation: ↑ then goes back to caret movement.
  await page.keyboard.press("ArrowUp");
  await ta.press("End");
  await page.keyboard.type("，补充");
  await page.keyboard.press("ArrowUp");
  await expect(ta).toHaveValue("第三问：总结结果，补充");
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
