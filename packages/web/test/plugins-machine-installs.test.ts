// @vitest-environment jsdom
/**
 * The plugin market's "manage installs" on a machine's Agents (features/plugins/plugins-page.tsx
 * and plugin-card.tsx): a connected machine's own Agents are install targets of their own, and
 * everything done to one happens on that machine (lib/agent-location.ts).
 *
 * - Given this server's `helper` and a connected machine with a `helper` of its own, the dialog
 *   lists both — this server's first, the machine's named `[SSH: gpu-box]` after its name.
 * - Install on the machine's row installs from that machine's library onto that machine's Agent,
 *   and the row reads Installed from the machine's answer; this server's `helper` gets nothing.
 * - A plugin the machine's library does not have is refused there, and the row goes back to
 *   Install.
 * - A machine being brought back offers no row: nothing could be installed there.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp, topDialog } from "./helpers/agent-app";
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
  await mountAgentApp(h(PluginsPage), { route: "/plugins", at: "/plugins" });
  await waitFor(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.getAttribute("aria-label") === `${en.skills.manageInstall} charts`,
    ),
  );
  await click(button(`${en.skills.manageInstall} charts`));
  return server;
}

/** The machine's `helper`, as the dialog's buttons name it. */
const MACHINE_HELPER = `${AGENT_ID} ${en.chat.machineTag("gpu-box")}`;

/** Who each of the dialog's rows acts on, in order: its Install (or Uninstall) button's name. */
const rows = () =>
  [...topDialog().querySelectorAll("button")]
    .map((b) => b.getAttribute("aria-label") ?? "")
    .filter((l) => l.startsWith(`${en.skills.install} `) || l.startsWith(`${en.skills.uninstall} `))
    .map((l) => l.slice(l.indexOf(" ") + 1));

/** Whether the row of `who` offers `verb` (Install, or Uninstall once installed). */
const offers = (verb: string, who: string) =>
  [...topDialog().querySelectorAll("button")].some(
    (b) => b.getAttribute("aria-label") === `${verb} ${who}`,
  );

describe("installing a library plugin on a machine's Agent", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("lists the machine's Agents after this server's, each named with its machine", async () => {
    await openInstalls([GPU]);
    await waitFor(() => rows().length === 2);
    expect(rows()).toEqual([AGENT_ID, MACHINE_HELPER]);
    expect(topDialog().textContent).toContain(`${AGENT_ID}${en.chat.machineTag("gpu-box")}`);
  });

  it("installs on the machine's Agent from its library, and nothing on this server's", async () => {
    const server = await openInstalls([GPU]);
    await waitFor(() => rows().length === 2);
    await click(button(`${en.skills.install} ${MACHINE_HELPER}`));
    await waitFor(() => server.skillsOn("gpu1", AGENT_ID).length === 1);
    const installsSent = server.fetch.requests.filter(
      (r) =>
        r.method === "POST" && r.path === `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/plugins`,
    );
    expect(installsSent.map((r) => [r.machine, r.body])).toEqual([["gpu1", { names: ["charts"] }]]);
    expect(server.skillsOn(null, AGENT_ID)).toEqual([]);
    await waitFor(() => offers(en.skills.uninstall, MACHINE_HELPER));
    expect(offers(en.skills.install, AGENT_ID)).toBe(true);
  });

  it("goes back to Install when the machine's library does not have the plugin", async () => {
    const server = await openInstalls([{ ...GPU, library: [] }]);
    await waitFor(() => rows().length === 2);
    await click(button(`${en.skills.install} ${MACHINE_HELPER}`));
    await waitFor(() =>
      server.fetch.requests.some((r) => r.machine === "gpu1" && r.method === "POST"),
    );
    await waitFor(() => offers(en.skills.install, MACHINE_HELPER));
    expect(server.skillsOn("gpu1", AGENT_ID)).toEqual([]);
  });

  it("offers no row on a machine being brought back", async () => {
    const server = await openInstalls([{ ...GPU, reconnecting: true }]);
    await waitFor(() => rows().length === 1);
    expect(rows()).toEqual([AGENT_ID]);
    expect(server.fetch.requests.filter((r) => r.machine === "gpu1")).toEqual([]);
  });
});
