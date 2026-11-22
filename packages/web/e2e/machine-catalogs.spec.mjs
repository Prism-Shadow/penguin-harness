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

test("a slow, offline or returning machine only affects its own App Center tiles", async ({
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
