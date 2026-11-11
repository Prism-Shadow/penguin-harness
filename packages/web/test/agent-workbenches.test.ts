/** @vitest-environment jsdom */
/**
 * A workbench's row on the Agent settings page's Plugins tab, a handler-only one included (one the
 * user made, so it is listed under "Not from a plugin"), with its open and management actions.
 * - "Open" opens the workbench in a new conversation with its owning Agent and tab.
 * - Each row of the More menu does its action: Reload reloads (a failure stays recoverable),
 *   Version history lists the versions and a restore asks first, and Remove asks first — a
 *   cancel writes nothing, a confirmation removes only that workbench and refreshes the list.
 * - The row's switches carry their words. The App Center switch commits on click, from the switch
 *   or from its words; a refused write leaves it where the file says.
 * - The row leads with the workbench's own App Center icon when it has one, else no image.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
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
    at: `/agents/${AGENT_ID}?tab=plugins`,
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
const appCenterSwitch = () => switchNamed(`${en.workbenches.showInAppCenter} Support`);
it("opens the selected workbench on its owning Agent", async () => {
  const { router } = await open([
    {
      id: "support.main",
      key: "main",
      title: "Support",
      renderer: { iframe: { src: "/support" } },
    },
  ]);
  await click(button(`${en.workbenches.open} Support`));
  expect(whereIs(router)).toBe("/chat/new");
  expect(router.state.location.state).toMatchObject({
    agentId: AGENT_ID,
    workbench: { projectId: PROJECT_ID, agentId: AGENT_ID, tabId: "support/main" },
  });
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
  expect(document.body.textContent).not.toContain(en.agentPlugins.ownTitle);
});
it("names both switches beside them, and flips the App Center one from its words; a refused write leaves it where the file says", async () => {
  const { server } = await open();
  const words = () => appCenterSwitch().closest("label")!;
  expect(words().textContent).toBe(en.workbenches.appCenterLabel);
  expect(switchNamed(en.workbenches.enableOne("Support")).closest("label")?.textContent).toBe(
    en.workbenches.enableLabel,
  );
  expect(appCenterSwitch().getAttribute("aria-checked")).toBe("false");

  server.refuseNext(409, "workbench_manifest_invalid", "package.json is not valid JSON");
  await click(appCenterSwitch());
  await waitFor(() => !appCenterSwitch().disabled);
  expect(appCenterSwitch().getAttribute("aria-checked")).toBe("false");

  // The words beside the switch flip it as well.
  await click(words());
  await waitFor(() => appCenterSwitch().getAttribute("aria-checked") === "true");
  await waitFor(() => !appCenterSwitch().disabled);
  await click(words());
  await waitFor(() => appCenterSwitch().getAttribute("aria-checked") === "false");
  expect(
    server
      .writes()
      .filter((request) => request.path.endsWith("/app-center"))
      .map((request) => request.body),
  ).toEqual([{ show: true }, { show: true }, { show: false }]);
});
const row = () => appCenterSwitch().closest("li")!;
it("leads the row with the workbench's own App Center icon", async () => {
  await open([], { icon: { url: "/api/icons/support.png?rev=1", tint: false } });
  expect(row().querySelector("img")?.getAttribute("src")).toBe("/api/icons/support.png?rev=1");
});
it("leads the row with the anvil tile when the workbench names no icon", async () => {
  await open();
  expect(row().querySelector("img")).toBeNull();
});
