/**
 * Workspace groups page INDEPENDENTLY of one another.
 *
 * The session list is fetched per Agent, but the sidebar groups it by Workspace, so one
 * per-Agent cursor used to feed every group: the first page filled them unevenly (whichever
 * group owned the newest rows got most of it), and one group's "show more" consumed the page
 * its siblings were about to read — their rows appeared on screen untouched, their reveal
 * counts moved, and the group that asked could grow by less than a page. Each group now walks
 * its own server stream (`workspaceGroup` on the list endpoint), so:
 *
 *   - every group opens on its OWN first page, whatever the other groups hold;
 *   - revealing one group leaves the others exactly as they were.
 *
 * Two Workspaces on ONE Agent — the arrangement that shares a cursor — with the sessions
 * interleaved so no single page of the Agent's whole stream could fill both.
 *
 * Standalone spec: shares one server with the other specs, so it registers its own user
 * (auto-provisions a default Project) and seeds sessions via the API.
 */
import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "wsgroupuser";
const P = "password123";
const PAGE = 10; // SIDEBAR_PAGE_SIZE
const ALPHA = 8; // under one page: this group must open complete
const BETA = 14; // over one page: this group must open at exactly one page

/** Conversation rows inside one group's block, located by the group's label. */
const groupRows = (sidebar, label) =>
  sidebar.locator('div[class*="relative pt-2.5"]').filter({ hasText: label }).locator("li");

test("each Workspace group opens on its own page, and revealing one leaves the others alone", async ({
  page,
}) => {
  // Real directories: a Workspace is validated by realpath and must exist.
  const root = await mkdtemp(join(tmpdir(), "penguin-ws-"));
  const alpha = join(root, "ws-alpha");
  const beta = join(root, "ws-beta");
  await Promise.all([mkdir(alpha), mkdir(beta)]);

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

  const seed = async (workspace, n) => {
    for (let i = 0; i < n; i++) {
      const res = await page.request.post(
        `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
        { data: { workspace } },
      );
      expect(res.ok(), `create in ${workspace}: ${await res.text()}`).toBeTruthy();
    }
  };
  // Interleaved, oldest first: the Agent's newest page straddles both groups, so neither
  // group's own first page can come out of one whole-stream read.
  await seed(beta, 6);
  await seed(alpha, 8);
  await seed(beta, 8);

  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(`${BASE}/chat`);
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText("ws-alpha")).toBeVisible();

  // Each group opens on its own first page: beta capped at one page, alpha complete.
  await expect(groupRows(sidebar, "ws-beta")).toHaveCount(PAGE);
  await expect(groupRows(sidebar, "ws-alpha")).toHaveCount(ALPHA);
  // Only the group that actually has more offers to reveal it, and it counts its own rows.
  const revealBeta = sidebar.getByRole("button", { name: `展开其余 ${BETA - PAGE} 个对话` });
  await expect(revealBeta).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /展开其余/ })).toHaveCount(1);

  // Revealing beta pulls beta's own next page and leaves alpha untouched.
  await revealBeta.click();
  await expect(groupRows(sidebar, "ws-beta")).toHaveCount(BETA);
  await expect(groupRows(sidebar, "ws-alpha")).toHaveCount(ALPHA);
  await expect(sidebar.getByRole("button", { name: /展开其余/ })).toHaveCount(0);
  // Exact: the sidebar's own "收起侧栏" control would match a substring lookup.
  await expect(sidebar.getByRole("button", { name: "收起", exact: true })).toHaveCount(1);
});
