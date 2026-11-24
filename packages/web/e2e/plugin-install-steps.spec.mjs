/**
 * Market setup against a running server:
 * - The card and detail manage the server copy and individual Agent copies independently.
 * - A bundled Agent skill can coexist with a service awaiting project activation.
 * - In either language, Tab reaches the service impact before activation; Enter and Space toggle it.
 * - Namesakes expose their IDs. At phone width the selected action fits, and only its Agent receives the copy.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { watchSocket } from "./api-socket.mjs";
import { zip } from "./workbench-zip.mjs";
import { contentTable } from "../../server/test/plugin-fixtures.ts";

const BASE = process.env.BASE_URL;
const name = "step-notes";
const pkg = "@test/" + name;
const title = "Step Notes";
const api = BASE + "/api/projects/default_project";

test("a server install and two Agent installs can be managed independently from the card and detail", async ({
  page,
  browser,
}) => {
  page.setDefaultTimeout(12_000);
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const files = {
    "package.json": JSON.stringify({ name: pkg, version: "1.0.0", description: title }),
    "ifaces.json": contentTable(pkg, {
      card: { title, category: "office-productivity" },
      skills: [name],
    }),
    ["skills/" + name + "/SKILL.md"]:
      "---\nname: " +
      name +
      "\ndescription: Record meeting notes.\nversion: 2026.11.22.1\n---\n\nRecord a note.\n",
  };
  const create = await page.request.post(api + "/plugins/installed/archive", {
    data: { dataBase64: zip(files).toString("base64") },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const helper = "step_helper";
  const add = await page.request.post(api + "/agents", {
    data: { agentId: helper, name: "Step helper" },
  });
  expect(add.ok(), await add.text()).toBeTruthy();
  const endpoint = BASE + "/api/admin/plugins/holders?package=" + encodeURIComponent(pkg);
  const holders = async () =>
    (await (await page.request.get(endpoint)).json()).agents.map((a) => a.agentId).sort();
  await page.setViewportSize({ width: 375, height: 800 });
  const socket = await watchSocket(page);
  // Exercise the supported HTTP fallback for this read so we can fail it and then retry the actual server.
  socket.answer("GET", new URL(endpoint).pathname + new URL(endpoint).search, {
    status: 421,
    body: {},
  });
  await page.goto("/plugins");
  const card = page.locator('article[data-plugin="' + name + '"]');
  const flow = page.getByRole("dialog", { name: "Install " + title, exact: true });
  const back = flow.getByRole("button", { name: "Back to server" });
  const forward = flow.getByRole("button", { name: "Continue to Agents" });
  await card.getByRole("button", { name: "Install · " + title, exact: true }).click();
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(flow).toContainText("is on the server");
  expect(await holders()).toEqual([]);
  await forward.click();
  for (const id of [helper, "default_agent"]) {
    await flow.locator('input[type="radio"][value="' + id + '"]').check();
    await flow
      .getByRole("button", {
        name: id === helper ? "Add to Step helper" : "Add to General Agent",
        exact: true,
      })
      .click();
    await expect(flow.getByRole("button", { name: "Uninstall " + id, exact: true })).toBeVisible();
  }
  await expect.poll(holders).toEqual(["default_agent", helper]);
  const visitor = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 375, height: 800 },
  });
  try {
    await provisionAndLogin(visitor.request, "stepmember", "password123");
    const member = await page.request.post(api + "/members", { data: { userId: "stepmember" } });
    expect(member.ok(), await member.text()).toBe(true);
    await setAccountPrefs(visitor.request, { lang: "zh" });
    const tab = await visitor.newPage();
    await tab.addInitScript(() => localStorage.setItem("penguin.lastProjectId", "default_project"));
    await tab.goto("/plugins");
    await tab
      .locator('[data-plugin="' + name + '"] button[aria-label*=" · "]')
      .first()
      .click();
    const steps = tab.getByRole("dialog").last();
    await expect(steps.getByText("Step helper", { exact: true })).toBeVisible();
    await expect(steps.getByRole("button", { name: /卸载/ })).toHaveCount(0);
    await steps.getByRole("button", { name: /返回.*服务端/ }).click();
    await expect(steps.getByRole("button", { name: /卸载/ })).toHaveCount(0);
    expect(
      (await visitor.request.delete(api + "/agents/" + helper + "/plugins/" + name)).status(),
    ).toBe(403);
    expect(
      (
        await visitor.request.delete(BASE + "/api/admin/plugins?package=" + encodeURIComponent(pkg))
      ).status(),
    ).toBe(403);
    expect(await holders()).toEqual(["default_agent", helper]);
  } finally {
    await visitor.close();
  }
  await back.click();
  await forward.click();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await card.locator(".showcase-card-open").click();
  await page.getByRole("button", { name: "Install on Agent " + name, exact: true }).click();
  await flow.locator('input[type="radio"][value="' + helper + '"]').check();
  await flow.getByRole("button", { name: "Uninstall " + helper, exact: true }).click();
  const confirmAgent = page.getByRole("dialog", { name: "Uninstall " + title, exact: true });
  await confirmAgent.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await holders()).toEqual(["default_agent", helper]);
  await flow.getByRole("button", { name: "Uninstall " + helper, exact: true }).click();
  await confirmAgent.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect.poll(holders).toEqual(["default_agent"]);
  await back.click();
  const remove = flow.getByRole("button", { name: "Uninstall from server" });
  // Interrupt the first read of the affected Agents. No destructive action is available until a successful retry.
  let failHolders = true;
  await page.route(
    (url) => url.pathname === "/api/admin/plugins/holders",
    (r) =>
      failHolders
        ? r.fulfill({ status: 409, json: { error: "busy", message: "Please retry" } })
        : r.continue(),
  );
  await remove.click();
  const confirmServer = page.getByRole("dialog", {
    name: "Uninstall " + name + " from the server",
    exact: true,
  });
  const confirm = confirmServer.getByRole("button", { name: "Uninstall from server" });
  await expect(confirm).toBeDisabled();
  await expect(confirmServer.getByRole("alert")).toBeVisible();
  failHolders = false;
  await confirmServer.getByRole("button", { name: "Retry" }).click();
  await expect(confirm).toBeEnabled();
  await expect(confirmServer).toContainText("General Agent");
  await confirm.click();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).onServer)
    .toBe(false);
  expect(await holders()).toEqual([]);
});

test("an administrator activates the bundled Computer Use module from the market despite an existing Agent Skill", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const projectId = "market_computer_use";
  expect(
    (
      await page.request.post(BASE + "/api/projects", {
        data: { projectId, name: "Computer Use market" },
      })
    ).status(),
  ).toBe(201);
  const prefix = BASE + "/api/projects/" + projectId;
  const status = async () =>
    (await (await page.request.get(prefix + "/plugins/installed")).json()).plugins.find(
      (entry) => entry.specifier === "@penguinharness/computer-use",
    );
  expect(await status()).toBeUndefined();
  const parts = await (await page.request.get(prefix + "/agents/default_agent/plugins")).json();
  expect(parts.skills.map((entry) => entry.name)).toContain("computer-use");
  await page.addInitScript((id) => localStorage.setItem("penguin.lastProjectId", id), projectId);
  await page.goto("/plugins");
  const card = page.locator('article[data-plugin="computer-use"]');
  await card.getByRole("button", { name: "Install · Computer Use", exact: true }).click();
  const flow = page.getByRole("dialog", { name: "Install Computer Use", exact: true });
  await flow.getByRole("button", { name: "Enable server module", exact: true }).click();
  await expect.poll(async () => (await status())?.active, { timeout: 20000 }).toBe(true);
  await expect(flow.getByRole("button", { name: "Back to server" })).toBeVisible();
  const settings = await page.request.put(BASE + "/api/admin/plugin-config", {
    data: { name: "computer-use", values: { enabled: false } },
  });
  expect(settings.ok(), await settings.text()).toBe(true);
  const retry = await page.request.post(BASE + "/api/admin/plugin-config/action", {
    data: { name: "computer-use", action: "install" },
  });
  expect(await retry.json()).toMatchObject({ ok: false, message: "Computer Use is off." });
  await page.reload();
  await expect(card.getByRole("button", { name: /Installed on 1 Agent/ })).toBeVisible();
  expect((await status())?.active).toBe(true);

  await card.locator("button.showcase-card-open").click();
  await page
    .getByRole("button", { name: "Disable server module computer-use", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Disable the server module of computer-use", exact: true })
    .getByRole("button", { name: "Disable server module", exact: true })
    .click();
  await expect.poll(status).toBeUndefined();
  await page.goto("/plugins");
  await expect(
    card.getByRole("button", { name: "Install · Computer Use", exact: true }),
  ).toBeVisible();
});

for (const lang of ["en", "zh"]) {
  const english = lang === "en";
  const projectId = "sheet_targets_" + lang;
  const longName = english
    ? "Production Incident Response and Customer Support Coordination"
    : "生产环境突发事件响应和客户技术支持跨团队协作与服务协调智能体";
  const displayName = english ? "On-call" : "值班";

  test(`the ${lang} sheet exposes the service impact to the keyboard before enabling it`, async ({
    page,
  }) => {
    await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
    await setAccountPrefs(page.request, { lang });
    const id = "sheet_service_" + lang;
    expect(
      (
        await page.request.post(BASE + "/api/projects", { data: { projectId: id, name: id } })
      ).status(),
    ).toBe(201);
    await page.addInitScript((id) => localStorage.setItem("penguin.lastProjectId", id), id);
    await page.goto("/plugins");
    await page
      .locator('article[data-plugin="computer-use"] .showcase-card-bar button')
      .first()
      .click();
    const flow = page.getByRole("dialog").last();
    const impact = flow.getByText(english ? "How this affects the server" : "对服务端的影响", {
      exact: true,
    });
    await page.keyboard.press("Tab");
    await expect(impact).toBeFocused();
    await page.keyboard.press("Enter");
    const warning = flow.getByText(
      english ? /running agents are not affected/i : /正在运行的 Agent 不受影响/,
    );
    await expect(warning).toBeVisible();
    await page.keyboard.press("Space");
    await expect(warning).toBeHidden();
    await page.keyboard.press("Tab");
    await expect(
      flow.getByRole("button", {
        name: english ? "Enable server module" : "启用服务端模块",
        exact: true,
      }),
    ).toBeFocused();
  });

  test(`the ${lang} Agent chooser identifies namesakes and fits the selected action on a 320px phone`, async ({
    page,
  }) => {
    await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
    await setAccountPrefs(page.request, { lang });
    expect(
      (
        await page.request.post(BASE + "/api/projects", { data: { projectId, name: projectId } })
      ).status(),
    ).toBe(201);
    const agents = BASE + "/api/projects/" + projectId + "/agents";
    for (const [agentId, name] of [
      ["alpha", displayName],
      ["beta", displayName],
      ["coordinator", longName],
    ]) {
      const create = await page.request.post(agents, {
        data: { agentId, name, defaultPlugins: false },
      });
      expect(create.ok(), await create.text()).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 720 });
    await page.addInitScript((id) => localStorage.setItem("penguin.lastProjectId", id), projectId);
    await page.goto("/plugins");
    await page
      .locator('article[data-plugin="data-analysis"] .showcase-card-bar button')
      .first()
      .click();
    const flow = page.getByRole("dialog").last();
    const action = flow.getByRole("button", {
      name: (english ? "Add to " : "添加给 ") + longName,
      exact: true,
    });
    await flow.getByRole("radio", { name: longName, exact: true }).check();
    await action.scrollIntoViewIfNeeded();
    await expect(action).toContainText(english ? "Add" : "添加");
    // The visible verb and both button edges fit its action row, even if the button overflows to the left.
    const bounds = await action.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const parent = button.parentElement.getBoundingClientRect();
      return { left: box.left - parent.left, right: parent.right - box.right };
    });
    expect.soft(bounds.left).toBeGreaterThanOrEqual(0);
    expect.soft(bounds.right).toBeGreaterThanOrEqual(0);
    await expect.soft(action).toBeInViewport({ ratio: 1 });
    for (const id of ["alpha", "beta"]) {
      const row = flow.getByRole("radio", { name: new RegExp(displayName + ".*" + id) });
      await expect(flow.getByText(id, { exact: true })).toBeVisible();
      await row.check();
    }
    await flow
      .getByRole("button", {
        name: new RegExp((english ? "Add to " : "添加给 ") + displayName + ".*beta"),
      })
      .click();
    const installed = async (id) =>
      (await (await page.request.get(agents + "/" + id + "/plugins")).json()).skills.map(
        (skill) => skill.name,
      );
    await expect.poll(() => installed("beta")).toContain("data-analysis");
    expect(await installed("alpha")).not.toContain("data-analysis");
  });
}
