/**
 * What a machine was last seen holding survives a restart (lib/machine-cache.ts).
 *
 * The forward does not survive one, so for the seconds it takes to raise again, a list built
 * only from what answers now is this server's Sessions alone — the remote half of someone's
 * work reads as lost rather than as pending. What is pinned here is that the remembered rows
 * come back per machine and per Project, that answering REPLACES them (so a Session deleted
 * over there cannot keep returning from the cache), and that a storage which refuses every
 * call degrades to having no cache instead of taking the page down with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, SessionInfo } from "@prismshadow/penguin-server/api";
import {
  CACHED_ROWS_PER_MACHINE,
  cachedMachineAgents,
  cachedMachineSessions,
  rememberMachineAgents,
  rememberMachineSessions,
} from "../src/lib/machine-cache";

const row = (sessionId: string) => ({ sessionId, title: sessionId }) as SessionInfo;
const agent = (agentId: string) => ({ agentId, name: agentId }) as AgentSummary;

/** vitest runs in Node here, with no DOM — the model-group-expansion.ts convention. */
function installMemoryStorage(overrides: Partial<Storage> = {}): Map<string, string> {
  const backing = new Map<string, string>();
  const store = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    ...overrides,
  };
  vi.stubGlobal("localStorage", store);
  return backing;
}

beforeEach(() => installMemoryStorage());
afterEach(() => vi.unstubAllGlobals());

describe("session cache", () => {
  it("gives a machine's rows back after a restart", () => {
    rememberMachineSessions("proj", "m1", [row("s1"), row("s2")]);
    expect(cachedMachineSessions("proj", "m1").map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("remembers nothing for a machine, or a Project, that was never seen", () => {
    rememberMachineSessions("proj", "m1", [row("s1")]);
    expect(cachedMachineSessions("proj", "m2")).toEqual([]);
    expect(cachedMachineSessions("other", "m1")).toEqual([]);
  });

  it("replaces rather than merges — a Session gone from the machine stops coming back", () => {
    rememberMachineSessions("proj", "m1", [row("s1"), row("s2")]);
    rememberMachineSessions("proj", "m1", [row("s2")]);
    expect(cachedMachineSessions("proj", "m1").map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("an answer of nothing clears the entry, rather than leaving the old rows standing", () => {
    rememberMachineSessions("proj", "m1", [row("s1")]);
    rememberMachineSessions("proj", "m1", []);
    expect(cachedMachineSessions("proj", "m1")).toEqual([]);
  });

  it("keeps one machine's rows out of another's", () => {
    rememberMachineSessions("proj", "m1", [row("s1")]);
    rememberMachineSessions("proj", "m2", [row("s2")]);
    rememberMachineSessions("proj", "m1", []);
    expect(cachedMachineSessions("proj", "m2").map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("caps what it keeps — the cache stands in for a first page, not for a history", () => {
    const many = Array.from({ length: CACHED_ROWS_PER_MACHINE + 50 }, (_, i) => row(`s${i}`));
    rememberMachineSessions("proj", "m1", many);
    expect(cachedMachineSessions("proj", "m1")).toHaveLength(CACHED_ROWS_PER_MACHINE);
  });

  it("drops rows that could not be rendered or routed", () => {
    // Written by an older version, or hand-edited. A row with no id is not a Session.
    localStorage.setItem(
      "penguin.machineSessions.proj:m1",
      JSON.stringify([{ sessionId: "s1" }, { title: "no id" }, null, 7]),
    );
    expect(cachedMachineSessions("proj", "m1").map((s) => s.sessionId)).toEqual(["s1"]);
  });

  it("reads nothing out of a value that is not a list", () => {
    localStorage.setItem("penguin.machineSessions.proj:m1", "{not json");
    expect(cachedMachineSessions("proj", "m1")).toEqual([]);
    localStorage.setItem("penguin.machineSessions.proj:m1", '"a string"');
    expect(cachedMachineSessions("proj", "m1")).toEqual([]);
  });

  it("gives a machine's Agents back after a restart", () => {
    // Without these the composer offers nothing for a workspace that lives over there, and a
    // draft with no Agent to run it cannot be started at all.
    rememberMachineAgents("proj", "m1", [agent("a1"), agent("a2")]);
    expect(cachedMachineAgents("proj", "m1").map((a) => a.agentId)).toEqual(["a1", "a2"]);
  });

  it("keeps Agents and Sessions apart, and both apart from another machine's", () => {
    rememberMachineSessions("proj", "m1", [row("s1")]);
    rememberMachineAgents("proj", "m1", [agent("a1")]);
    rememberMachineAgents("proj", "m2", [agent("a2")]);
    rememberMachineSessions("proj", "m1", []);
    expect(cachedMachineAgents("proj", "m1").map((a) => a.agentId)).toEqual(["a1"]);
    expect(cachedMachineAgents("proj", "m2").map((a) => a.agentId)).toEqual(["a2"]);
    expect(cachedMachineSessions("proj", "m1")).toEqual([]);
  });

  it("an Agent deleted on the machine stops being offered", () => {
    rememberMachineAgents("proj", "m1", [agent("a1"), agent("a2")]);
    rememberMachineAgents("proj", "m1", [agent("a1")]);
    expect(cachedMachineAgents("proj", "m1").map((a) => a.agentId)).toEqual(["a1"]);
  });

  it("drops an Agent with no id, which could be neither shown nor started", () => {
    localStorage.setItem(
      "penguin.machineAgents.proj:m1",
      JSON.stringify([{ agentId: "a1" }, { name: "no id" }, null]),
    );
    expect(cachedMachineAgents("proj", "m1").map((a) => a.agentId)).toEqual(["a1"]);
  });

  it("degrades to no cache when storage refuses, instead of throwing into the list", () => {
    installMemoryStorage({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => rememberMachineSessions("proj", "m1", [row("s1")])).not.toThrow();
    expect(() => rememberMachineSessions("proj", "m1", [])).not.toThrow();
    expect(() => rememberMachineAgents("proj", "m1", [agent("a1")])).not.toThrow();
    expect(cachedMachineSessions("proj", "m1")).toEqual([]);
    expect(cachedMachineAgents("proj", "m1")).toEqual([]);
  });
});
