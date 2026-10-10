/**
 * What each machine was last seen holding (lib/machine-cache.ts), kept in localStorage so a
 * restart can show a machine's rows before it answers.
 *
 * - A machine's answer replaces only its own entry, per Project and machine.
 * - An empty answer clears the entry, so something deleted over there stops coming back.
 * - At most the placeholder's worth of rows is kept.
 * - Junk in storage reads as nothing remembered, and rows without an id are dropped.
 * - A storage that refuses is not an error: the answer is merely not remembered.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentSummary, SessionInfo } from "@prismshadow/penguin-server/api";
import {
  CACHED_ROWS_PER_MACHINE,
  cachedMachineAgents,
  cachedMachineSessions,
  rememberMachineAgents,
  rememberMachineSessions,
} from "../src/lib/machine-cache";
import { blockedStorage, stubLocalStorage } from "./helpers/storage";

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
  beforeEach(() => {
    stubLocalStorage();
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
    stubLocalStorage(blockedStorage());
    expect(() => rememberMachineAgents("p", "M1", [agent("a")])).not.toThrow();
    expect(cachedMachineAgents("p", "M1")).toEqual([]);
  });
});
