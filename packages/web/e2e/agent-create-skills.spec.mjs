/**
 * End-to-end test for seeding a new Agent with library plugins from the create dialog (locale
 * zh-CN):
 * - the Agents page's "创建 Agent" ("Create agent") dialog carries a Plugins field whose trigger
 *   reads as a placeholder until something is picked, and whose panel is the shared multi-select
 *   list — a search box, one toggle row per library plugin, and a bulk row with 全选 / 全不选
 *   ("select all" / "select none") beside the running count;
 * - 全选 picks every library plugin and 全不选 clears them, both without closing the panel;
 * - the search box narrows the list, and the bulk controls then act on what the search leaves
 *   visible rather than on the whole library — so a filtered 全选 adds only the matches;
 * - creating with a selection installs exactly those plugins into the new Agent: the settings
 *   page's Skills tab lists their skills, and the server's installed list agrees;
 * - creating with nothing picked still yields a plain Agent with no skills.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "seeduser";
const P = "password123";

/** The bulk row's running count (exact: the trigger carries the same prefix with a trailing noun). */
const pickedCount = (page, n) => page.getByText(`已选 ${n} 个`, { exact: true });

/**
 * One library plugin row in the picker panel. The row's accessible name is the plugin name followed
 * by its description, so the match is anchored at the start AND closed at a non-name character:
 * a bare `^name` prefix would match `web-design` and `web-design-pro` both, and resolve to two
 * buttons the moment the library grows such a pair.
 */
const row = (page, name) =>
  page.getByRole("button", {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`),
  });

test("agent create: pick library plugins (select all / none, filtered) -> they are installed on the new Agent", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  // The library is the source of truth for what the picker offers.
  const library = await (await page.request.get(`${BASE}/api/plugins`)).json();
  const libraryNames = library.groups.flatMap((g) => g.plugins.map((p) => p.name));
  expect(libraryNames.length).toBeGreaterThan(2);

  await page.goto(`${BASE}/agents`);
  await page.getByRole("button", { name: "创建 Agent" }).first().click();

  const idField = page.getByRole("textbox", { name: /^Agent id/ });
  await expect(idField).toBeVisible();
  await idField.fill("seeded_agent");

  // —— The Plugins field: placeholder until something is picked ——
  const picker = page.getByRole("button", { name: "插件", exact: true });
  await expect(picker).toContainText("未选择插件");
  await picker.click();

  // Every library plugin has a row, and the bulk row reports an empty selection.
  for (const name of libraryNames) {
    await expect(row(page, name)).toBeVisible();
  }
  await expect(pickedCount(page, 0)).toBeVisible();

  // —— 全选 / 全不选: the panel stays open and the count follows ——
  await page.getByRole("button", { name: "全选" }).click();
  await expect(pickedCount(page, libraryNames.length)).toBeVisible();
  await expect(row(page, libraryNames[0])).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "全不选" }).click();
  await expect(pickedCount(page, 0)).toBeVisible();
  await expect(row(page, libraryNames[0])).toHaveAttribute("aria-pressed", "false");

  // —— The search box narrows the list, and 全选 then acts on the matches only ——
  await page.getByPlaceholder("搜索插件").fill("agent-development");
  await expect(row(page, "agent-development")).toBeVisible();
  await page.getByRole("button", { name: "全选" }).click();
  await expect(pickedCount(page, 1)).toBeVisible();
  await page.getByPlaceholder("搜索插件").fill("");

  // A second plugin picked by clicking its row (toggle, panel stays open).
  await row(page, "software-development").click();
  await expect(row(page, "software-development")).toHaveAttribute("aria-pressed", "true");
  await expect(pickedCount(page, 2)).toBeVisible();

  // Escape closes the picker panel without closing the dialog (the Esc-layer stack).
  await page.keyboard.press("Escape");
  await expect(picker).toContainText("已选 2 个插件");
  await expect(idField).toBeVisible();

  // —— Create: the picked plugins (each shipping a same-named skill) are installed into the new Agent ——
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForURL(/\/agents\/seeded_agent$/);

  const installed = await (
    await page.request.get(`${BASE}/api/projects/${projectId}/agents/seeded_agent/skills`)
  ).json();
  expect(installed.skills.map((s) => s.name).sort()).toEqual([
    "penguin-config",
    "penguin-orchestration",
    "penguin-sdk",
    "software-engineering",
    "unified-llm-api",
    "web-design",
  ]);

  // The Skills tab shows the same two.
  await page.goto(`${BASE}/agents/seeded_agent?tab=skills`);
  await expect(page.getByText("penguin-sdk", { exact: true })).toBeVisible();
  await expect(page.getByText("web-design", { exact: true })).toBeVisible();

  // —— Creating without picking anything leaves a plain Agent ——
  await page.goto(`${BASE}/agents`);
  await page.getByRole("button", { name: "创建 Agent" }).first().click();
  await page.getByRole("textbox", { name: /^Agent id/ }).fill("plain_agent");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForURL(/\/agents\/plain_agent$/);
  const none = await (
    await page.request.get(`${BASE}/api/projects/${projectId}/agents/plain_agent/skills`)
  ).json();
  expect(none.skills).toEqual([]);
});
