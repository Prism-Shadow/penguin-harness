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
import type { ServerEvent, SessionInfo, SessionsResponse } from "@prismshadow/penguin-server/api";
import { ApiError } from "../src/api/client";

type Answer = SessionsResponse | Error;
/** What each (machine, agent) answers; a missing entry throws like an unreachable server. */
const answers = new Map<string, Answer>();
/** Which servers were asked, and for which Workspace group — what the fan-out tests read. */
const asked: { machineId: string | null; workspaceGroup?: string }[] = [];
const key = (machineId: string | null, agentId: string) => `${machineId ?? ""}|${agentId}`;

vi.mock("../src/api/endpoints", () => ({
  listSessions: async (
    _projectId: string,
    agentId: string,
    opts: { workspaceGroup?: string } | undefined,
    machineId?: string | null,
  ) => {
    asked.push({
      machineId: machineId ?? null,
      ...(opts?.workspaceGroup === undefined ? {} : { workspaceGroup: opts.workspaceGroup }),
    });
    const answer = answers.get(key(machineId ?? null, agentId));
    if (answer === undefined) throw new ApiError(0, "network_error", "no answer");
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));

import { applyUserEvent, createSessionsStore } from "../src/state/sessions";
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

const page = (
  sessions: SessionInfo[],
  active: number,
  workspaceCounts?: Record<string, { active: number }>,
): SessionsResponse =>
  ({
    sessions,
    counts: { active, subagent: 0, schedule: 0, archived: 0 },
    ...(workspaceCounts === undefined ? {} : { workspaceCounts }),
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
    asked.length = 0;
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

  it("asks a machine about ITS Agents too — an Agent that exists only there", async () => {
    // A new chat started from a machine's Agent card belongs to an Agent this server has
    // never heard of. Asked only about this Project's Agents, the machine answers nothing
    // about it: the row was listed once (add) and vanished on the next reload, taking with
    // it the record of which machine holds it — after which a deep link asks THIS server,
    // gets a 404, and the conversation cannot be reached at all.
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), new ApiError(404, "not_found", "no such agent"));
    answers.set(
      key("M1", "theirs"),
      page([row("over-there", "2026-01-03T00:00:00Z", "theirs")], 1),
    );
    const store = boot(["M1"]);
    store.setState({ agentIdsByMachine: { M1: ["theirs"] } });
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["over-there", "here"]);
    expect(machineForSession("over-there")).toBe("M1");
    // And this server is never asked about an Agent that is not its own.
    expect(asked.filter((a) => a.machineId === null)).toHaveLength(1);
  });

  it("one Agent this server cannot answer about keeps its rows; the rest still refresh", async () => {
    answers.set(key(null, "a1"), page([row("a1-row", "2026-01-02T00:00:00Z")], 1));
    answers.set(key(null, "a2"), page([row("a2-row", "2026-01-01T00:00:00Z", "a2")], 1));
    const store = createSessionsStore();
    store.setState({
      projectId: "p",
      agentIds: ["a1", "a2"],
      machineIds: [],
      offlineMachineIds: [],
    });
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["a1-row", "a2-row"]);

    // a2's index is damaged and its list 500s, while a1 answers as before. Erasing a2 would
    // read, on screen, as an Agent with no conversations; abandoning the whole reload would
    // leave the page on a skeleton nothing clears.
    answers.set(key(null, "a2"), new ApiError(500, "internal", "broken index"));
    answers.set(
      key(null, "a1"),
      page([row("a1-row", "2026-01-02T00:00:00Z"), row("a1-new", "2026-01-04T00:00:00Z")], 2),
    );
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual([
      "a1-new",
      "a1-row",
      "a2-row",
    ]);
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(2);
    // Kept as last read: a total without this server's share would contradict the row below it.
    expect(store.getState().countsByAgent.get("a2")?.active).toBe(1);
    expect(store.getState().loading).toBe(false);
  });

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

  it("keeps two machines' counts for one path apart — a badge is about a directory, not a string", async () => {
    // `/w` on this server and `/w` on M1 are two different directories, and each folder's
    // badge has to match the rows under it. Summed onto one key, both folders claimed 7.
    answers.set(
      key(null, "a1"),
      page([row("here", "2026-01-02T00:00:00Z")], 1, { "/w": { active: 2 } }),
    );
    answers.set(
      key("M1", "a1"),
      page([row("there", "2026-01-03T00:00:00Z")], 1, { "/w": { active: 5 } }),
    );
    const store = boot(["M1"]);
    await store.getState().reload();
    const byGroup = store.getState().workspaceCountsByAgent.get("a1");
    expect(byGroup?.["/w"]?.active).toBe(2);
    expect(byGroup?.[`M1\u0000/w`]?.active).toBe(5);
  });

  it("a group's page is asked only of the machine that group is on, by path", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), page([row("there", "2026-01-03T00:00:00Z")], 1));
    const store = boot(["M1"]);
    await store.getState().reload();

    asked.length = 0;
    await store.getState().loadMoreFor(["a1"], "active", `M1\u0000/w`);
    // `/w` exists on this server too: asking it would page another directory's rows into
    // this group, and leave the group's "load more" waiting on a machine it is not on. The
    // machine half never travels in the query — the request already goes to that machine.
    expect(asked).toEqual([{ machineId: "M1", workspaceGroup: "/w" }]);

    asked.length = 0;
    await store.getState().loadMoreFor(["a1"], "active", "/w");
    expect(asked).toEqual([{ machineId: null, workspaceGroup: "/w" }]);
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

/**
 * Which events from a machine concern this list (applyUserEvent in state/sessions.tsx).
 *
 * A machine's Projects carry THIS server's ids — installing one creates the same Project
 * over there, and every list call names it — so the id in the event is as meaningful from a
 * machine as from here.
 */
describe("events arriving from a machine", () => {
  const created = (projectId: string): ServerEvent =>
    ({ type: "session_created", projectId, agentId: "a1", sessionId: "s1" }) as ServerEvent;

  const countingStore = () => {
    const store = createSessionsStore();
    store.setState({ projectId: "p", agentIds: ["a1"] });
    let reloads = 0;
    store.setState({
      reload: async () => {
        reloads += 1;
      },
    });
    return { store, reloads: () => reloads };
  };

  it("reloads for this Project, wherever the Session was created", () => {
    const { store, reloads } = countingStore();
    applyUserEvent(store, created("p"), () => undefined, "M1");
    applyUserEvent(store, created("p"), () => undefined, null);
    expect(reloads()).toBe(2);
  });

  it("ignores another Project on a machine, as it does here", () => {
    // Unconditional for machines, every Session and every subagent started in any other
    // Project on any connected machine refetched this whole list, Agents x sources.
    const { store, reloads } = countingStore();
    applyUserEvent(store, created("other"), () => undefined, "M1");
    applyUserEvent(store, created("other"), () => undefined, null);
    expect(reloads()).toBe(0);
  });
});
