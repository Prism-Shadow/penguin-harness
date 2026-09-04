/**
 * What each machine was last seen holding (lib/machine-cache.ts): replaced wholesale by the
 * machine's own answer — including with nothing, which is how a deleted Session stops coming
 * back — kept per machine, and degrading to nothing when storage refuses or holds junk.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSummary, SessionInfo } from "@prismshadow/penguin-server/api";
import {
  CACHED_ROWS_PER_MACHINE,
  cachedMachineAgents,
  cachedMachineSessions,
  rememberMachineAgents,
  rememberMachineSessions,
} from "../src/lib/machine-cache";

/** The browser's storage, as far as this module needs it. Node has none. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

const row = (sessionId: string): SessionInfo =>
  ({
    sessionId,
    projectId: "p",
    agentId: "a",
    workspace: "/w",
    createdAt: "2026-01-01",
  }) as SessionInfo;
const agent = (agentId: string): AgentSummary => ({ agentId, name: agentId }) as AgentSummary;

describe("machine cache", () => {
  const original = (globalThis as { localStorage?: Storage }).localStorage;
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
  });
  afterEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = original;
  });

  it("remembers per (project, machine), and a machine's answer replaces only its own entry", () => {
    rememberMachineSessions("p", "M1", [row("a"), row("b")]);
    rememberMachineSessions("p", "M2", [row("c")]);
    rememberMachineSessions("p", "M1", [row("a")]);
    expect(cachedMachineSessions("p", "M1").map((s) => s.sessionId)).toEqual(["a"]);
    expect(cachedMachineSessions("p", "M2").map((s) => s.sessionId)).toEqual(["c"]);
    expect(cachedMachineSessions("other", "M1")).toEqual([]);
  });

  it("an empty answer clears the entry — something deleted over there stops coming back", () => {
    rememberMachineSessions("p", "M1", [row("a")]);
    rememberMachineSessions("p", "M1", []);
    expect(cachedMachineSessions("p", "M1")).toEqual([]);
  });

  it("keeps at most the placeholder's worth of rows", () => {
    rememberMachineSessions(
      "p",
      "M1",
      Array.from({ length: CACHED_ROWS_PER_MACHINE + 5 }, (_, i) => row(`s${i}`)),
    );
    expect(cachedMachineSessions("p", "M1")).toHaveLength(CACHED_ROWS_PER_MACHINE);
  });

  it("junk in storage reads as nothing remembered, and rows without an id are dropped", () => {
    localStorage.setItem("penguin.machineSessions.p:M1", "not json");
    expect(cachedMachineSessions("p", "M1")).toEqual([]);
    localStorage.setItem(
      "penguin.machineAgents.p:M1",
      JSON.stringify([{ name: "x" }, { agentId: "a" }]),
    );
    expect(cachedMachineAgents("p", "M1").map((a) => a.agentId)).toEqual(["a"]);
  });

  it("storage that refuses is not an error — the answer is merely not remembered", () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      getItem: () => {
        throw new Error("SecurityError");
      },
    } as Storage;
    expect(() => rememberMachineAgents("p", "M1", [agent("a")])).not.toThrow();
    expect(cachedMachineAgents("p", "M1")).toEqual([]);
  });
});
