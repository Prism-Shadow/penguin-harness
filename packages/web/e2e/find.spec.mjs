/**
 * The find bar, end to end in the real app: Ctrl+F scopes the search to the area the focus is
 * inside, Ctrl+Shift+F searches every area on screen and lists what it found, Escape closes, and
 * matches are painted through the CSS Custom Highlight API rather than by rewriting the DOM.
 *
 * The reply being searched comes from the "find marker test" branch of mock-llm.mjs: four
 * occurrences of `findmarker` across two paragraphs — a token nothing else in the app writes, so
 * the hit count is exact without depending on the app's own copy.
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

test("Ctrl+F scopes to the focused area, Ctrl+Shift+F searches them all", async ({ page }) => {
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

  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  await page.goto(`${BASE}/chat/${sessionId}`);
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
  // …and it wraps back to the first hit from the last one's side.
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
