/** @vitest-environment jsdom */
/**
 * A workbench's row on the Agent settings page's Plugins tab, a handler-only one included (one the
 * user made, so it is listed under "Not from a plugin"), with its open and management actions.
 * - Opening a workbench selects its owning Agent and tab in a new conversation.
 * - Reload failures remain recoverable; history can restore a recorded version.
 * - Cancelling removal writes nothing; confirming removes only that workbench and refreshes the list.
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
import { button, click, hasButton, pressScrim, unmountAll, waitFor } from "./helpers/dom";

const info = (tabs: WorkbenchInfo["tabs"]): WorkbenchInfo => ({
  id: "support",
  name: "Support",
  version: "1",
  revision: "current",
  uiRev: "ui",
  loadedAt: "2026-10-14T00:00:00Z",
  error: null,
  hints: [],
  tabs,
});
async function open(tabs: WorkbenchInfo["tabs"] = []) {
  setActiveStrings(en);
  const server = agentServer(undefined, {
    workbenches: [info(tabs)],
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
it("manages a handler-only workbench, retries failed reload and restores a recorded version", async () => {
  const { server } = await open();
  server.refuseNext(500, "reload_failed", "Cannot reload");
  await click(button(`${en.workbenches.reload} Support`));
  expect(document.body.textContent).toContain("Support");
  await click(button(`${en.workbenches.reload} Support`));
  await click(button(`${en.workbenches.history} Support`));
  expect(topDialog().textContent).toContain("previous");
  await click(buttonIn(topDialog(), en.workbenches.restore));
  // Restore asks first: nothing is rolled back until the question is answered.
  expect(server.writes().filter((request) => request.path.endsWith("/rollback"))).toEqual([]);
  await click(buttonIn(topDialog(), en.workbenches.restore));
  expect(server.writes().find((request) => request.path.endsWith("/rollback"))?.body).toEqual({
    revision: "previous",
  });
});
it("cancels without deleting, then removes only after confirmation", async () => {
  const { server } = await open();
  await click(button(`${en.workbenches.remove} Support`));
  await pressScrim();
  expect(server.writes().filter((request) => request.method === "DELETE")).toEqual([]);
  await click(button(`${en.workbenches.remove} Support`));
  await click(buttonIn(topDialog(), en.workbenches.removeYes));
  expect(
    server
      .writes()
      .filter((request) => request.method === "DELETE")
      .map((request) => request.path),
  ).toEqual([`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/workbenches/support`]);
  await waitFor(() => !hasButton(`${en.workbenches.remove} Support`));
  expect(document.body.textContent).not.toContain(en.agentPlugins.ownTitle);
});
