// @vitest-environment jsdom
/**
 * The plugin market's install status while a machine connects, answers slowly, fails or blinks
 * (features/plugins/plugins-page.tsx, agent-installs.ts). A card's status word and its "used by"
 * count change only when an answer says something different — never because a read is in
 * flight, failed, or a machine went out of reach — so every scenario reads the whole sequence of
 * what the card showed, not only where it ended.
 *
 * - Given this server's helper has charts and a connected machine is held, the card reads
 *   Installed and "used by 1 agent" until the machine answers, then "used by 2 agents" (its
 *   helper has charts too); this server's helper is asked once.
 * - Given a machine whose Agent list fails, its helper remembered holding charts, the card keeps
 *   "used by 2 agents" with a hover that counts one as last seen, and the machine's row in the
 *   dialog is held with the failure; brought back, the machine is asked again and this server's
 *   Agents are not.
 * - Given the machine blinks (reconnecting, then back) while the page is open, no status text
 *   changes and this server's Agents are not asked again.
 * - Given the page is left and entered again, its first paint shows the statuses it showed, and
 *   a re-read answering the same changes no text.
 * - Given a machine leaves the Project's list, its Agents stop counting and what was remembered
 *   of their installs is forgotten; this server's stays.
 * - Given a machine in the Project, the header's machine picker is there from the first paint and
 *   stays in its place, reading "This server", while the machine drops out of reach and comes
 *   back; meanwhile the machine's entry says it is out of reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { AgentSummary, PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "../src/api/endpoints";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  cachedAgentInstalls,
  rememberAgentInstalls,
  rememberMachineAgents,
} from "../src/lib/machine-cache";
import { publishMachinesChanged } from "../src/state/machines";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp, topDialog } from "./helpers/agent-app";
import type { AgentServer, FakeMachine } from "./helpers/agent-app";
import {
  button,
  click,
  hasButton,
  run,
  settle,
  unmountAll,
  waitFor,
  watchText,
} from "./helpers/dom";
import { json } from "./helpers/fetch";

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

/** The machine's `helper` as its list answers it, for remembering it before the page opens. */
const GPU_HELPER = {
  agentId: AGENT_ID,
  name: AGENT_ID,
  createdAt: "2026-10-01T00:00:00Z",
  activeSessionCount: 0,
  sessionCount: 0,
  sessionActivity: [],
  toolCount: 2,
  version: 1,
  kernelOutdated: false,
  vaultKeyCount: 1,
  scheduleCount: 0,
  skillCount: 0,
  hookCount: 0,
  workbenchCount: 0,
  memoryCount: 0,
  apiEnabled: false,
  pluginUpdates: [],
} as AgentSummary;

/** The machine's `helper`, as the dialog's buttons name it. */
const MACHINE_HELPER = `${AGENT_ID} ${en.chat.machineTag("gpu-box")}`;

// Installed counts are the card's button's words (the label on show over its stacked sizes).
const COUNT = '[data-plugin="charts"] [data-install-button] > span.grid > span:first-child';
const textOf = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? null;
const counts = () => watchText(COUNT, (node) => node.textContent?.trim() ?? "");
const offlineNotice = () =>
  document.body.textContent?.includes(en.appCenter.machinesOffline("gpu-box"));
const PICKER = `button[aria-label="${en.plugins.viewMachine}"]`;
/** The page header's controls, in the order they sit. */
const headerControls = () =>
  [...document.querySelectorAll("button")]
    .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "")
    .filter((name) =>
      [en.plugins.viewMachine, en.plugins.importPlugin, en.plugins.openSettings].includes(name),
    );
/** The entries of the open machine picker. */
const pickerEntries = () =>
  [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim() ?? "");

const USED_BY_1 = en.plugins.marketAgentInstalls(1);
const USED_BY_2 = en.plugins.marketAgentInstalls(2);

/** Reads of an Agent's installed plugins answered so far on that server (null: this one). */
const installsReads = (server: AgentServer, machine: string | null) =>
  server
    .requests()
    .filter(
      (r) =>
        r.method === "GET" && r.machine === machine && /\/agents\/[^/]+\/plugins$/.test(r.path),
    ).length;

/** Reads of the machine's Agent list answered so far. */
const listReads = (server: AgentServer, machine: string) =>
  server
    .requests()
    .filter(
      (r) =>
        r.method === "GET" &&
        r.machine === machine &&
        r.path === `/api/projects/${PROJECT_ID}/agents`,
    ).length;

/** The fake server with charts installed on this server's helper and, when asked, on the machine's. */
async function serverWithCharts(onMachine: boolean) {
  const server = agentServer(undefined, { machines: [GPU], library: [CHARTS] });
  await api.installAgentPlugins(PROJECT_ID, AGENT_ID, ["charts"], null);
  const machineInstalls = onMachine
    ? await api.installAgentPlugins(PROJECT_ID, AGENT_ID, ["charts"], "gpu1")
    : null;
  return { server, machineInstalls };
}

const openPage = () => mountAgentApp(h(PluginsPage), { route: "/plugins", at: "/plugins" });

/** Reads of the Project's machine list answered so far: how the page hears of a link change. */
const machinesReads = (server: AgentServer) =>
  server.requests().filter((r) => r.path === `/api/projects/${PROJECT_ID}/machines`).length;

/** Takes the machine out of reach, or brings it back, and waits until the page has read so. */
async function setReachable(server: AgentServer, reachable: boolean) {
  const before = machinesReads(server);
  server.setReconnecting("gpu1", !reachable);
  await run(() => publishMachinesChanged());
  await waitFor(() => machinesReads(server) > before, 40);
  await settle();
}

describe("the plugin market while a machine connects, fails or blinks", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("reads Installed, used by 1, while the machine is held, then used by 2 once it answers", async () => {
    const { server } = await serverWithCharts(true);
    const gpu = server.hold("gpu1");
    const usedBy = counts();
    await openPage();
    await waitFor(() => textOf(COUNT) === USED_BY_1, 40);
    for (let i = 0; i < 5; i++) await settle();
    expect(usedBy.texts().filter((value) => value.startsWith("Installed on"))).toEqual([USED_BY_1]);

    await run(() => gpu.release());
    await waitFor(() => textOf(COUNT) === USED_BY_2, 40);
    expect(usedBy.texts().filter((value) => value.startsWith("Installed on"))).toEqual([
      USED_BY_1,
      USED_BY_2,
    ]);
    expect(installsReads(server, null)).toBe(1);
  });

  it("keeps the count through a machine whose list fails, holds its row with the failure, and asks only it once back", async () => {
    const { server, machineInstalls } = await serverWithCharts(true);
    rememberMachineAgents(PROJECT_ID, "gpu1", [GPU_HELPER]);
    rememberAgentInstalls(PROJECT_ID, "gpu1", AGENT_ID, machineInstalls!);
    server.failNext("gpu1", new RegExp(`^/api/projects/${PROJECT_ID}/agents$`));
    const usedBy = counts();
    await openPage();
    await waitFor(() => listReads(server, "gpu1") >= 1 && textOf(COUNT) === USED_BY_2, 40);
    expect(usedBy.texts().filter((value) => value.startsWith("Installed on"))).toEqual([USED_BY_2]);

    await click(document.querySelector(COUNT)!);
    const selectAgent = (key: string) =>
      click(topDialog().querySelector<HTMLInputElement>(`input[value="${key}"]`)!);
    await selectAgent(`gpu1/${AGENT_ID}`);
    const machineRow = () => button(`${en.skills.uninstall} ${MACHINE_HELPER}`);
    expect(machineRow().disabled).toBe(true);
    expect(machineRow().getAttribute("data-tooltip")).toContain(
      en.machines.composer.failed("").trim(),
    );
    await selectAgent(AGENT_ID);
    expect(button(`${en.skills.uninstall} ${AGENT_ID}`).disabled).toBe(false);
    await selectAgent(`gpu1/${AGENT_ID}`);
    expect(topDialog().textContent).not.toContain(en.common.loading);

    const localReads = installsReads(server, null);
    const machineReads = listReads(server, "gpu1");
    await setReachable(server, false);
    await setReachable(server, true);
    await waitFor(() => listReads(server, "gpu1") > machineReads && !machineRow().disabled, 40);
    expect(installsReads(server, null)).toBe(localReads);
    expect(usedBy.texts().filter((value) => value.startsWith("Installed on"))).toEqual([USED_BY_2]);
  });

  it("changes no status text and asks this server nothing when the machine blinks", async () => {
    const { server } = await serverWithCharts(true);
    await openPage();
    await waitFor(() => textOf(COUNT) === USED_BY_2, 40);
    const usedBy = counts();
    const localReads = installsReads(server, null);

    await setReachable(server, false);
    expect(offlineNotice()).toBe(true);
    await setReachable(server, true);
    await waitFor(() => !offlineNotice(), 40);
    expect(usedBy.texts().filter((value) => value.startsWith("Installed on"))).toEqual([USED_BY_2]);
    expect(installsReads(server, null)).toBe(localReads);
  });

  it("opens again on the statuses it showed, and a re-read answering the same changes nothing", async () => {
    // Only the clock is faked: a return more than two seconds later reads every Agent again.
    vi.useFakeTimers({ toFake: ["Date"] });
    const { server } = await serverWithCharts(true);
    const router = await openPage();
    await waitFor(() => textOf(COUNT) === USED_BY_2, 40);
    await run(() => router.navigate("/chat"));
    expect(textOf(COUNT)).toBeNull();

    vi.setSystemTime(Date.now() + 3_000);
    const localReads = installsReads(server, null);
    const usedBy = counts();
    await run(() => router.navigate("/plugins"));
    expect(textOf(COUNT)).toBe(USED_BY_2);
    await waitFor(() => installsReads(server, null) === localReads + 1, 40);
    for (let i = 0; i < 5; i++) await settle();
    expect(usedBy.texts().filter((value) => value.startsWith("Installed on"))).toEqual([USED_BY_2]);
  });

  it("forgets what it remembered of a machine that leaves the Project's list", async () => {
    await serverWithCharts(true);
    await openPage();
    await waitFor(() => textOf(COUNT) === USED_BY_2, 40);
    expect(cachedAgentInstalls(PROJECT_ID, "gpu1", AGENT_ID)).not.toBeNull();

    // The machine is removed: the server's machine list stops naming it.
    const serverFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const res = await serverFetch(input, init);
      const path = new URL(String(input), "http://localhost").pathname;
      if (path !== `/api/projects/${PROJECT_ID}/machines`) return res;
      const body = (await res.json()) as { machines: Array<{ machineId: string | null }> };
      return json({ ...body, machines: body.machines.filter((m) => m.machineId !== "gpu1") });
    });
    await run(() => publishMachinesChanged());
    await waitFor(() => textOf(COUNT) === USED_BY_1, 40);
    expect(cachedAgentInstalls(PROJECT_ID, "gpu1", AGENT_ID)).toBeNull();
    expect(cachedAgentInstalls(PROJECT_ID, null, AGENT_ID)).not.toBeNull();
  });

  it("keeps the machine picker in its place while the machine drops out of reach and comes back", async () => {
    const { server } = await serverWithCharts(false);
    const picker = watchText(PICKER);
    await openPage();
    await waitFor(() => hasButton(en.plugins.viewMachine) && textOf(COUNT) !== null, 40);
    const controls = headerControls();
    expect(controls).toEqual([
      en.plugins.viewMachine,
      en.plugins.importPlugin,
      en.plugins.openSettings,
    ]);

    await setReachable(server, false);
    expect(headerControls()).toEqual(controls);
    await click(button(en.plugins.viewMachine));
    expect(pickerEntries()).toEqual([
      en.plugins.allMachines,
      en.plugins.thisServer,
      en.plugins.machineOutOfReach("gpu-box"),
    ]);
    await click(button(en.plugins.viewMachine));

    await setReachable(server, true);
    await click(button(en.plugins.viewMachine));
    expect(pickerEntries()).toEqual([en.plugins.allMachines, en.plugins.thisServer, "gpu-box"]);
    await click(button(en.plugins.viewMachine));
    expect(headerControls()).toEqual(controls);
    expect(picker.texts()).toEqual([en.plugins.allMachines]);
  });
});
