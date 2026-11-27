/**
 * The App Center across two machines, against the real Web App, login and local server; the two
 * machines are answered at this server's proxy (`/server/<machineId>/…`) over the page's socket.
 *
 * - A slow machine holds back only its own tiles; two machines' same-named apps are two tiles,
 *   and one opens in its own window, read from its own machine.
 * - A machine out of reach keeps its tiles through a hard reload, greyed and not asked; when it
 *   connects again it is asked once and its tiles open again.
 * - A machine that leaves the Project's list takes its tiles and the tab's copies with it; one
 *   that refuses access loses its tiles at the next read.
 *
 * The plugin market across a machine, whose server modules this server's real Project tables own:
 * - A module the Project lists for the machine alone is removable on the machine's card, though
 *   the machine reports it in its shared table; the removal goes to this server and leaves the
 *   machine's own table out of it.
 * - A module only the machine's own index offers installs through this server, which lists it for
 *   that machine in the Project's tables.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { watchSocket } from "./api-socket.mjs";

const project = "/api/projects/default_project";
const machinesPath = project + "/machines";
const apps = project + "/app-center";
const agents = project + "/agents";
const ok = (body) => ({ status: 200, body });
const shortcut = {
  agentId: "default_agent",
  agentName: "Penguin",
  workbenchId: "desk",
  title: "Desk",
  build: "ready",
  path: "/app/default_project/default_agent/desk",
};

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

test("a slow, offline or returning machine only affects its own App Center tiles", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const frame = await watchSocket(page);
  const agentList = await (await page.request.get(agents)).json();
  const fast = machine("fast", "Office");
  const slow = machine("slow", "Laptop");
  const machines = [fast, slow];
  frame.answer("GET", machinesPath, () => ok({ machines, imageVersion: "1", job: null, jobs: [] }));
  frame.answer("GET", apps, ok({ shortcuts: [shortcut], layout: null }));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let firstSlow = true;
  let denySlow = false;
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

  // A machine out of reach keeps its tiles through a hard reload, and is not asked meanwhile.
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

  // A machine the Project no longer lists takes the tab's copies of its answers with it.
  machines.splice(machines.indexOf(fast), 1);
  frame.emit("/api/events", "server_event", { type: "machines_changed" });
  await expect(tile("fast:")).toHaveCount(0);
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

  // A machine that refuses access loses its tiles at the next read.
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

test("the market writes a machine's server modules into this server's Project tables", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const office = "OfficeMachine001";
  const tables = project + "/plugins/installed";
  const listedFor = async (specifier) => {
    const res = await page.request.get(tables);
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).plugins.find((p) => p.specifier === specifier)?.machines ?? null;
  };
  // The Project lists one module for the office machine alone, in this server's own tables.
  const listed = await page.request.post(tables, {
    data: { specifier: "@example/office-only", machineId: office },
  });
  expect(listed.ok(), await listed.text()).toBe(true);
  expect(await listedFor("@example/office-only")).toEqual([office]);

  const frame = await watchSocket(page);
  const agentList = await (await page.request.get(agents)).json();
  const machines = [
    {
      id: "ssh:Office",
      alias: "Office",
      member: true,
      local: false,
      machineId: office,
      installed: { version: "1", at: "2026-01-01" },
      connection: { pid: 21 },
      socket: null,
      api: null,
      status: null,
      root: "/tmp",
    },
  ];
  frame.answer("GET", machinesPath, ok({ machines, imageVersion: "1", job: null, jobs: [] }));
  const remote = (path) => "/server/" + office + path;
  frame.answer("GET", remote("/api/plugins"), ok({ groups: [] }));
  frame.answer(
    "GET",
    remote("/api/plugins/registry"),
    ok({
      plugins: [
        {
          name: "@example/office-tool",
          version: "1.0.0",
          description: "Only the office's sources list it.",
          authors: [],
          license: "MIT",
        },
      ],
      failures: [],
      pending: [],
    }),
  );
  // The machine runs what the fleet sync handed it, as its own shared table.
  frame.answer(
    "GET",
    remote(tables),
    ok({
      machineId: office,
      plugins: [
        {
          specifier: "@example/office-only",
          active: true,
          builtin: false,
          modules: [],
          replaces: [],
          everywhere: true,
          machines: [],
          here: true,
        },
      ],
      shipped: [],
      file: "",
      restartPending: false,
    }),
  );
  frame.answer("GET", remote(agents), ok(agentList));
  for (const agent of agentList.agents)
    frame.answer(
      "GET",
      remote(agents + "/" + agent.agentId + "/plugins"),
      ok({ skills: [], hooks: [], workbenches: [], mcpServers: [] }),
    );

  // Every write to a plugin list, whichever way it went: the page's socket, or plain HTTP (an
  // install's progress stream). A write sent to the machine would read /server/<machineId>/….
  const sent = [];
  const record = (method, path, body) => {
    if (method !== "GET" && path.includes("/plugins/installed"))
      sent.push({ write: method + " " + path.split("?")[0], body });
  };
  frame.onCall((c) => record(c.method, c.path, c.body));
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/socket")) return;
    record(r.method(), url.pathname, r.postData() ? JSON.parse(r.postData()) : undefined);
  });
  const writes = () => sent.map((s) => s.write);

  await page.goto("/plugins");

  // The machine says who holds the package (no Agent there) and takes the uninstall.
  const holders =
    "/api/admin/plugins/holders?package=" + encodeURIComponent("@example/office-only");
  frame.answer(
    "GET",
    remote(holders),
    ok({
      package: "@example/office-only",
      plugin: null,
      onServer: true,
      shipped: false,
      shared: [],
      agents: [],
    }),
  );
  frame.answer(
    "DELETE",
    remote("/api/admin/plugins?package=" + encodeURIComponent("@example/office-only")),
    ok({ agents: [] }),
  );

  // Remove: the machine's card leads to its page, and the removal there lists it off this
  // server's table for the machine.
  const only = page.locator('[data-plugin="office-only"]');
  await expect(only).toContainText("Office");
  await only.locator("a").first().click();
  await page.getByRole("button", { name: /^More actions for / }).click();
  const remove = page.getByRole("menuitem", { name: /Uninstall from server/ });
  await expect(remove).toBeEnabled();
  await remove.click();
  await page.getByRole("dialog").getByRole("button", { name: "Uninstall from server" }).click();
  await expect.poll(() => listedFor("@example/office-only")).toBe(null);
  expect(writes()).toEqual(["DELETE " + tables]);
  await page.goto("/plugins");

  // Install: a package only the machine's index offers is listed for it, here.
  const tool = page.locator('[data-plugin="office-tool"]');
  await expect(tool).toContainText("Office");
  await tool.locator("[data-install-button]").click();
  await page.getByRole("dialog").getByRole("button", { name: "Install", exact: true }).click();
  await expect.poll(() => listedFor("@example/office-tool")).toEqual([office]);
  expect(writes()).toEqual(["DELETE " + tables, "POST " + tables]);
  expect(sent[1]?.body).toEqual({ specifier: "@example/office-tool@1.0.0", machineId: office });
});

test("two machines can open and close the same workbench independently in Apps", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const wire = await watchSocket(page);
  const agentList = await (await page.request.get(agents)).json();
  const workbenches = agents + "/default_agent/workbenches";
  const installed = await (await page.request.get(workbenches)).json();
  const template = installed.workbenches.find((item) => item.tabs?.length && !item.error);
  expect(template).toBeTruthy();
  const { workbenchId, title } = shortcut;
  const uiPath = workbenches + "/" + workbenchId + "/ui/main.html";
  const tab = {
    id: workbenchId + ".main",
    key: "main",
    title,
    renderer: { iframe: { src: uiPath } },
  };
  const app = { ...template, id: workbenchId, name: workbenchId, tabs: [tab] };
  const machines = [machine("fast", "Office"), machine("slow", "Studio")];
  wire.answer("GET", machinesPath, ok({ machines, imageVersion: "1", job: null, jobs: [] }));
  for (const { machineId, alias } of machines) {
    const remote = "/server/" + machineId;
    wire.answer("GET", remote + apps, ok({ shortcuts: [shortcut], layout: null }));
    wire.answer("GET", remote + agents, ok(agentList));
    wire.answer(
      "GET",
      remote + workbenches + "?id=" + workbenchId,
      ok({ ...installed, workbenches: [app] }),
    );
    await page.route("**" + remote + uiPath + "*", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>" + alias + "</h1>" }),
    );
  }
  const group = page.getByRole("navigation", { name: "Apps", exact: true });
  const key = (machineId) => machineId + ":default_agent/" + workbenchId;
  const tile = (machineId) => page.locator(`[data-app="${key(machineId)}"] > button`).first();
  const row = (machineId) => group.locator(`[data-app-row="${key(machineId)}"]`);
  const frame = (machineId) => page.frameLocator(`iframe[src*="/server/${machineId}${uiPath}"]`);

  await page.goto("/apps");
  for (const { machineId } of machines) {
    await expect(tile(machineId)).toBeEnabled();
    await expect(row(machineId)).toHaveCount(0);
  }
  await tile("fast").click();
  await expect(frame("fast").getByRole("heading", { name: "Office" })).toBeVisible();
  await page.getByRole("link", { name: /^App Center(?: ·|$)/ }).click();
  await tile("slow").click();
  await expect(frame("slow").getByRole("heading", { name: "Studio" })).toBeVisible();
  for (const { machineId, alias } of machines) {
    await expect(row(machineId)).toHaveAccessibleName(new RegExp(alias));
  }
  const office = group
    .getByRole("listitem")
    .filter({ has: page.locator(`[data-app-row="${key("fast")}"]`) });
  await office.hover();
  await office.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(row("fast")).toHaveCount(0);
  await expect(row("slow")).toHaveCount(1);
  await expect(page.locator(`iframe[src*="/server/fast${uiPath}"]`)).toHaveCount(0);
});

test("workbench avatars identify distinct Agents on the same machine", async ({ page }) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "zh" });
  const frame = await watchSocket(page);
  const list = await (await page.request.get(agents)).json();
  const penguin = list.agents.find((agent) => agent.agentId === "default_agent");
  const writer = { ...penguin, agentId: "writer", name: "Writer" };
  const office = machine("office", "Lab");
  const desk = { ...shortcut, plugin: "workspace-tools" };
  const otherDesk = { ...desk, agentId: writer.agentId, agentName: writer.name };
  const notes = { ...desk, workbenchId: "notes" };
  const unique = { ...desk, workbenchId: "calendar" };
  const remote = (path) => "/server/office" + path;
  const remoteDesk = { ...desk, workbenchId: "review" };
  const remoteWriter = { ...otherDesk, workbenchId: "review" };
  const picturePath = remote(agents + "/default_agent/avatar") + "?rev=office-picture";
  await page.route(
    (url) => url.pathname + url.search === picturePath,
    (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
          "base64",
        ),
      }),
  );
  frame.answer(
    "GET",
    machinesPath,
    ok({ machines: [office], imageVersion: "1", job: null, jobs: [] }),
  );
  frame.answer("GET", apps, ok({ shortcuts: [desk, otherDesk, notes, unique], layout: null }));
  frame.answer("GET", agents, ok({ agents: [penguin, writer] }));
  frame.answer(
    "GET",
    remote(apps),
    ok({ shortcuts: [desk, notes, remoteDesk, remoteWriter], layout: null }),
  );
  frame.answer(
    "GET",
    remote(agents),
    ok({ agents: [{ ...penguin, avatarRev: "office-picture" }, writer] }),
  );
  const tile = (key) => page.locator(`[data-app="${key}"]`);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/apps");
    await expect(tile("office:default_agent/desk")).toBeVisible();
    for (const id of ["default_agent/desk", "writer/desk"]) {
      const owner = tile(id).locator("[data-workbench-owner]");
      await expect(owner.locator("svg [data-variant]").first()).toBeAttached();
      await expect(owner).toHaveText("");
    }
    const picture = tile("office:default_agent/review").locator("[data-workbench-owner] img");
    await expect(picture).toHaveAttribute("src", picturePath);
    await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBe(1);
    await expect(tile("office:writer/review").locator("[data-workbench-owner] svg")).toBeVisible();
    for (const id of [
      "office:default_agent/desk",
      "default_agent/notes",
      "office:default_agent/notes",
      "default_agent/calendar",
    ]) {
      await expect(tile(id)).toBeVisible();
      await expect(tile(id).locator("[data-workbench-owner]")).toHaveCount(0);
    }
  }
});
