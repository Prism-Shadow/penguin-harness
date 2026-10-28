// @vitest-environment jsdom
/**
 * Each machine's Agents (lib/machine-agent-lists.ts), as the Agents page, the plugin market and
 * the session list read them.
 *
 * One list across servers (`mixAgents`), as the Agents page and Manage installs show it:
 * - A machine's Agents fall where their creation puts them among this server's: no machine goes
 *   first.
 * - Agents created at the same moment go by id, then this server's first, then by machine name.
 * - An Agent whose creation time is unknown goes last.
 * - Asked for live machines only, a machine that cannot be asked contributes nothing.
 *
 * Each machine's list (`useMachineAgents`, `readMachineAgents`), read once and shared:
 * - Given a page and the session list both reading a connected machine, the machine is asked once.
 * - Given a machine that stops answering, its last list stands, not live, with the machine's own
 *   failure as the reason.
 * - Given a machine that goes out of reach and comes back, it is live again at once — before its
 *   re-read answers — and is asked again once.
 * - Given a second machine connecting a minute later, it is asked; the first is not asked again.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  mixAgents,
  publishMachineAgentsChanged,
  useMachineAgents,
} from "../src/lib/machine-agent-lists";
import type { MachineAgents } from "../src/lib/machine-agent-lists";
import { publishMachinesChanged } from "../src/state/machines";
import { useProject } from "../src/state/project";
import { PROJECT_ID, agentServer, mountAgentApp } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { run, unmountAll, waitFor } from "./helpers/dom";

const agent = (agentId: string, createdAt?: string) =>
  ({ agentId, ...(createdAt === undefined ? {} : { createdAt }) }) as AgentSummary;

const machine = (label: string, agents: AgentSummary[], live = true): MachineAgents => ({
  machine: {
    machineId: `${label}-id`,
    label,
    link: live ? "connected" : "reconnecting",
    port: null,
  },
  agents,
  live,
  reason: live ? null : "reconnecting",
  lastKnown: !live,
});

/** What the list reads as: each Agent with the machine it is on. */
const read = (rows: ReturnType<typeof mixAgents>) =>
  rows.map((row) => `${row.agent.agentId}${row.on === null ? "" : `@${row.on.machine.label}`}`);

describe("mixAgents", () => {
  it("puts a machine's Agents where their creation falls among this server's", () => {
    const rows = mixAgents(
      [agent("old", "2026-01-01T00:00:00Z"), agent("new", "2026-10-03T00:00:00Z")],
      [machine("gpu", [agent("middle", "2026-05-01T00:00:00Z")])],
    );
    expect(read(rows)).toEqual(["old", "middle@gpu", "new"]);
  });

  it("orders a tie by id, then this server's first, then by machine name", () => {
    const at = "2026-10-01T00:00:00Z";
    const rows = mixAgents(
      [agent("b", at)],
      [machine("zeta", [agent("b", at), agent("a", at)]), machine("alpha", [agent("b", at)])],
    );
    expect(read(rows)).toEqual(["a@zeta", "b", "b@alpha", "b@zeta"]);
  });

  it("puts an Agent with no creation time last", () => {
    const rows = mixAgents(
      [agent("dated", "2026-10-01T00:00:00Z")],
      [machine("gpu", [agent("undated")])],
    );
    expect(read(rows)).toEqual(["dated", "undated@gpu"]);
  });

  it("leaves out a machine that cannot be asked when only live machines are wanted", () => {
    const lists = [machine("gpu", [agent("x", "2026-10-01T00:00:00Z")], false)];
    expect(read(mixAgents([], lists))).toEqual(["x@gpu"]);
    expect(read(mixAgents([], lists, { liveOnly: true }))).toEqual([]);
  });
});

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent", "helper"],
};
const LAB: FakeMachine = { machineId: "lab1", alias: "lab", agents: ["trainer"] };

/** A page's reading of every machine: one line per machine, its state and its Agents. */
function MachineListsProbe() {
  const projectId = useProject().currentProject?.projectId ?? null;
  const { lists } = useMachineAgents(projectId);
  return h(
    "ul",
    null,
    lists.map((list) =>
      h(
        "li",
        { key: list.machine.machineId, "data-machine": list.machine.label },
        `${list.live ? "live" : `not live (${list.reason ?? "awaited"})`}: ${list.agents
          .map((a) => a.agentId)
          .join(",")}`,
      ),
    ),
  );
}

/** What the probe shows for one machine; null while it lists none. */
const shown = (alias: string) =>
  document.querySelector(`[data-machine="${alias}"]`)?.textContent ?? null;

async function openProbe(machines: FakeMachine[]) {
  const server = agentServer(undefined, { machines });
  await mountAgentApp(h(MachineListsProbe), { route: "/probe", at: "/probe" });
  return server;
}

/** The machine's Agent-list reads made so far. */
const listReads = (server: ReturnType<typeof agentServer>, machineId: string) =>
  server.fetch.requests.filter(
    (r) =>
      r.machine === machineId &&
      r.method === "GET" &&
      r.path === `/api/projects/${PROJECT_ID}/agents`,
  ).length;

/** The machine's Agent-list reads answered so far. */
const answeredListReads = (server: ReturnType<typeof agentServer>, machineId: string) =>
  server
    .requests()
    .filter(
      (r) =>
        r.machine === machineId &&
        r.method === "GET" &&
        r.path === `/api/projects/${PROJECT_ID}/agents`,
    ).length;

/** Takes a machine out of reach, or brings it back, as the server's event tells the page. */
async function setReconnecting(
  server: ReturnType<typeof agentServer>,
  machineId: string,
  reconnecting: boolean,
) {
  server.setReconnecting(machineId, reconnecting);
  await run(() => publishMachinesChanged());
}

describe("each machine's Agent list", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("asks a connected machine once for a page and the session list together", async () => {
    const server = await openProbe([GPU]);
    await waitFor(() => shown("gpu-box") === "live: default_agent,helper");
    // The session list has asked too: it knows which of the machine's Agents to list Sessions of.
    await waitFor(() =>
      server.fetch.requests.some(
        (r) => r.machine === "gpu1" && r.path === `/api/projects/${PROJECT_ID}/sessions/batch`,
      ),
    );
    expect(listReads(server, "gpu1")).toBe(1);
  });

  it("keeps a machine's last list when it stops answering, not live, with its failure", async () => {
    const server = await openProbe([GPU]);
    await waitFor(() => shown("gpu-box") === "live: default_agent,helper");

    server.failNext("gpu1", /\/agents$/);
    await run(() => publishMachineAgentsChanged("gpu1"));
    await waitFor(() => shown("gpu-box")?.startsWith("not live") === true);
    expect(shown("gpu-box")).toMatch(/^not live \(.*gpu1 did not answer\): default_agent,helper$/);
    expect(listReads(server, "gpu1")).toBe(2);
  });

  it("is live again at once when a machine comes back, and asks it once more", async () => {
    const server = await openProbe([GPU]);
    await waitFor(() => shown("gpu-box") === "live: default_agent,helper");

    await setReconnecting(server, "gpu1", true);
    await waitFor(() => shown("gpu-box")?.startsWith("not live") === true);
    expect(shown("gpu-box")).toMatch(/^not live \(.+\): default_agent,helper$/);

    const slow = server.hold("gpu1");
    await setReconnecting(server, "gpu1", false);
    await waitFor(() => listReads(server, "gpu1") === 2);
    expect(shown("gpu-box")).toBe("live: default_agent,helper");
    slow.release();
    await waitFor(() => answeredListReads(server, "gpu1") === 2);
    expect(shown("gpu-box")).toBe("live: default_agent,helper");
    expect(listReads(server, "gpu1")).toBe(2);
  });

  it("asks a second machine when it connects, and not the first again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const server = await openProbe([GPU, { ...LAB, reconnecting: true }]);
    await waitFor(() => shown("gpu-box") === "live: default_agent,helper");

    // A minute on: nothing about the first machine is fresh by the clock alone.
    vi.setSystemTime(Date.now() + 60_000);
    await setReconnecting(server, "lab1", false);
    await waitFor(() => shown("lab") === "live: trainer");
    expect(listReads(server, "lab1")).toBe(1);
    expect(listReads(server, "gpu1")).toBe(1);
  });
});
