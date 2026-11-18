/** App Center and market across two machine proxies. Keep the real app, login and local server. */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { watchSocket } from "./api-socket.mjs";

const project = "/api/projects/default_project";
const machinesPath = project + "/machines";
const apps = project + "/app-center";
const agents = project + "/agents";
const plugins = "/api/plugins";
const ok = (body) => ({ status: 200, body });
const shortcut = {
  agentId: "default_agent",
  agentName: "Penguin",
  workbenchId: "desk",
  title: "Desk",
  build: "ready",
  path: "/app/default_project/default_agent/desk",
};
const plugin = {
  name: "remote-notes",
  package: "@example/remote-notes",
  title: "Remote Notes",
  description: "Take notes",
  version: "1.0.0",
  source: "installed",
  skills: [{ name: "notes", description: "Take notes", version: "1" }],
  hooks: [],
  mcpServers: [],
};

test("a slow, offline or returning machine only affects its own apps and plugin actions", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const frame = await watchSocket(page);
  const agentList = await (await page.request.get(agents)).json();
  const machine = (id, alias) => ({
    id: "ssh:" + alias,
    alias,
    member: true,
    local: false,
    machineId: id,
    installed: { version: "1", at: "2026-01-01" },
    connection: { pid: 21 },
    socket: null,
    api: null,
    status: null,
    root: "/tmp",
  });
  const fast = machine("fast", "Office");
  const slow = machine("slow", "Laptop");
  const machines = [fast, slow];
  frame.answer("GET", machinesPath, () => ok({ machines, imageVersion: "1", job: null, jobs: [] }));
  frame.answer("GET", apps, ok({ shortcuts: [shortcut], layout: null }));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let releaseLibrary;
  const libraryGate = new Promise((resolve) => {
    releaseLibrary = resolve;
  });
  let firstSlow = true;
  let denySlow = false;
  let installCount = 0;
  for (const { machineId } of machines) {
    const remote = (path) => "/server/" + machineId + path;
    frame.answer("GET", remote(apps), async () => {
      if (machineId === "slow" && firstSlow) {
        firstSlow = false;
        await gate;
      }
      if (machineId === "slow" && denySlow)
        return {
          status: 403,
          body: { error: { code: "project_forbidden", message: "Access revoked." } },
        };
      return ok({ shortcuts: [shortcut], layout: null });
    });
    frame.answer("GET", remote(agents), ok(agentList));
    frame.answer("GET", remote(plugins), async () => {
      if (machineId === "slow") await libraryGate;
      const entry =
        machineId === "fast"
          ? plugin
          : {
              ...plugin,
              name: "laptop-notes",
              package: "@example/laptop-notes",
              title: "Laptop Notes",
            };
      return ok({ groups: [{ id: "tools", title: "Tools", plugins: [entry] }] });
    });
    frame.answer(
      "GET",
      remote(plugins + "/registry"),
      ok({ plugins: [], failures: [], pending: [] }),
    );
    frame.answer(
      "GET",
      remote(project + "/plugins/installed"),
      ok({ machineId, plugins: [], shipped: [], file: "", restartPending: false }),
    );
    const receipt = () =>
      ok({
        skills: installCount && machineId === "fast" ? plugin.skills : [],
        hooks: [],
        workbenches: [],
        mcpServers: [],
      });
    for (const agent of agentList.agents)
      frame.answer("GET", remote(agents + "/" + agent.agentId + "/plugins"), receipt);
    frame.answer("POST", remote(agents + "/default_agent/plugins"), () => {
      installCount++;
      return receipt();
    });
    frame.answer("GET", remote(plugins + "/remote-notes/readme"), ok({ readme: "Office readme" }));
    frame.answer("GET", remote(plugins + "/remote-notes/files"), ok({ files: {} }));
    frame.answer("GET", remote(agents + "/default_agent/workbenches"), ok({ workbenches: [] }));
  }
  const tile = (id) => page.locator('[data-app="' + id + 'default_agent/desk"] button').first();
  await page.goto("/apps");
  await expect(tile("")).toBeEnabled();
  await expect(tile("fast:")).toBeEnabled();
  await expect(tile("slow:")).toHaveCount(0);
  release();
  await expect(tile("slow:")).toBeEnabled();
  await tile("fast:").click();
  await expect(page).toHaveURL(/app=fast%3Adefault_agent%2Fdesk/);
  await expect
    .poll(() =>
      frame.calls.some((c) => c.path === "/server/fast" + agents + "/default_agent/workbenches"),
    )
    .toBe(true);
  await page.goBack();
  // A cached machine stays visible through a hard reload while offline. Other tiles open.
  slow.connection = null;
  frame.emit("/api/events", "server_event", { type: "machines_changed" });
  await expect(tile("slow:")).toBeDisabled();
  const slowCalls = () => frame.calls.filter((c) => c.path === "/server/slow" + apps).length;
  const previous = slowCalls();
  await page.reload();
  await expect(tile("slow:")).toBeDisabled();
  await expect(tile("fast:")).toBeEnabled();
  expect(slowCalls()).toBe(previous);
  slow.connection = { pid: 22 };
  frame.emit("/api/events", "server_event", { type: "machines_changed" });
  await expect(tile("slow:")).toBeEnabled();
  expect(slowCalls()).toBe(previous + 1);

  await page.goto("/plugins");
  const card = page.locator('[data-plugin="remote-notes"]');
  await expect(card).toContainText("Office");
  const laptop = page.locator('[data-plugin="laptop-notes"]');
  await expect(laptop).toHaveCount(0);
  releaseLibrary();
  await expect(laptop).toContainText("Laptop");
  slow.connection = null;
  frame.emit("/api/events", "server_event", { type: "machines_changed" });
  await expect(laptop.locator(".market-plugin-actions button").first()).toBeDisabled();
  const libraryReads = () =>
    frame.calls.filter((c) => c.path === "/server/slow/api/plugins").length;
  const beforeReload = libraryReads();
  await page.reload();
  await expect(laptop).toContainText("Laptop");
  await expect(laptop.locator(".market-plugin-actions button").first()).toBeDisabled();
  expect(libraryReads()).toBe(beforeReload);
  slow.connection = { pid: 22 };
  frame.emit("/api/events", "server_event", { type: "machines_changed" });
  await expect(laptop.locator(".market-plugin-actions button").first()).toBeEnabled();
  expect(libraryReads()).toBe(beforeReload + 1);
  await card.getByText("Remote Notes", { exact: true }).click();
  await expect(page).toHaveURL(/machine=fast/);
  await expect
    .poll(() =>
      frame.calls.some((c) => c.path === "/server/fast" + plugins + "/remote-notes/files"),
    )
    .toBe(true);
  await page.goBack();
  const buttons = card.locator(".market-plugin-actions button");
  await expect(buttons.first()).toBeEnabled();
  await buttons.first().click();
  await expect(buttons.last()).toBeEnabled();
  expect(installCount).toBe(1);
  expect(
    frame.calls
      .filter((c) => c.method === "POST" && c.path.endsWith("/default_agent/plugins"))
      .map((c) => c.path),
  ).toEqual(["/server/fast" + agents + "/default_agent/plugins"]);
  await buttons.last().click();
  await expect(page).toHaveURL(/\/chat\/new/);
  const route = await page.evaluate(() => history.state.usr);
  expect(route).toMatchObject({ agentId: "default_agent", machineId: "fast", workspace: "" });
  // Removing this machine from the Project also revokes its session snapshots when neither catalog is open.
  machines.splice(machines.indexOf(fast), 1);
  frame.emit("/api/events", "server_event", { type: "machines_changed" });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter(
            (k) => k.startsWith("penguin.catalog.") && k.endsWith("\u0000fast"),
          ).length,
      ),
    )
    .toBe(0);
  await page.goto("/apps");
  await expect(tile("slow:")).toBeEnabled();
  await expect(tile("fast:")).toHaveCount(0);
  denySlow = true;
  await page.reload();
  await expect(tile("")).toBeEnabled();
  await expect
    .poll(() => frame.calls.filter((c) => c.path === "/server/slow" + apps).length)
    .toBeGreaterThan(previous + 1);
  await expect(tile("slow:")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter(
            (k) => k.startsWith("penguin.catalog.apps.") && k.endsWith("\u0000slow"),
          ).length,
      ),
    )
    .toBe(0);
});
