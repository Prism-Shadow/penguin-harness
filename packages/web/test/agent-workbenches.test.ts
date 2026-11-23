/** @vitest-environment jsdom */
/**
 * A workbench's row on the Agent settings Plugins tab's Workbenches sub-page, a handler-only one
 * included (one the user made, so it carries no plugin's mark), with its open and management
 * actions.
 * - "Open" opens the app's window over the main area, and its Close comes back to the row; a
 *   workbench hidden from the sidebar and the App Center opens all the same, from the row's own
 *   reading of it.
 * - A workbench without a page shows what its load noticed on its row, every hint in the row's
 *   hint.
 * - Each row of the More menu does its action: Reload reloads (a failure stays recoverable),
 *   Version history lists the versions and a restore asks first, and Remove asks first — a
 *   cancel writes nothing, a confirmation removes only that workbench and refreshes the list,
 *   which then says the Agent has no workbench.
 * - Hide and Unhide write the owning machine's App Center setting once, roll back on failure,
 *   and keep the sidebar setting independent.
 * - The row leads with the workbench's own App Center icon when it has one, else no image.
 * - The More menu's sidebar row is checked by default; picking it writes the sidebar setting at
 *   once and nothing of the App Center's, and a refused write puts it back.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AppCenterWindows } from "../src/features/app-center/app-center-windows";
import { ThemeProvider } from "../src/state/theme";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  mountAgentApp,
  whereIs,
  buttonIn,
  topDialog,
} from "./helpers/agent-app";
import {
  button,
  click,
  hasButton,
  menuItem,
  pressScrim,
  switchNamed,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const info = (tabs: WorkbenchInfo["tabs"], over: Partial<WorkbenchInfo> = {}): WorkbenchInfo => ({
  id: "support",
  name: "Support",
  version: "1",
  revision: "current",
  uiRev: "ui",
  loadedAt: "2026-10-14T00:00:00Z",
  error: null,
  hints: [],
  tabs,
  ...over,
});
async function open(tabs: WorkbenchInfo["tabs"] = [], over: Partial<WorkbenchInfo> = {}) {
  setActiveStrings(en);
  const server = agentServer(undefined, {
    workbenches: [info(tabs, over)],
    workbenchVersions: [
      {
        revision: "previous",
        commit: "0123456789ab",
        savedAt: "2026-10-13T00:00:00Z",
      },
    ],
  });
  const router = await mountAgentApp(h(AgentSettingsPage), {
    at: `/agents/${AGENT_ID}?tab=workbenches`,
  });
  await waitFor(() => document.body.textContent?.includes("Support") === true);
  return { server, router };
}
afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});
/** Picks a row of the workbench's More menu. */
async function more(item: string) {
  await click(button(`${en.workbenches.more} Support`));
  await click(menuItem(item));
}
const visibilityName = (shown: boolean) => `${en.workbenches.appCenterVisibility(shown)} Support`;
const visibility = (shown: boolean) => button(visibilityName(shown));
/** The settings page with the shell's windows beside it, as the app mounts them. */
async function openWithWindows(over: Partial<WorkbenchInfo> = {}) {
  setActiveStrings(en);
  const tab = { id: "support.main", key: "main", title: "Support" };
  agentServer(undefined, {
    workbenches: [info([{ ...tab, renderer: { iframe: { src: "/support" } } }], over)],
  });
  const router = await mountAgentApp(h(AgentSettingsPage), {
    at: `/agents/${AGENT_ID}?tab=workbenches`,
    extra: [{ path: "/apps", element: h("p", null, "App Center") }],
    layers: [h(ThemeProvider, null, h(AppCenterWindows))],
  });
  await waitFor(() => hasButton(`${en.workbenches.open} Support`));
  return router;
}
const appWindow = () => document.querySelector<HTMLElement>('section[aria-label="Support"]');
it("opens the app's window over the main area, and its Close comes back to the row", async () => {
  const router = await openWithWindows();
  await click(button(`${en.workbenches.open} Support`));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(`${AGENT_ID}/support`)}`);
  await waitFor(() => appWindow()?.querySelector("iframe") != null);
  expect(appWindow()!.querySelector("iframe")!.getAttribute("title")).toBe("Support");

  await click(buttonIn(appWindow()!, en.appCenter.windowClose));
  expect(whereIs(router)).toBe(`/agents/${AGENT_ID}?tab=workbenches`);
  expect(appWindow()).toBeNull();
});
it("reloads from the More menu, keeps a failed reload recoverable, and restores a recorded version after asking", async () => {
  const { server } = await open();
  const reloads = () => server.writes().filter((request) => request.path.endsWith("/reload"));
  server.refuseNext(500, "reload_failed", "Cannot reload");
  await more(en.workbenches.reload);
  expect(document.body.textContent).toContain("Support");
  await more(en.workbenches.reload);
  expect(reloads()).toHaveLength(2);
  await more(en.workbenches.historyAction);
  expect(topDialog().textContent).toContain("previous");
  await click(buttonIn(topDialog(), en.workbenches.restore));
  // Restore asks first: nothing is rolled back until the question is answered.
  expect(server.writes().filter((request) => request.path.endsWith("/rollback"))).toEqual([]);
  await click(buttonIn(topDialog(), en.workbenches.restore));
  expect(server.writes().find((request) => request.path.endsWith("/rollback"))?.body).toEqual({
    revision: "previous",
  });
});
it("asks before removing from the More menu: a cancel deletes nothing, a confirmation removes only that workbench", async () => {
  const { server } = await open();
  await more(en.workbenches.remove);
  await pressScrim();
  expect(server.writes().filter((request) => request.method === "DELETE")).toEqual([]);
  await more(en.workbenches.remove);
  await click(buttonIn(topDialog(), en.workbenches.removeYes));
  expect(
    server
      .writes()
      .filter((request) => request.method === "DELETE")
      .map((request) => request.path),
  ).toEqual([`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/workbenches/support`]);
  await waitFor(() => !hasButton(`${en.workbenches.more} Support`));
  expect(document.body.textContent).toContain(en.agentPlugins.workbenchesEmpty);
});
it("offers one contextual App Center action, restoring it after a refused write", async () => {
  const { server } = await open();
  const writes = () => server.writes().filter((request) => request.path.endsWith("/app-center"));
  expect(switchNamed(en.workbenches.enableOne("Support")).closest("label")?.textContent).toBe(
    en.workbenches.enableLabel,
  );
  expect(visibility(false).textContent).toBe(en.workbenches.appCenterVisibility(false));
  server.refuseNext(409, "workbench_manifest_invalid", "package.json is not valid JSON");
  await click(visibility(false));
  await waitFor(
    () => writes().length === 1 && hasButton(visibilityName(false)) && !visibility(false).disabled,
  );
  await click(visibility(false));
  await waitFor(() => hasButton(visibilityName(true)) && !visibility(true).disabled);
  await click(visibility(true));
  await waitFor(() => hasButton(visibilityName(false)) && !visibility(false).disabled);
  expect(writes().map((request) => [request.method, request.body])).toEqual([
    ["PATCH", { show: true }],
    ["PATCH", { show: true }],
    ["PATCH", { show: false }],
  ]);
  await click(button(`${en.workbenches.more} Support`));
  expect(document.querySelector('[role="menu"]')?.textContent).not.toMatch(/App Center/);
  expect(menuItem(en.workbenches.showInSidebar)).toBeTruthy();
});
it("writes the visibility of a machine's Agent on that machine", async () => {
  setActiveStrings(en);
  const server = agentServer(undefined, {
    workbenches: [info([])],
    machines: [{ machineId: "gpu1", alias: "gpu-box", agents: [AGENT_ID] }],
  });
  await mountAgentApp(h(AgentSettingsPage), {
    at: `/agents/${AGENT_ID}?machine=gpu1&tab=workbenches`,
  });
  await waitFor(() => document.body.textContent?.includes("Support") === true);
  await click(visibility(false));
  await waitFor(() => hasButton(visibilityName(true)));
  expect(
    server
      .writes()
      .filter((request) => request.path.endsWith("/app-center"))
      .map((request) => [request.machine, request.body]),
  ).toEqual([["gpu1", { show: true }]]);
});
const row = () => visibility(false).closest("li")!;
it("leads the row with the workbench's own App Center icon", async () => {
  await open([], { icon: { url: "/api/icons/support.png?rev=1", tint: false } });
  expect(row().querySelector("img")?.getAttribute("src")).toBe("/api/icons/support.png?rev=1");
});
it("leads the row with the anvil tile when the workbench names no icon", async () => {
  await open();
  expect(row().querySelector("img")).toBeNull();
});
/** The More menu's sidebar row, the menu opened for it. */
async function sidebarRow() {
  await click(button(`${en.workbenches.more} Support`));
  return menuItem(en.workbenches.showInSidebar);
}
it("takes the workbench off the sidebar from the More menu, writing nothing of the App Center; a refused write puts it back", async () => {
  const { server } = await open();
  const sidebarWrites = () =>
    server.writes().filter((request) => request.path.endsWith("/sidebar"));
  expect((await sidebarRow()).getAttribute("aria-checked")).toBe("true");
  server.refuseNext(500, "internal_error", "Disk full");
  await click(menuItem(en.workbenches.showInSidebar));
  await waitFor(() => sidebarWrites().length === 1);
  const refused = await sidebarRow();
  await waitFor(() => refused.getAttribute("aria-disabled") !== "true");
  expect(refused.getAttribute("aria-checked")).toBe("true");

  await click(refused);
  await waitFor(() => sidebarWrites().length === 2);
  const written = await sidebarRow();
  await waitFor(() => written.getAttribute("aria-checked") === "false");
  expect(sidebarWrites().map((request) => [request.method, request.body])).toEqual([
    ["PATCH", { show: false }],
    ["PATCH", { show: false }],
  ]);
  expect(server.writes().filter((request) => request.path.endsWith("/app-center"))).toEqual([]);
  expect(hasButton(visibilityName(false))).toBe(true);
});
it("opens a workbench hidden from the sidebar and the App Center in its window all the same", async () => {
  const router = await openWithWindows({ showInSidebar: false, appCenter: { show: false } });
  await click(button(`${en.workbenches.open} Support`));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(`${AGENT_ID}/support`)}`);
  await waitFor(() => appWindow()?.querySelector("iframe") != null);
});
it("shows what the load of a workbench without a page noticed on its row", async () => {
  const hints = [
    "ui/extra.html is not shown by any page: list it in WebModule.sessionTabs",
    "ui/old.html is not shown by any page: remove it",
  ];
  await open([], { hints });
  const notice = [...document.querySelectorAll<HTMLElement>("[data-tooltip]")].find(
    (el) => el.textContent === hints[0],
  );
  expect(notice?.dataset["tooltip"]).toBe(hints.join("\n"));
});
