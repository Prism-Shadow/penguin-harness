/**
 * Conversation outline + sticky work-group header + composer input history (the three
 * chat-navigation features), on a viewport wide enough for the outline (it docks at xl;
 * the suite-wide config pins 1200×720, below that breakpoint, for the historical specs).
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

test("outline entries + jump, sticky group header, ArrowUp history recall", async ({ page }) => {
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

  // One entry per exchange, question bubble plus truncated answer preview.
  const entries = page.locator("[data-outline-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.first()).toContainText("第一问：项目结构");
  await expect(entries.first()).toContainText(REPLY);

  // Auto-follow parked the stream at the bottom, so the newest exchange is the active one.
  await expect(page.locator("[data-outline-entry][aria-current]")).toContainText("第三问");

  // Clicking an entry jumps the stream to that turn and moves the active highlight.
  await entries.first().click();
  await expect(page.locator("[data-outline-entry][aria-current]")).toContainText("第一问");
  const jumpDelta = await page.evaluate(() => {
    const container = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    const first = document.querySelector("[data-outline-anchor]");
    return first.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  expect(Math.abs(jumpDelta)).toBeLessThan(40);

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

  // Collapses to a slim rail; the reopen affordance stays visible.
  await page.getByRole("button", { name: "收起对话索引" }).click();
  await expect(entries).toHaveCount(0);
  await page.getByRole("button", { name: "展开对话索引" }).click();
  await expect(entries).toHaveCount(3);

  // --- session 2: long tool output -> sticky header ---
  await page.goto(`${BASE}/chat/${await newSession()}`);
  await ta.waitFor();
  await send("slow stream test", 1);

  // Expand the settled group, then the tool card with the 40-line output.
  const header = page.locator("button.sticky");
  await expect(header).toHaveCount(1);
  await header.click();
  await page.locator("button[aria-expanded]").filter({ hasText: "exec_command" }).first().click();
  await expect(page.getByText("line 40")).toBeVisible();

  // Scrolled into the middle of the group, the header pins to the scrollport top
  // (-top-4 cancels the container's own py-4, so it sits flush at the visible top).
  const stuck = await page.evaluate(() => {
    const container = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    const head = document.querySelector("button.sticky");
    const card = head.parentElement;
    container.scrollTop = card.offsetTop + 400;
    return {
      delta: Math.abs(head.getBoundingClientRect().top - container.getBoundingClientRect().top),
      cardAboveFold: card.getBoundingClientRect().top < container.getBoundingClientRect().top,
    };
  });
  expect(stuck.delta).toBeLessThan(2);
  expect(stuck.cardAboveFold).toBeTruthy();

  // Collapsing from the stuck header lands the view back on the group, not on unrelated content.
  await header.click();
  const landed = await page.evaluate(() => {
    const container = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    const card = document.querySelector("button.sticky").parentElement;
    return card.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  expect(landed).toBeGreaterThan(-5);
  expect(landed).toBeLessThan(300);
});
