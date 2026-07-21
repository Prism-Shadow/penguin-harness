/**
 * End-to-end test for the skill library (locale zh-CN):
 * - the sidebar nav shows "技能库" ("Skill Library"), and the page renders the library's skill
 *   cards across group sections (a collapsible group header: group name + skill count,
 *   **no icon**; the group name follows the UI language — when the server ships a Chinese
 *   group name it's "办公效率 / 软件开发 / AI 应用开发 / Agent 调优", falling back to
 *   English by default); cards carry a custom icon (icon.svg sanitized then inlined, not the book
 *   fallback), with metadata showing version and usage count (worded semantically, not a bare
 *   number badge);
 * - the "Manage installation" Modal: an Agent row + Install / Installed (hover flips to
 *   Uninstall) button, with optimistic updates on install/uninstall;
 * - "Quick invoke" navigates to /chat/new (default_agent), **prefilling** the invoke text in the
 *   UI language (zh: "使用 X 技能") and preselecting that skill — the toolbar's skill dropdown
 *   button shows a count badge of 1, and that item shows as selected in the menu;
 * - the skill dropdown: the search box filters by name (typing "sdk" leaves only
 *   penguin-sdk); clicking a row toggles selection **without closing the menu**;
 * - selections are written into the draft (#74 comment): in draft state, checking the dropdown
 *   then reloading keeps both the body and the selection; in session state, selecting via slash
 *   then reloading likewise persists (keyed by user x Session);
 * - sending the prefilled body directly -> the message stream collapses the <use_skills> block
 *   into a "使用技能" ("Use skills") banner, the invoke text still renders normally, the stored
 *   message really does start with the block, and the selection clears once sending succeeds;
 * - slash invocation: typing /<prefix> shows a skill command item, and pressing Enter selects
 *   that skill and clears the input box (without sending).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "skillsuser";
const P = "password123";

// Group names follow the UI language: Chinese when the server dist ships titleZh, otherwise
// falling back to English (both states are asserted).
// The group header is a collapsible button (group name + skill count); matched by a substring of its accessible name.
const GROUPS = [
  /Office Productivity|办公效率/,
  /Software Development|软件开发/,
  /AI App Development|AI 应用开发/,
  /Agent Tuning|Agent 调优/,
];
const SKILLS = [
  "agent-creation",
  "benchmark-design",
  "agent-evaluation",
  "agent-optimization",
  "data-analysis",
  "penguin-sdk",
  "penguin-cli",
  "agenthub-models",
  "web-design",
  "software-engineering",
];

// The path prefix of the default book icon (used as a fallback): the group header has no icon,
// and the card renders a custom icon.svg — neither spot should show this fallback path.
const BOOK_PATH_PREFIX = "M2 3h6a4";

test("skills: library groups and cards -> manage-install Modal -> quick-invoke prefill -> dropdown filter and slash selection", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  // The default model points at the mock LLM (once sent, the mock provides the fallback
  // reply). The model reference is given as a pair: provider and modelId are separate fields,
  // and modelId is the upstream id verbatim (no concatenation of any kind).
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

  // The install target for "Manage installation": default_agent has all skills preinstalled, so use a blank Agent to exercise the install/uninstall flow.
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_helper", name: "Helper Agent" },
  });
  expect(created.ok(), "create helper agent").toBeTruthy();

  // —— Skill library page: sidebar nav entry + grouped cards (group headers are collapsible buttons, all expanded by default) ——
  await page.goto(`${BASE}/chat`);
  const navLink = page.getByRole("link", { name: "技能库" });
  await expect(navLink).toBeVisible();
  await navLink.click();
  await expect(page).toHaveURL(/\/skills$/);
  for (const g of GROUPS) {
    const header = page.getByRole("button", { name: g });
    await expect(header).toBeVisible();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    // The group header no longer has an icon: the book path must not appear in the group header button.
    await expect(header.locator(`svg path[d^="${BOOK_PATH_PREFIX}"]`)).toHaveCount(0);
  }
  for (const s of SKILLS) {
    await expect(page.getByText(s, { exact: true })).toBeVisible();
  }
  // Card metadata is worded semantically: version + usage count (default_agent has all skills preinstalled -> at least 1 in use).
  await expect(page.getByText(/v\d+ · .*Agent 在用/).first()).toBeVisible();

  // Card icon: the DTO icon (icon.svg in the skill's directory) is sanitized and rendered
  // inline (an aria-hidden wrapper + svg); builtin skills each carry a custom icon, not the book
  // fallback. The card root = the nearest rounded-md ancestor of the name element (the new card
  // layout has the icon spanning two rows on the left, with the name and short description as
  // separate text columns, so it can no longer be located by "the innermost div containing the name").
  const creationCard = page
    .getByText("agent-creation", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
  await expect(creationCard.locator("span[aria-hidden] > svg")).toHaveCount(1);
  await expect(creationCard.locator(`svg path[d^="${BOOK_PATH_PREFIX}"]`)).toHaveCount(0);

  // Clicking the group header collapses it: aria-expanded flips, and the group's content
  // becomes inert (a zero-height card can't be interacted with); clicking again expands it back.
  // The collapsed content is still in the DOM (a grid-rows 0fr height transition), so assert
  // inert rather than visibility.
  const firstHeader = page.getByRole("button", { name: GROUPS[0] });
  const firstGroup = page.locator("section").filter({ has: firstHeader });
  await firstHeader.click();
  await expect(firstHeader).toHaveAttribute("aria-expanded", "false");
  await expect(firstGroup.locator("[inert]")).toHaveCount(1);
  await firstHeader.click();
  await expect(firstHeader).toHaveAttribute("aria-expanded", "true");
  await expect(firstGroup.locator("[inert]")).toHaveCount(0);

  // —— Manage installation Modal: an Agent row + Install/Installed (clicking Installed uninstalls) ——
  await page.getByRole("button", { name: "管理安装 agent-creation" }).click();
  const dialog = page.locator("div").filter({ hasText: "管理安装：agent-creation" }).last();
  // default_agent (display name General Agent) has everything preinstalled -> "已安装"
  // ("Installed", whose accessible name is the uninstall action); agent_helper has nothing
  // installed -> "安装" ("Install").
  const uninstallDefault = page.getByRole("button", { name: "卸载 default_agent" });
  const installHelper = page.getByRole("button", { name: "安装 agent_helper" });
  await expect(uninstallDefault).toBeVisible();
  await expect(uninstallDefault).toContainText("已安装");
  await expect(installHelper).toBeVisible();
  // Install onto helper: optimistic update, the button flips to "已安装" ("Installed", the uninstall action).
  await installHelper.click();
  const uninstallHelper = page.getByRole("button", { name: "卸载 agent_helper" });
  await expect(uninstallHelper).toBeVisible();
  await expect(uninstallHelper).toContainText("已安装");
  // Server-side truth converges: agent-creation really does appear in helper's installed list.
  await expect
    .poll(async () => {
      const res = await (
        await page.request.get(`${BASE}/api/projects/${projectId}/agents/agent_helper/skills`)
      ).json();
      return res.skills.map((s) => s.name);
    })
    .toContain("agent-creation");
  // Clicking "已安装" ("Installed") uninstalls: flips back to "安装" ("Install").
  await uninstallHelper.click();
  await expect(page.getByRole("button", { name: "安装 agent_helper" })).toBeVisible();
  // Escape closes the Modal (built into the Modal).
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // —— Quick invoke: navigates to /chat/new (default_agent), prefilling the invoke text + preselecting that skill ——
  await page.getByRole("button", { name: "快捷调用 agent-creation" }).click();
  await page.waitForURL(/\/chat\/new$/);
  const ta = page.getByPlaceholder(/输入消息/);
  // Prefilled per the UI language (zh): 使用 X 技能 ("use the X skill").
  await expect(ta).toHaveValue("使用 agent-creation 技能");
  // The draft belongs to default_agent (display name General Agent).
  await expect(page.getByLabel("选择 Agent")).toContainText("General Agent");

  // The toolbar's skill dropdown button: the selected-count badge is 1 (chips no longer exist; the badge is the only visible rendering).
  const skillsBtn = page.getByRole("button", { name: "技能", exact: true });
  await expect(skillsBtn).toBeVisible();
  await expect(skillsBtn).toContainText("1");

  // Open the menu: all listed skills each occupy a row (default_agent has everything preinstalled), with agent-creation shown as selected.
  const row = (name) => page.getByRole("button", { name: new RegExp(`^${name}`) });
  await skillsBtn.click();
  for (const s of SKILLS) {
    await expect(row(s)).toBeVisible();
  }
  await expect(row("agent-creation")).toHaveAttribute("aria-pressed", "true");

  // Search filter: typing "sdk" leaves only penguin-sdk.
  await page.getByPlaceholder("搜索技能").fill("sdk");
  await expect(row("penguin-sdk")).toBeVisible();
  await expect(row("agent-creation")).toHaveCount(0);
  await page.getByPlaceholder("搜索技能").fill("");

  // Clicking a row toggles its selection **without closing the menu**: select penguin-sdk, then deselect it.
  await row("penguin-sdk").click();
  await expect(row("penguin-sdk")).toHaveAttribute("aria-pressed", "true");
  await expect(skillsBtn).toContainText("2");

  // —— Survives a reload (#74 comment): checking the dropdown writes into the draft immediately, so both the body and the selection persist after a reload ——
  await page.reload();
  await expect(ta).toHaveValue("使用 agent-creation 技能");
  await expect(skillsBtn).toContainText("2");
  await skillsBtn.click();
  await expect(row("penguin-sdk")).toHaveAttribute("aria-pressed", "true");

  await row("penguin-sdk").click();
  await expect(row("penguin-sdk")).toHaveAttribute("aria-pressed", "false");
  await expect(skillsBtn).toContainText("1");
  // Escape closes the menu (built into the Dropdown).
  await page.keyboard.press("Escape");
  await expect(row("agent-creation")).toHaveCount(0);

  // —— Sending the prefilled body directly -> "使用技能" ("Use skills") banner + invoke text lands in the message ——
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const sessionId = page.url().split("/chat/")[1];

  // Message stream: the block collapses into a "使用技能" ("Use skills") banner, and the
  // prefilled body "使用 agent-creation 技能" still renders normally; the selection clears once
  // sending succeeds (the dropdown button's badge disappears).
  await expect(page.getByText(/使用技能.*agent-creation/)).toBeVisible();
  await expect(page.getByText("使用 agent-creation 技能", { exact: true })).toBeVisible();
  await expect(skillsBtn).not.toContainText("1");

  // The mock LLM's fallback reply completes a full round (allow-all auto-approves exec_command).
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // —— Slash invocation: typing /agent-opt shows a skill command item; pressing Enter selects it and clears the input box (without sending) ——
  await ta.fill("/agent-opt");
  await expect(page.getByRole("button", { name: /\/agent-optimization/ })).toBeVisible();
  await ta.press("Enter");
  await expect(ta).toHaveValue("");
  await expect(skillsBtn).toContainText("1");
  await skillsBtn.click();
  await expect(row("agent-optimization")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // The session-state selection is likewise written into the draft (keyed by user x Session): the selection persists after a reload.
  await page.reload();
  await expect(skillsBtn).toContainText("1");
  await skillsBtn.click();
  await expect(row("agent-optimization")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // The stored message really does start with the <use_skills> block (the banner is only a
  // rendering-layer collapse; Trace/storage keeps the raw text), with the body being the invoke
  // text prefilled by quick invoke.
  const messages = await (
    await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)
  ).json();
  const flat = JSON.stringify(messages);
  expect(flat, "stored message keeps the <use_skills> block").toContain("<use_skills>");
  expect(flat, "block lists the selected skill").toContain("skills: agent-creation");
  expect(flat, "prefilled body follows the block").toContain("使用 agent-creation 技能");
});
