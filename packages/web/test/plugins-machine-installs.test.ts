// @vitest-environment jsdom
/**
 * The plugin market's "Install on Agent" on a machine's Agents (library/plugin/src/web/plugins-page.tsx
 * and plugin-card.tsx): a connected machine's own Agents are install targets of their own, and
 * everything done to one happens on that machine (lib/agent-location.ts).
 *
 * - Given this server's `helper` and a connected machine with a `helper` of its own, the dialog
 *   lists both — this server's first, the machine's named `[SSH: gpu-box]` after its name.
 * - Install on the machine's row installs from that machine's library onto that machine's Agent,
 *   and the row reads Installed from the machine's answer; this server's `helper` gets nothing.
 * - A plugin the machine's library does not have is refused there, and the row goes back to
 *   Install.
 * - Uninstalling from the machine's Agent is one request for the whole plugin, to that machine,
 *   and no request for any of its parts; the row goes back to Install.
 * - A machine being brought back keeps the rows of the Agents it was last seen with, in their
 *   place, every button held with the reason; nothing is asked of it. With nothing remembered of
 *   it, it has no row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { AgentSummary, PluginItem } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PluginsPage } from "@prismshadow/penguin-library-plugin/web/plugins-page";
import { rememberMachineAgents } from "../src/lib/machine-cache";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, unmountAll, waitFor } from "./helpers/dom";

const CHARTS = {
  name: "charts",
  description: "Draw charts",
  version: "1.0.0",
  title: "Charts",
  category: "office-productivity",
  skills: [{ name: "chart", description: "Draw a chart", version: "2026.10.01.1" }],
  hooks: [],
  mcpServers: [],
} as unknown as PluginItem;

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: [AGENT_ID],
  library: [CHARTS],
};

async function openInstalls(machines: FakeMachine[]) {
  // jsdom has no ResizeObserver, which the card grid's container queries do not need here.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const server = agentServer(undefined, { machines, library: [CHARTS] });
  await mountAgentApp(h(PluginsPage), { route: "/plugins", at: "/plugins?plugin=charts" });
  await waitFor(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.getAttribute("aria-label") === `${en.plugins.installModel.installAgent} charts`,
    ),
  );
  await click(button(`${en.plugins.installModel.installAgent} charts`));
  return server;
}

/** The machine's `helper`, as the dialog's buttons name it. */
const MACHINE_HELPER = `${AGENT_ID} ${en.chat.machineTag("gpu-box")}`;

const remoteKey = `gpu1/${AGENT_ID}`;
const rows = () =>
  [...topDialog().querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(
    (input) => input.value,
  );
const select = (key: string) =>
  click(topDialog().querySelector<HTMLInputElement>(`input[value="${key}"]`)!);
const remoteAdd = en.plugins.installModel.addToAgent(MACHINE_HELPER);
const localAdd = en.plugins.installModel.addToAgent("Helper");
const offers = (name: string) =>
  [...topDialog().querySelectorAll("button")].some(
    (button) => button.getAttribute("aria-label") === name,
  );

describe("installing a library plugin on a machine's Agent", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("lists the machine's Agents after this server's, each named with its machine", async () => {
    await openInstalls([GPU]);
    await waitFor(() => rows().length === 2);
    expect(rows()).toEqual([AGENT_ID, remoteKey]);
    expect(topDialog().textContent).toContain(`${AGENT_ID}${en.chat.machineTag("gpu-box")}`);
  });

  it("installs on the machine's Agent from its library, and nothing on this server's", async () => {
    const server = await openInstalls([GPU]);
    await waitFor(() => rows().length === 2);
    await select(remoteKey);
    await waitFor(() => !button(remoteAdd).disabled);
    await click(button(remoteAdd));
    await waitFor(() => server.skillsOn("gpu1", AGENT_ID).length === 1);
    const installsSent = server.fetch.requests.filter(
      (r) =>
        r.method === "POST" && r.path === `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/plugins`,
    );
    // The machine leaves its plugin tables to this server, which keeps its plugin list.
    expect(installsSent.map((r) => [r.machine, r.body])).toEqual([
      ["gpu1", { names: ["charts"], skipModules: true }],
    ]);
    expect(server.skillsOn(null, AGENT_ID)).toEqual([]);
    await waitFor(() => offers(`${en.skills.uninstall} ${MACHINE_HELPER}`));
    await select(AGENT_ID);
    expect(offers(localAdd)).toBe(true);
  });

  it("uninstalls from the machine's Agent with one request for the whole plugin, and none per part", async () => {
    const server = await openInstalls([GPU]);
    await waitFor(() => rows().length === 2);
    await select(remoteKey);
    await waitFor(() => !button(remoteAdd).disabled);
    await click(button(remoteAdd));
    await waitFor(() => offers(`${en.skills.uninstall} ${MACHINE_HELPER}`));
    await click(button(`${en.skills.uninstall} ${MACHINE_HELPER}`));
    await click(buttonIn(topDialog(), en.skills.uninstall));
    await waitFor(() => offers(remoteAdd));
    const deletes = server.fetch.requests.filter((r) => r.method === "DELETE");
    expect(deletes.map((r) => [r.machine, r.path])).toEqual([
      ["gpu1", `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/plugins/charts`],
    ]);
    expect(server.skillsOn("gpu1", AGENT_ID)).toEqual([]);
  });

  it("goes back to Install when the machine's library does not have the plugin", async () => {
    const server = await openInstalls([{ ...GPU, library: [] }]);
    await waitFor(() => rows().length === 2);
    await select(remoteKey);
    await waitFor(() => !button(remoteAdd).disabled);
    await click(button(remoteAdd));
    await waitFor(() =>
      server.fetch.requests.some((r) => r.machine === "gpu1" && r.method === "POST"),
    );
    await waitFor(() => offers(remoteAdd));
    expect(server.skillsOn("gpu1", AGENT_ID)).toEqual([]);
  });

  it("keeps a machine's last-seen rows while it is brought back, held with the reason", async () => {
    rememberMachineAgents(PROJECT_ID, "gpu1", [
      {
        agentId: AGENT_ID,
        createdAt: "2026-10-01T00:00:00Z",
        pluginUpdates: [],
      } as unknown as AgentSummary,
    ]);
    const server = await openInstalls([{ ...GPU, reconnecting: true }]);
    await waitFor(() => rows().length === 2);
    expect(rows()).toEqual([AGENT_ID, remoteKey]);
    await select(remoteKey);
    const held = button(remoteAdd);
    expect(held.disabled).toBe(true);
    expect(held.getAttribute("data-tooltip")).toBe(en.machines.composer.reconnecting);
    await select(AGENT_ID);
    expect(button(localAdd).disabled).toBe(false);
    expect(server.fetch.requests.filter((r) => r.machine === "gpu1")).toEqual([]);
  });

  it("offers no row on a machine being brought back that nothing is remembered of", async () => {
    const server = await openInstalls([{ ...GPU, reconnecting: true }]);
    await waitFor(() => rows().length === 1);
    expect(rows()).toEqual([AGENT_ID]);
    expect(server.fetch.requests.filter((r) => r.machine === "gpu1")).toEqual([]);
  });
});
