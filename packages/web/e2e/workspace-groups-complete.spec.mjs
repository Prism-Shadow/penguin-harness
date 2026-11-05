/**
 * Every Workspace that holds conversations is a sidebar group — not only the ones an
 * Agent's first page happened to touch.
 *
 * The list is fetched per Agent, ten newest conversations first, and the sidebar used to
 * form a Workspace group only around loaded rows: with dozens of Workspaces, every one
 * whose newest conversation was older than the Agent's ten newest simply never appeared.
 * The group list now comes from the server's per-Workspace counts (with each Workspace's
 * newest-Session stamp for ordering), and a group the first page never touched fetches its
 * own rows once its page of groups is on screen.
 *
 * Fifteen Workspaces on ONE Agent, three conversations each, seeded oldest Workspace
 * first: the Agent's ten newest rows reach four Workspaces, so eleven groups exist only
 * through the counts — spread over two pages of ten groups.
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
const U = "wscompleteuser";
const P = "password123";
const WORKSPACES = 15;
const PER_WORKSPACE = 3;
const GROUP_PAGE = 10; // SIDEBAR_GROUP_PAGE_SIZE

/** Conversation rows inside one group's block, located by the group's label. */
const groupRows = (sidebar, label) =>
  sidebar.locator('div[class*="relative pt-2.5"]').filter({ hasText: label }).locator("li");

const name = (i) => `ws-${String(i).padStart(2, "0")}`;

test("every Workspace with conversations is a group, placed by recency across the group pages", async ({
  page,
}) => {
  // Real directories: a Workspace is validated by realpath and must exist.
  const root = await mkdtemp(join(tmpdir(), "penguin-wsall-"));
  const dirs = [];
  for (let i = 1; i <= WORKSPACES; i++) {
    const dir = join(root, name(i));
    await mkdir(dir);
    dirs.push(dir);
  }

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

  // Oldest Workspace first, so the newest ten rows of the Agent's whole stream belong to
  // ws-15, ws-14, ws-13 and one row of ws-12: the other eleven Workspaces are known to the
  // sidebar through the counts alone.
  for (const dir of dirs) {
    for (let i = 0; i < PER_WORKSPACE; i++) {
      const res = await page.request.post(
        `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
        { data: { workspace: dir } },
      );
      expect(res.ok(), `create in ${dir}: ${await res.text()}`).toBeTruthy();
    }
  }

  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(`${BASE}/chat`);
  const sidebar = page.getByRole("complementary");

  // Page 1 of groups: the ten newest Workspaces, including six the first page never
  // touched — each of those fetched its own rows once on screen.
  for (let i = WORKSPACES; i > WORKSPACES - GROUP_PAGE; i--) {
    await expect(sidebar.getByText(name(i), { exact: true })).toBeVisible();
  }
  await expect(groupRows(sidebar, name(6))).toHaveCount(PER_WORKSPACE);
  await expect(groupRows(sidebar, name(12))).toHaveCount(PER_WORKSPACE);
  await expect(groupRows(sidebar, name(15))).toHaveCount(PER_WORKSPACE);
  // Nothing is left to reveal in a group whose whole share is on screen.
  await expect(sidebar.getByRole("button", { name: /展开其余/ })).toHaveCount(0);
  await expect(sidebar.getByText(name(5), { exact: true })).toHaveCount(0);

  // The pager knows every group, loaded or not: two pages of ten.
  await expect(sidebar.getByLabel("第 1 页，共 2 页")).toBeVisible();
  await sidebar.getByRole("button", { name: "下一页分组" }).click();

  // Page 2: the five oldest Workspaces, by recency, each fetching its own rows on arrival.
  for (let i = 1; i <= WORKSPACES - GROUP_PAGE; i++) {
    await expect(sidebar.getByText(name(i), { exact: true })).toBeVisible();
  }
  await expect(groupRows(sidebar, name(1))).toHaveCount(PER_WORKSPACE);
  await expect(groupRows(sidebar, name(5))).toHaveCount(PER_WORKSPACE);
  await expect(sidebar.getByText(name(15), { exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /展开其余/ })).toHaveCount(0);
});
