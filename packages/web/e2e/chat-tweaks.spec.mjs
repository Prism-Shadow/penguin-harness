/**
 * Chat/schedule tweaks:
 * - the schedule create form's model/workspace use the same form-style pickers as the
 *   Project defaults dialog, and its bind-Session field is a searchable dropdown (not a
 *   raw id text input);
 * - the chat details card shows the Session id as a click-to-copy row (the button's icon
 *   flips to the check and its tooltip to "已复制", with the same confirmation in a
 *   visually hidden live region for screen readers — no visible text label, #312).
 *
 * (The Project-defaults "已保存" toast is a one-line success path exercised manually; it is
 * left out here — dirtying the defaults block through its custom pickers is too sensitive
 * to first-run config-load timing to assert reliably.)
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "tweakuser";
const P = "password123";

test("schedule form pickers and details Session-id copy", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
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
          modelId: "haiku-x",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 100000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  // A session to bind the schedule to (and to open in chat for the details card).
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  const sessionId = sess.session.sessionId;
  const idTail = sessionId.slice(-6);

  const dlg = () => page.locator(".anim-pop").last();

  // --- Schedule form pickers ---
  await page.goto(`${BASE}/agents/default_agent?tab=schedules`);
  await page.getByRole("button", { name: "新建定时任务" }).click();
  await dlg().getByText("每次新建会话").first().waitFor();
  // New-session mode: model + workspace are the form-style dropdowns (not native selects),
  // matching the Project defaults dialog.
  await expect(dlg().getByRole("button", { name: "选择模型" })).toBeVisible();
  await expect(dlg().getByRole("button", { name: "Workspace" })).toBeVisible();

  // Switch to bind-Session mode → the searchable session dropdown replaces the id input.
  // The Target control is a custom Select (accessible name = its label "目标"); its
  // open-on-click is momentarily racy under full-page load, so retry the whole
  // open-then-pick block rather than a single click (Playwright's toPass idiom).
  await expect(async () => {
    await dlg().getByRole("button", { name: "目标" }).click();
    await page.getByRole("option", { name: "绑定 Session" }).click({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "选择要绑定的 Session" }).click();
  const search = page.getByPlaceholder(/搜索标题/);
  await search.waitFor();
  // Filter by the session id tail — deterministic regardless of the generated title.
  await search.fill(idTail);
  const row = page.locator("button").filter({ hasText: idTail });
  await expect(row.first()).toBeVisible();
  await row.first().click();
  // The trigger now shows the bound session (its title), not the placeholder.
  await expect(page.getByRole("button", { name: "选择要绑定的 Session" })).not.toContainText(
    "选择要绑定的 Session",
  );

  // --- Details card Session id + copy ---
  // The id is selectable mono text with the copy button beside it (not inside it); the
  // copied feedback is the button's own icon flipping to the check + its tooltip flipping
  // to "已复制" — NO "已复制" text is rendered (#312), and the "Session id" label is untouched.
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  await page.locator('button[title="Session 信息"]').click();
  await expect(page.getByText(sessionId, { exact: true }).first()).toBeVisible();
  const copyBtn = page.getByRole("button", { name: "复制 Session id" });
  await copyBtn.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sessionId);
  // Feedback at the button: tooltip flips while copied; the accessible name (aria-label)
  // and the icon-only content stay — no transient text label anywhere.
  await expect(copyBtn).toHaveAttribute("title", "已复制");
  await expect(copyBtn).toHaveText("");
  // An icon swap is silent, so the confirmation ALSO lands in a visually hidden live
  // region beside the button — present in the DOM (that is what a screen reader reads)
  // while the button itself stays icon-only, as asserted right above.
  await expect(page.getByText("已复制", { exact: true })).toHaveCount(1);
  // …and both halves clear once the copied flash ends (1.5s).
  await expect(copyBtn).toHaveAttribute("title", "复制 Session id", { timeout: 5_000 });
  await expect(page.getByText("已复制", { exact: true })).toHaveCount(0);
  // The section label above the id is not the feedback target — it stays "Session id".
  await expect(page.getByText("Session id", { exact: true })).toBeVisible();
});
