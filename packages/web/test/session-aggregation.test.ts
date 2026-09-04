/**
 * One list, several machines (state/sessions.tsx). Each server pages its own rows with its
 * own cursor; counts are summed; and the line the whole list rests on — a source that COULD
 * NOT answer is not a source that ANSWERED NOTHING: this server failing abandons the reload
 * and leaves the rows standing, a machine going quiet keeps its cached rows, and only a 404
 * (this server has not got that Agent) is an answer.
 *
 * Exercised against the store directly (node, no DOM), with the API module mocked and a
 * memory `localStorage` for the per-machine cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionsResponse } from "@prismshadow/penguin-server/api";
import { ApiError } from "../src/api/client";

type Answer = SessionsResponse | Error;
/** What each (machine, agent) answers; a missing entry throws like an unreachable server. */
const answers = new Map<string, Answer>();
const key = (machineId: string | null, agentId: string) => `${machineId ?? ""}|${agentId}`;

vi.mock("../src/api/endpoints", () => ({
  listSessions: async (
    _projectId: string,
    agentId: string,
    _opts: unknown,
    machineId?: string | null,
  ) => {
    const answer = answers.get(key(machineId ?? null, agentId));
    if (answer === undefined) throw new ApiError(0, "network_error", "no answer");
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));

import { createSessionsStore } from "../src/state/sessions";
import { machineForSession } from "../src/lib/session-machines";
import { cachedMachineSessions, rememberMachineSessions } from "../src/lib/machine-cache";

const row = (sessionId: string, createdAt: string, agentId = "a1"): SessionInfo =>
  ({
    sessionId,
    projectId: "p",
    agentId,
    workspace: "/w",
    createdAt,
    lastActiveAt: createdAt,
    status: "idle",
    hasTrace: false,
  }) as SessionInfo;

const page = (sessions: SessionInfo[], active: number): SessionsResponse =>
  ({
    sessions,
    counts: { active, subagent: 0, schedule: 0, archived: 0 },
  }) as SessionsResponse;

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

describe("the list across machines", () => {
  const originalStorage = (globalThis as { localStorage?: Storage }).localStorage;
  beforeEach(() => {
    answers.clear();
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
  });
  afterEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = originalStorage;
  });

  const boot = (machineIds: string[], offlineMachineIds: string[] = []) => {
    const store = createSessionsStore();
    store.setState({ projectId: "p", agentIds: ["a1"], machineIds, offlineMachineIds });
    return store;
  };

  it("merges every source newest-first, records where each row lives, and sums the counts", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), page([row("there", "2026-01-03T00:00:00Z")], 2));
    const store = boot(["M1"]);
    await store.getState().reload();
    const { sessions, countsByAgent, loading } = store.getState();
    expect(sessions.map((s) => s.sessionId)).toEqual(["there", "here"]);
    expect(machineForSession("there")).toBe("M1");
    expect(machineForSession("here")).toBeNull();
    expect(countsByAgent.get("a1")?.active).toBe(3);
    expect(loading).toBe(false);
    // What the machine answered is remembered for the next restart.
    expect(cachedMachineSessions("p", "M1").map((s) => s.sessionId)).toEqual(["there"]);
  });

  it("a server that has not got the Agent answered — 404 is an answer, and its cache is cleared", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), new ApiError(404, "not_found", "no such agent"));
    rememberMachineSessions("p", "M1", [row("stale", "2026-01-01T00:00:00Z")]);
    const store = boot(["M1"]);
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["here"]);
    expect(cachedMachineSessions("p", "M1")).toEqual([]);
  });

  it("a machine that could not answer keeps its cached rows on screen and its cache intact", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    // M1 is held but its server did not answer (no entry → network error); M2 has no connection.
    rememberMachineSessions("p", "M1", [row("m1-cached", "2026-01-01T00:00:00Z")]);
    rememberMachineSessions("p", "M2", [row("m2-cached", "2026-01-04T00:00:00Z")]);
    const store = boot(["M1"], ["M2"]);
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual([
      "m2-cached",
      "here",
      "m1-cached",
    ]);
    expect(machineForSession("m2-cached")).toBe("M2");
    expect(cachedMachineSessions("p", "M1").map((s) => s.sessionId)).toEqual(["m1-cached"]);
    // Counts come only from servers that answered: the cache makes no claim about now.
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(1);
  });

  it("this server not answering abandons the reload: the rows stand and loading is left alone", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    const store = boot([]);
    await store.getState().reload();
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().loading).toBe(false);

    answers.delete(key(null, "a1")); // mid-swap: nothing answers here
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["here"]);
    expect(store.getState().loading).toBe(false);
  });

  it("a refresh over rows already on screen does not raise loading", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    const store = boot([]);
    await store.getState().reload();
    let raised = false;
    const unsubscribe = store.subscribe((state) => {
      if (state.loading) raised = true;
    });
    await store.getState().reload();
    unsubscribe();
    expect(raised).toBe(false);
  });
});
