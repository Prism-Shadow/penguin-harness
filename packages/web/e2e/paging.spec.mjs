/**
 * Sidebar session paging: each group displays at most SIDEBAR_PAGE_SIZE (20) rows and the
 * store fetches per Agent with limit+1 pages — 21 seeded sessions must load as one page of
 * 20 plus a "更多" row; clicking it reveals the loaded rows AND fetches the next server
 * page, after which all 21 rows are visible and the "更多" row disappears (no more hidden
 * rows, no more server pages).
 *
 * A list taller than the viewport must scroll INSIDE the sidebar: the document itself
 * stays unscrollable before and after "更多". Each row's sr-only Agent name is
 * position:absolute, and without a positioned scroller those boxes anchored to the
 * initial containing block, stretched the document, and let the whole page scroll (the
 * composer could be pushed up, leaving blank space below).
 *
 * Standalone spec: shares one server with the other specs, so it registers its own user
 * (auto-provisions a default Project) and seeds sessions via the API.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "pageuser";
const P = "password123";
const TOTAL = 21; // one past the 20-row page

test("sidebar shows 20 sessions plus a More row; More loads the 21st and then disappears", async ({
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

  // Seed 21 sessions (each gets its own auto temp Workspace; the sidebar merges them into
  // the single temp-workspace group, so the display cap applies to one group).
  for (let i = 0; i < TOTAL; i++) {
    const res = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      { data: {} },
    );
    expect(res.ok(), `create session ${i}: ${await res.text()}`).toBeTruthy();
  }

  await page.goto(`${BASE}/chat`);
  const sidebar = page.getByRole("complementary");
  // Untitled rows all read "新对话" (distinct from the nav's "新建对话", which is not matched
  // by substring). One page: exactly 20 rows.
  const rows = sidebar.getByText("新对话");
  await expect(rows).toHaveCount(20);
  const more = sidebar.getByRole("button", { name: "更多" });
  await expect(more).toBeVisible();

  // The 20-row list already exceeds the 720px viewport: it must scroll inside the
  // sidebar, never stretch the document (the sr-only regression described up top).
  const docScrollable = () =>
    page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    );
  expect(await docScrollable(), "document scrollable before 更多").toBe(false);

  // More: raises the display cap and fetches the next server page → all 21 rows, no More left.
  await more.click();
  await expect(rows).toHaveCount(TOTAL);
  await expect(more).toHaveCount(0);

  // Still only the sidebar scrolls after the list grew past one page.
  expect(await docScrollable(), "document scrollable after 更多").toBe(false);
});
