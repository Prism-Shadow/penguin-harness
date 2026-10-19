/**
 * One list of Agents across servers (lib/machine-agent-lists.ts `mixAgents`), as the Agents page
 * and the plugin market's Manage installs show it.
 *
 * - A machine's Agents fall where their creation puts them among this server's: no machine goes
 *   first.
 * - Agents created at the same moment go by id, then this server's first, then by machine name.
 * - An Agent whose creation time is unknown goes last.
 * - Asked for live machines only, a machine that cannot be asked contributes nothing.
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { mixAgents } from "../src/lib/machine-agent-lists";
import type { MachineAgents } from "../src/lib/machine-agent-lists";

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
