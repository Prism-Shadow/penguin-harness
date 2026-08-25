/**
 * Sidebar session paging: each group displays at most SIDEBAR_PAGE_SIZE (10) rows and the
 * store fetches per Agent with limit+1 pages. 21 seeded sessions must load as one page of
 * 10 plus a reveal row that counts THIS group's own remainder ("展开其余 11 个对话");
 * each click reveals one page more and fetches the next server page when the reveal runs
 * past what is loaded, so the count walks 11 → 1 → gone, and a "收起" row folds the whole
 * group back to its first page.
 *
 * A list taller than the viewport must scroll INSIDE the sidebar: the document itself
 * stays unscrollable before and after the reveal. Each row's sr-only Agent name is
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
const PAGE = 10; // SIDEBAR_PAGE_SIZE
const TOTAL = 21; // two full pages plus one, so the reveal row must survive a click

test("a group reveals its own remainder one page at a time, and 收起 folds it back", async ({
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

  // Seed 21 sessions (each gets its own temporary Workspace; the sidebar merges them into
  // the single temporary-workspace group, so the display cap applies to one group).
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
  // by substring). One page: exactly 10 rows.
  const rows = sidebar.getByText("新对话");
  await expect(rows).toHaveCount(PAGE);
  // The reveal row names the group's own hidden conversations, counted off its exact
  // server share rather than a shared "there is more somewhere" signal.
  const reveal = sidebar.getByRole("button", { name: `展开其余 ${TOTAL - PAGE} 个对话` });
  await expect(reveal).toBeVisible();
  // Exact: the sidebar's own "收起侧边栏" control would match a substring lookup.
  const collapse = sidebar.getByRole("button", { name: "收起", exact: true });
  await expect(collapse).toHaveCount(0);

  // The 10-row list plus the group chrome already exceeds the 720px viewport: it must
  // scroll inside the sidebar, never stretch the document (the sr-only regression up top).
  const docScrollable = () =>
    page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    );
  expect(await docScrollable(), "document scrollable before the reveal").toBe(false);

  // One click = one page: 20 rows, the remainder recounted to 1, and 收起 now offered.
  await reveal.click();
  await expect(rows).toHaveCount(PAGE * 2);
  await expect(
    sidebar.getByRole("button", { name: `展开其余 ${TOTAL - PAGE * 2} 个对话` }),
  ).toBeVisible();
  await expect(collapse).toBeVisible();

  // The last click empties the group: every row on screen, no reveal row left (nothing
  // hidden, no server page behind it), 收起 still there to fold it back.
  await sidebar.getByRole("button", { name: `展开其余 ${TOTAL - PAGE * 2} 个对话` }).click();
  await expect(rows).toHaveCount(TOTAL);
  await expect(sidebar.getByRole("button", { name: /展开其余/ })).toHaveCount(0);
  await expect(collapse).toBeVisible();

  // Still only the sidebar scrolls after the list grew past one page.
  expect(await docScrollable(), "document scrollable after the reveal").toBe(false);

  // 收起 returns the group to its first page — the fetched rows stay in memory, so the
  // reveal row comes back naming the full remainder again.
  await collapse.click();
  await expect(rows).toHaveCount(PAGE);
  await expect(reveal).toBeVisible();
  await expect(collapse).toHaveCount(0);
});
