/**
 * Company mode, end to end through the browser with the mock LLM: switch modes, create the
 * marketplace organization from the switcher, land on the CEO's desk conversation (its
 * initialization run is answered by the mock), find the CEO on the org chart, a ticket on the
 * board, and see a chat mention reach the CEO's desk as an `[org_trigger]` work run.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
// Unique per run: the organization and the persisted work mode belong to the user, so a rerun
// against the same data root must start from a fresh one.
const U = `boardmember_${Date.now().toString(36)}`;
const P = "password123";
const ORG = "marketplace";
// "slow text test" makes the mock stream its answer for ~8 s, so the page can be checked
// while the CEO's initialization run is still in flight.
const MISSION =
  "slow text test: 做一个 DeepSeek Harness 插件 Marketplace，通过社交媒体和 SEO 把搜索排名做到前三，靠首页限时置顶曝光位盈利。";

test("company mode: create the organization, meet the CEO, see the board and the chat work", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await provisionAndLogin(page.request, U, P);
  const project = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0];
  const projectId = project.projectId;
  const api = (path) => `${BASE}/api/projects/${projectId}${path}`;

  // A model that talks to the mock, so the CEO's desk can actually run its initialization.
  const put = await page.request.put(api("/models"), {
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

  await page.goto("/");
  await expect(page.getByText("General Agent").first()).toBeVisible();

  // The mode switch sits above the Project switcher; company mode shows the organization switcher.
  const modeSwitch = page.getByRole("group", { name: "工作模式" });
  await expect(modeSwitch).toBeVisible();
  await modeSwitch.getByRole("button", { name: "公司", exact: true }).click();
  await expect(page).toHaveURL(/\/org/);
  // With no organization yet, the landing page offers creation directly (the switcher does too).
  await page.getByRole("button", { name: "新建组织", exact: true }).first().click();

  // The modal is a headed card; its fields are named by their labels (hint text included).
  await expect(page.getByRole("heading", { name: "新建组织" })).toBeVisible();
  await page.getByRole("textbox", { name: /^组织 id/ }).fill(ORG);
  await page.getByRole("textbox", { name: /^显示名/ }).fill("Plugin Marketplace");
  await page.getByRole("textbox", { name: /^使命/ }).fill(MISSION);
  await page.getByRole("button", { name: "创建", exact: true }).click();

  // Creation opens the CEO's desk conversation: an ordinary chat page that renders while the
  // initialization run is still streaming (the trigger banner and the live state appear at
  // once, not after the run ends).
  await expect(page).toHaveURL(/\/chat\/session-/, { timeout: 30_000 });
  await expect(page.getByText(/由组织「marketplace」触发/).first()).toBeVisible({ timeout: 3_000 });
  const detail = await (await page.request.get(api(`/organizations/${ORG}`))).json();
  expect(detail.employeeCount).toBe(1);
  expect(detail.ceoDeskSessionId).toBeTruthy();
  expect(page.url()).toContain(detail.ceoDeskSessionId);
  const agents = (await (await page.request.get(api("/agents"))).json()).agents;
  expect(agents.some((a) => a.agentId === `${ORG}_ceo`)).toBe(true);

  // The initialization run reached the desk as an [org_trigger] input the mock answered.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${BASE}/api/sessions/${detail.ceoDeskSessionId}/messages`,
        );
        const text = await res.text();
        return text.includes("[org_trigger]") && text.includes("kind: init");
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  // The org chart shows the CEO by its display name.
  await page.goto(`/org/${projectId}/${ORG}/chart`);
  await expect(page.getByText("Plugin Marketplace CEO").first()).toBeVisible();

  // A ticket filed against the CEO shows on the board in the proposed column.
  const created = await page.request.post(api(`/organizations/${ORG}/tickets`), {
    data: {
      title: "Build the marketplace site",
      goal: "A site that lists DeepSeek Harness plugins with search and a featured row.",
      owner: `agent:${ORG}_ceo`,
      priority: "P1",
    },
  });
  expect(created.ok(), "create ticket").toBeTruthy();
  const ticket = await created.json();
  expect(ticket.status).toBe("proposed");
  await page.goto(`/org/${projectId}/${ORG}/tickets`);
  await expect(page.getByText("Build the marketplace site").first()).toBeVisible();

  // A chat mention typed in the browser lands on the CEO's desk as a mention work run.
  await page.goto(`/org/${projectId}/${ORG}/chat`);
  const input = page.getByRole("textbox", { name: /写点什么/ });
  await expect(input).toBeVisible();
  await input.fill(`@${ORG}_ceo 先把站点搭起来，验收标准写在工单里。`);
  await input.press("Enter");
  await expect(page.getByText("先把站点搭起来").first()).toBeVisible();
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${BASE}/api/sessions/${detail.ceoDeskSessionId}/messages`,
        );
        return (await res.text()).includes("kind: mention");
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  // The overview reflects it all: one employee, one proposed ticket, the mission on screen.
  await page.goto(`/org/${projectId}/${ORG}/overview`);
  await expect(page.getByText("Plugin Marketplace").first()).toBeVisible();

  // Switching back to development mode from an organization page takes effect at once: the
  // development sidebar (with its new-chat entry) replaces the company one.
  await page
    .getByRole("group", { name: "工作模式" })
    .getByRole("button", { name: "开发", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "新建对话" }).first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page).not.toHaveURL(/\/org\//);
  const overview = await (await page.request.get(api(`/organizations/${ORG}`))).json();
  expect(overview.board.proposed).toBe(1);
  expect(overview.openTickets).toBe(1);
});
