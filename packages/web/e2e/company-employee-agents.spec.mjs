/**
 * Company employees as development mode sees them, and an employee whose Agent is gone, end to
 * end through the browser with the mock LLM — the sequence a user reported on 2026-10-10:
 *
 * 1. An organization exists with a CEO and one hire. Development mode lists both on the Agents
 *    page under 「公司模式员工」, each with its organization and title, and the hire's delete
 *    button is off; the server refuses the delete outright (409 agent_employed).
 * 2. A development conversation runs, so it is the latest conversation of the user.
 * 3. An employee whose Agent no longer exists is seeded on disk, its desk naming a Session that
 *    does not exist — what a deletion before the protection left behind.
 * 4. In company mode the org chart marks it 「Agent 已删除」, its desk row opens nothing, its
 *    card menu offers no desk but does offer 离任, and the dead desk's link says the
 *    conversation is gone instead of opening the development one. 离任 then removes it.
 *
 * The orphan is written through the workspace-files API (an existing absolute directory a
 * Project member may write in), since a spec does not know the server's data root.
 */
import { test, expect, request } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
// Unique per run: the organization and the persisted work mode belong to the user.
const U = `orphan_${Date.now().toString(36)}`;
const P = "password123";
const ORG = "co_ops";
const CEO = `${ORG}_ceo`;
const HR = `${ORG}_hr`;
const GHOST = `${ORG}_ghost`;
const DEAD_DESK = "session-2026-10-10-09-00-00-0dead001";

async function enableCompanyMode() {
  const adminCtx = await request.newContext();
  try {
    await login(adminCtx, ADMIN_ID, ADMIN_PASSWORD);
    const res = await adminCtx.put(`${BASE}/api/admin/settings`, { data: { companyMode: true } });
    if (!res.ok()) throw new Error(`enable company mode: ${res.status()} ${await res.text()}`);
  } finally {
    await adminCtx.dispose();
  }
}

test("an employee's Agent cannot be deleted, and a deleted one never opens another conversation", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await enableCompanyMode();
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const api = (path) => `${BASE}/api/projects/${projectId}${path}`;

  expect(
    (
      await page.request.put(api("/models"), {
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
      })
    ).ok(),
    "put models",
  ).toBeTruthy();

  // --- 1. An organization with a CEO and one hire ---
  const created = await page.request.post(api("/organizations"), {
    data: { orgId: ORG, name: "Ops Desk", mission: "Keep the docs site running.", timezone: "UTC" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const hired = await page.request.post(api(`/organizations/${ORG}/employees`), {
    data: { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO },
  });
  expect(hired.ok(), await hired.text()).toBeTruthy();

  // Development mode's Agents page: the employees in their own section, the delete off.
  await page.goto("/agents");
  const employees = page.locator("section", {
    has: page.getByRole("heading", { name: /公司模式员工/ }),
  });
  await expect(employees).toBeVisible();
  const hrCard = employees.locator("> div > div", { hasText: HR });
  await expect(hrCard).toContainText("Ops Desk · HR");
  await expect(employees.locator("> div > div", { hasText: CEO })).toContainText("Ops Desk · CEO");
  await expect(hrCard.getByRole("button", { name: "删除 Agent" })).toBeDisabled();
  // And the server refuses it whoever asks.
  const refused = await page.request.delete(api(`/agents/${HR}`));
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("agent_employed");

  // --- 2. A development conversation, the latest one of the user ---
  const dev = await (
    await page.request.post(api("/agents/default_agent/sessions"), {
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  const devSessionId = dev.session.sessionId;
  await page.goto(`/chat/${devSessionId}`);
  const composer = page.getByPlaceholder(/输入消息/);
  await composer.fill("List the files, please.");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Command finished").first()).toBeVisible({ timeout: 30_000 });

  // --- 3. An employee whose Agent is gone, with a desk naming a Session that is gone ---
  const chart = await (await page.request.get(api(`/organizations/${ORG}/chart`))).json();
  const ceoWorkspace = chart.employees.find((e) => e.agentId === CEO).resolvedWorkspace;
  const orgDir = ceoWorkspace.replace(/[\\/]workspace[\\/]ceo$/, "");
  const files = (name) =>
    api(
      `/workspace-files/content?workspace=${encodeURIComponent(orgDir)}&path=${encodeURIComponent(name)}`,
    );
  const append = async (name, text) => {
    const current = await (await page.request.get(files(name))).text();
    const put = await page.request.put(files(name), {
      data: { dataBase64: Buffer.from(current + text, "utf8").toString("base64") },
    });
    expect(put.status(), `write ${name}`).toBe(204);
  };
  await append(
    "org_chart.yaml",
    [
      `  - agent_id: ${GHOST}`,
      "    title: Ghost",
      `    reports_to: ${CEO}`,
      "    workspace: ghost",
      "",
    ].join("\n"),
  );
  await append(
    "desks.toml",
    [
      "",
      `[${GHOST}]`,
      `session_id = "${DEAD_DESK}"`,
      `workspace = "${orgDir.replaceAll("\\", "/")}/workspace/ghost"`,
      'opened_at = "2026-10-10T09:00:00.000Z"',
      "",
    ].join("\n"),
  );

  // --- 4. Company mode ---
  await page.goto(`/org/${projectId}/${ORG}/chart`);
  await expect(page.getByText("Agent 已删除").first()).toBeVisible();

  // The desk row is there, marked, and opens nothing — not the dead desk, not the latest
  // development conversation.
  const sidebar = page.getByRole("complementary");
  const ghostRow = sidebar.getByRole("button", { name: `${GHOST} 的工位 · Agent 已删除` });
  await expect(ghostRow).toHaveAttribute("aria-disabled", "true");
  await ghostRow.click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/org/${projectId}/${ORG}/chart$`));

  // The card's menu has no desk to open, and 离任 is how the entry goes.
  await page.getByRole("button", { name: `${GHOST} · 员工操作` }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "离任" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "打开工位会话" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "设思考等级" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The dead desk's own link says the conversation is gone, and stays where it is.
  await page.goto(`/chat/${DEAD_DESK}`);
  await expect(page.getByText("会话不存在或已被删除")).toBeVisible();
  await expect(page.getByRole("button", { name: "回到组织概览" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/chat/${DEAD_DESK}$`));
  await expect(page.getByText("Command finished")).toHaveCount(0);

  // 离任 removes the entry; nothing else did.
  await page.goto(`/org/${projectId}/${ORG}/chart`);
  await page.getByRole("button", { name: `${GHOST} · 员工操作` }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "离任" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "离任" }).click();
  await expect(page.getByText("Agent 已删除")).toHaveCount(0);
  const after = await (await page.request.get(api(`/organizations/${ORG}/chart`))).json();
  expect(after.employees.map((e) => e.agentId)).not.toContain(GHOST);
});
