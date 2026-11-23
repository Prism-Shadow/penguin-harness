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
    await flow.getByRole("button", { name: "Install " + id, exact: true }).click();
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
