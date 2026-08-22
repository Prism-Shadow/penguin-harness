/**
 * Regression: switching conversations while a Files-panel HTML preview is open must
 * never resurrect the old session's preview against the new session.
 *
 * Under per-conversation docks the guard is structural: B has no workspace tab of its
 * own, so switching shows NO dock at all — nothing to replay A's preview into — and B's
 * own workspace (opened via the toolbar toggle and the picker) starts on B's empty list.
 * Switching back to A remounts A's workspace tab fresh, on A's file list (the preview
 * state does not survive the scope switch — the tab's body unmounted with it).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "e2eswitch";
const P = "password123";

test("switching conversations closes the old session's HTML preview and shows the new session's list", async ({
  page,
}) => {
  // --- seed via API: one project, two sessions; demo.html exists only in A ---
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
  const mkSession = async () =>
    (
      await (
        await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
          data: {},
        })
      ).json()
    ).session.sessionId;
  const sidA = await mkSession();
  const sidB = await mkSession();
  const html = Buffer.from("<html><body><h1>Session A page</h1></body></html>").toString("base64");
  const up = await page.request.put(`${BASE}/api/sessions/${sidA}/files/content?path=demo.html`, {
    data: { dataBase64: html },
  });
  expect(up.ok(), "upload html").toBeTruthy();

  // --- in A: produce the files card and open the preview through it ---
  // The card click goes through browsePath -> openRequest, which is the state the bug
  // needs (a list click would not arm it).
  await page.goto(`${BASE}/chat/${sidA}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("files card test");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/Report generated/)).toBeVisible();
  const cardRow = page.locator('button[title="demo.html"]').filter({ hasText: "点击预览" });
  await cardRow.click();
  await expect(page.frameLocator("iframe").getByText("Session A page")).toBeVisible();

  // --- switch to B via the sidebar (client-side navigation) ---
  const sidebar = page.getByRole("complementary");
  // Wait for A's generated title so "新对话" uniquely identifies B.
  await expect(sidebar.getByText("Configure Tailwind theme").first()).toBeVisible();
  await sidebar.getByText("新对话").first().click();
  await expect(page).toHaveURL(new RegExp(sidB));

  // B manages its own tabs: no dock carried over, no iframe kept or re-created for A's
  // demo.html. B's own workspace then opens on B's (empty) list.
  await expect(page.locator('[data-testid="dock"]')).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  await expect(page.getByRole("button", { name: "返回列表" })).toHaveCount(0);
  await expect(page.getByText("空目录")).toBeVisible();

  // --- switching back to A restores A's own workspace tab, fresh on A's file list ---
  await sidebar.getByText("Configure Tailwind theme").first().click();
  await expect(page).toHaveURL(new RegExp(sidA));
  await expect(page.getByText("demo.html").first()).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});
