/**
 * The find bar, end to end in the real app.
 *
 * - Ctrl+F (`find.open`) scopes the search to the area the focus is inside, falling back to the
 *   conversation; typing counts without moving the page, the first Enter shows the selected hit
 *   and the second travels; `Aa` matches case; Escape closes the bar and its paint, which is a
 *   CSS highlight rather than rewritten DOM.
 * - Ctrl+Shift+F (`find.all`) searches every area on screen and lists the hits by area, and the
 *   scope button narrows back to the area the focus was in.
 * - A match inside a collapsed work group is found: the groups of the searched area open while
 *   the query stands (their steps' rows, not each step's own output), a search of another area
 *   leaves them closed, and closing the bar folds them back.
 * - With earlier turns not loaded, "load and keep searching" backfills them and lands on the
 *   nearest hit above the one the reader was on, not on the first hit of the conversation.
 *
 * The replies come from mock-llm.mjs: the "find marker test" branch writes `findmarker` four
 * times across two paragraphs (a token nothing else in the app writes, so counts are exact), and
 * any other first message takes the default path, a work group with one exec_command step.
 *
 * Standalone spec: shares one server with the other specs, so it registers its own user (which
 * auto-provisions a default Project).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "finduser";
const P = "password123";
/** What mock-llm.mjs answers the title request with; the sidebar row the search is scoped to. */
const TITLE = "Configure Tailwind theme";
const HITS = 4;
/** Every default-path reply ends its first paragraph with this. */
const REPLY = "Command finished";

/** Points the user's Project at the mock LLM; returns a factory for fresh sessions in it. */
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
    const sess = await (
      await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
        data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
      })
    ).json();
    return sess.session.sessionId;
  };
}

/** Sends a message and waits until the page carries `replies` finished default-path replies. */
const sender = (page, ta) => async (text, replies) => {
  await ta.click();
  await ta.fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    ([marker, want]) => document.body.innerText.split(marker).length - 1 >= want,
    [REPLY, replies],
    { timeout: 60_000 },
  );
};

test("Ctrl+F scopes to the focused area, Ctrl+Shift+F searches them all", async ({ page }) => {
  const newSession = await setup(page);
  await page.goto(`${BASE}/chat/${await newSession()}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("find marker test");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("A second paragraph also says findmarker.")).toBeVisible({
    timeout: 30_000,
  });

  const bar = page.getByRole("search");
  const input = bar.locator("input");
  await expect(bar).toHaveCount(0);

  // --- Ctrl+F: the focus is in the composer, which is in no region at all, so the conversation is
  //     the fallback. Typing counts but does not move the page. ---
  await page.keyboard.press("Control+f");
  await expect(bar).toBeVisible();
  await input.fill("findmarker");
  await expect(bar.getByText(`1/${HITS}`, { exact: true })).toBeVisible();

  // The hits are registered as CSS highlights — the DOM the markdown rendered is untouched.
  const highlights = await page.evaluate(() => Array.from(CSS.highlights.keys()));
  expect(highlights).toContain("penguin-find");
  expect(highlights).toContain("penguin-find-current");

  // Enter travels only on the second press: the first shows the match that is already selected.
  await input.press("Enter");
  await expect(bar.getByText(`1/${HITS}`, { exact: true })).toBeVisible();
  await input.press("Enter");
  await expect(bar.getByText(`2/${HITS}`, { exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "下一个" }).click();
  await expect(bar.getByText(`3/${HITS}`, { exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "上一个" }).click();
  await expect(bar.getByText(`2/${HITS}`, { exact: true })).toBeVisible();

  // Match case: the reply is lowercase, so a capitalised query finds nothing until it is off.
  await bar.getByRole("button", { name: "区分大小写" }).click();
  await input.fill("Findmarker");
  await expect(bar.getByText("无结果", { exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "区分大小写" }).click();
  await expect(bar.getByText(`1/${HITS}`, { exact: true })).toBeVisible();

  // Escape closes it, and the paint goes with it.
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  expect(await page.evaluate(() => Array.from(CSS.highlights.keys()))).not.toContain(
    "penguin-find",
  );

  // --- Ctrl+Shift+F: every region at once, as a list. ---
  await page.keyboard.press("Control+Shift+f");
  await expect(bar).toBeVisible();
  await input.fill("findmarker");
  const rows = bar.getByRole("option");
  await expect(rows).toHaveCount(HITS);
  await expect(rows.first()).toContainText("对话");
  // The scope button names the region Ctrl+F would have used, and narrowing goes back to it.
  await bar.getByRole("button", { name: "仅在对话中" }).click();
  await expect(rows).toHaveCount(0);
  await expect(bar.getByText(`1/${HITS}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  // --- The focus decides the region. Clicking a Session row in the sidebar puts the focus inside
  //     that region, so the very same query stops matching: the reply is not in the sidebar. ---
  const sessions = page.locator('[data-find-region="sessions"]');
  await sessions.getByRole("button").filter({ hasText: TITLE }).first().click();
  await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();

  await page.keyboard.press("Control+f");
  await expect(bar).toBeVisible();
  await input.fill("findmarker");
  await expect(bar.getByText("无结果", { exact: true })).toBeVisible();
  // Widening covers everything on screen again — and reports the scope it came from, which is the
  // Session list rather than the conversation.
  await bar.getByRole("button", { name: "所有区域" }).click();
  await expect(bar.getByRole("option")).toHaveCount(HITS);
  await expect(bar.getByRole("button", { name: "仅在会话列表中" })).toBeVisible();
});

test("a match inside a collapsed work group is found, and the group folds back when the bar closes", async ({
  page,
}) => {
  const newSession = await setup(page);
  await page.goto(`${BASE}/chat/${await newSession()}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await sender(page, ta)("list the workspace", 1);

  // The settled tool group has folded itself away: its step's row is not on the page.
  const group = page.locator('[data-group-header][data-kind="tool"]');
  await expect(group).toHaveAttribute("aria-expanded", "false");
  const STEP = "执行命令";
  const step = page.getByText(STEP);
  await expect(step).toHaveCount(0);

  const bar = page.getByRole("search");
  const input = bar.locator("input");

  // A search of the conversation opens the group once the query settles, and the hit is counted.
  await ta.click();
  await page.keyboard.press("Control+f");
  await input.fill(STEP);
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(bar.getByText("1/1", { exact: true })).toBeVisible();

  // The same query moved to the Session list folds the conversation's group back: only the
  // searched area opens its groups.
  const sessions = page.locator('[data-find-region="sessions"]');
  await sessions.getByRole("button").filter({ hasText: TITLE }).first().click();
  await page.keyboard.press("Control+f");
  await expect(bar.getByText("无结果", { exact: true })).toBeVisible();
  await expect(group).toHaveAttribute("aria-expanded", "false");

  // Back in the conversation it opens again, and closing the bar folds it: the reader never
  // opened it.
  await ta.click();
  await page.keyboard.press("Control+f");
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(step).toHaveCount(0);
});

test("load and keep searching backfills earlier turns and lands on the nearest hit above", async ({
  page,
}) => {
  // A conversation opens on its latest 20 turns: 22 sequential exchanges leave the first two out
  // of the loaded window. Only the first takes the mock's tool path; the rest are one-round
  // text replies.
  test.setTimeout(240_000);
  const newSession = await setup(page);
  const sessionId = await newSession();
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  const send = sender(page, ta);
  await send("zebracorn one", 1);
  await send("zebracorn two", 2);
  await send("zebracorn three", 3);
  for (let n = 4; n <= 22; n++) await send(`filler question ${n}`, n);

  // Reloaded, the conversation holds turns 3 to 22 and opens at the bottom.
  await page.reload();
  await expect(page.getByText("filler question 22")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("zebracorn one")).toHaveCount(0);

  const bar = page.getByRole("search");
  const input = bar.locator("input");
  await page.keyboard.press("Control+f");
  await input.fill("zebracorn");
  await expect(bar.getByText("1/1", { exact: true })).toBeVisible();
  await expect(bar.getByText("更早的内容尚未加载")).toBeVisible();

  // The backfill brings turns 1 and 2. The reader was on turn 3's hit, so the search goes on to
  // the nearest one above it (turn 2), not to the top of the conversation.
  await bar.getByRole("button", { name: "加载并继续搜索" }).click();
  await expect(bar.getByText("2/3", { exact: true })).toBeVisible();
  await expect(page.getByText("zebracorn two")).toBeInViewport();
  await expect(bar.getByText("更早的内容尚未加载")).toHaveCount(0);
});
