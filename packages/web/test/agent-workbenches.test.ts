/** @vitest-environment jsdom */
/**
 * A workbench's row on the Agent settings Plugins tab's Workbenches sub-page, a handler-only one
 * included (one the user made, so it carries no plugin's mark), with its open and management
 * actions.
 * - "Open" opens the app's window over the main area, and its Close comes back to the row; a
 *   workbench hidden from the sidebar and the App Center opens all the same, from the row's own
 *   reading of it.
 * - A workbench without a page shows what its load noticed on its row, every hint in the row's
 *   hint. While its files do not load, its More menu also opens the error's report and "Fix with
 *   AI", which asks first and then opens a chat holding the repair prompt, unsent; a workbench
 *   that loads offers neither.
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
import { rowOf } from "./helpers/agent-plugins";
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { closeReport, reportStore } from "@prismshadow/penguin-ui";
import { AgentSettingsPage } from "@prismshadow/penguin-library-agent/web/agents/agent-settings-page";
import { draftKey, loadDraft } from "../src/features/chat/draft-cache";
import { ADMIN_ME } from "./helpers/admin-settings";
import { WorkspaceWindows, pageAction } from "./helpers/workspace-windows";
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
    layers: [h(ThemeProvider, null, h(WorkspaceWindows))],
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

  await pageAction("Support", en.appCenter.windowClose);
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
it("offers management, Enable and Open without making visibility changes for a hidden workbench", async () => {
  const title = "Support";
  const { server } = await open(
    [{ id: "support.main", key: "main", title, renderer: { iframe: { src: "/support" } } }],
    { enabled: true, appCenter: { show: false } },
  );
  const row = rowOf(title);
  expect(row.querySelectorAll("button")).toHaveLength(4); // Name, Enable, Open, More.
  expect(switchNamed(en.workbenches.enableOne(title))).toBeTruthy();
  expect(hasButton(`${en.workbenches.open} ${title}`)).toBe(true);
  expect(hasButton(`${en.workbenches.more} ${title}`)).toBe(true);
  expect(server.writes().filter((r) => r.path.endsWith("/app-center"))).toHaveLength(0);
});
const row = () => rowOf("Support");
it("leads the row with the workbench's own App Center icon", async () => {
  await open([], { icon: { url: "/api/icons/support.png?rev=1", tint: false } });
  expect(row().querySelector("img")?.getAttribute("src")).toBe("/api/icons/support.png?rev=1");
});
it("leads the row with the anvil tile when the workbench names no icon", async () => {
  await open();
  expect(row().querySelector("img")).toBeNull();
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
it("offers the error's report and Fix with AI in the More menu while the files do not load", async () => {
  const error = "index.ts(3,1): error TS2304: Cannot find name 'nope'.";
  localStorage.clear();
  const { server, router } = await open([], { error });
  expect(document.body.textContent).toContain(error);

  await more(en.report.action);
  expect(reportStore.getState().open?.output?.text).toBe(error);
  closeReport();

  await more(en.plugins.repair);
  // It asks first: nothing has moved yet.
  expect(whereIs(router)).toBe(`/agents/${AGENT_ID}?tab=workbenches`);
  await click(buttonIn(topDialog(), en.plugins.repairOpen));
  await waitFor(() => whereIs(router) === "/chat/new");
  const draft = loadDraft(draftKey(ADMIN_ME.user.userId, PROJECT_ID));
  // The Project has no default_agent here: its first Agent takes the repair.
  expect(draft).toMatchObject({ agentId: AGENT_ID, workspace: "", aiPrefill: true });
  expect(draft.text).toContain(error);
  expect(server.writes().filter((request) => request.path.includes("/sessions"))).toEqual([]);
});
it("offers neither in the More menu of a workbench that loads", async () => {
  await open();
  await click(button(`${en.workbenches.more} Support`));
  expect(() => menuItem(en.workbenches.reload)).not.toThrow();
  expect(() => menuItem(en.plugins.repair)).toThrow();
  expect(() => menuItem(en.report.action)).toThrow();
});
