/**
 * The list actually writes the cache, and actually reads it back (state/sessions.tsx).
 *
 * machine-cache.test.ts pins the store; this pins the two ends that use it, which is where
 * a cache quietly fails to exist: rows are remembered under one machine and looked for under
 * another, or the write never happens because the answer arrived on a path that skips it.
 * The round trip is the only thing that proves the feature — a machine answers once, and
 * after a restart, with that machine out of reach, its Sessions are still on screen and still
 * addressed to it.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";

const listSessions = vi.fn();
vi.mock("../src/api/endpoints", () => ({
  listSessions: (...args: unknown[]) => listSessions(...args),
  getPrefs: () => Promise.resolve({ prefs: {} }),
  putPrefs: () => Promise.resolve({}),
  getMachines: () => Promise.resolve({ machines: [] }),
}));

const { createSessionsStore } = await import("../src/state/sessions");
const { machineForSession, forgetSessionMachines } = await import("../src/lib/session-machines");
const { cachedMachineSessions } = await import("../src/lib/machine-cache");

const REMOTE = "AtZ2EEKC5jxZipMN";
const PROJECT = "default_project";

function session(sessionId: string, createdAt: string): SessionInfo {
  return {
    sessionId,
    projectId: PROJECT,
    agentId: "default_agent",
    provider: "custom",
    modelId: "deepseek-v4-flash",
    workspace: "/w",
    approvalMode: "allow-all",
    createdAt,
    lastActiveAt: createdAt,
    status: "idle",
    hasTrace: true,
  } as SessionInfo;
}

/** vitest runs in Node here, with no DOM — the model-group-expansion.ts convention. */
function installMemoryStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  });
  return backing;
}

/** The store as the Provider leaves it: `reachable` answered, `offline` did not. */
function storeWith(reachable: string[], offline: string[]) {
  const store = createSessionsStore();
  store.setState({
    projectId: PROJECT,
    agentIds: ["default_agent"],
    machineIds: reachable,
    offlineMachineIds: offline,
  });
  return store;
}

const answers = (rows: SessionInfo[]) => ({
  sessions: rows,
  counts: { active: rows.length, archived: 0, subagent: 0, schedule: 0 },
});

/** This server has nothing; the machine answers `rows` when it is asked at all. */
function serverHasNothingMachineHas(rows: SessionInfo[]) {
  listSessions.mockImplementation(async (_p: string, _a: string, _o: unknown, source: unknown) =>
    source === REMOTE ? answers(rows) : answers([]),
  );
}

let backing: Map<string, string>;

beforeEach(() => {
  listSessions.mockReset();
  forgetSessionMachines();
  backing = installMemoryStorage();
});

afterEach(() => vi.unstubAllGlobals());

describe("the machine Session cache, end to end", () => {
  it("writes what a machine answered, under that machine and that Project", async () => {
    serverHasNothingMachineHas([session("remote-1", "2026-08-29T10:00:00.000Z")]);
    await storeWith([REMOTE], []).getState().reload();

    expect(cachedMachineSessions(PROJECT, REMOTE).map((s) => s.sessionId)).toEqual(["remote-1"]);
    // The key a later read looks under — pinned because a mismatch here is exactly the
    // failure that looks like "the cache does not exist".
    expect([...backing.keys()]).toEqual([`penguin.machineSessions.${PROJECT}:${REMOTE}`]);
  });

  it("shows those Sessions after a restart, with the machine still out of reach", async () => {
    serverHasNothingMachineHas([session("remote-1", "2026-08-29T10:00:00.000Z")]);
    await storeWith([REMOTE], []).getState().reload();

    // The restart: a new store, nothing in memory, and that machine answering nothing.
    forgetSessionMachines();
    const afterRestart = storeWith([], [REMOTE]);
    await afterRestart.getState().reload();

    expect(afterRestart.getState().sessions.map((s) => s.sessionId)).toEqual(["remote-1"]);
    // And addressed to the machine that holds it: a restored row asked of THIS server 404s.
    expect(machineForSession("remote-1")).toBe(REMOTE);
  });

  it("lets the machine's own answer replace what was remembered", async () => {
    serverHasNothingMachineHas([
      session("stays", "2026-08-29T10:00:00.000Z"),
      session("deleted-over-there", "2026-08-29T09:00:00.000Z"),
    ]);
    await storeWith([REMOTE], []).getState().reload();

    serverHasNothingMachineHas([session("stays", "2026-08-29T10:00:00.000Z")]);
    await storeWith([REMOTE], []).getState().reload();

    const afterRestart = storeWith([], [REMOTE]);
    await afterRestart.getState().reload();
    expect(afterRestart.getState().sessions.map((s) => s.sessionId)).toEqual(["stays"]);
  });

  it("keeps a live answer ahead of a remembered one for the same Session", async () => {
    // A machine can be listed as answering while a cached entry for it still exists; the row
    // on screen must be the one that was just fetched, not the copy from last time.
    serverHasNothingMachineHas([session("s1", "2026-08-29T10:00:00.000Z")]);
    await storeWith([REMOTE], []).getState().reload();

    const fresh = { ...session("s1", "2026-08-29T10:00:00.000Z"), title: "renamed" };
    serverHasNothingMachineHas([fresh as SessionInfo]);
    const store = storeWith([REMOTE], [REMOTE]);
    await store.getState().reload();

    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0]!.title).toBe("renamed");
  });

  it("remembers nothing for this server — its Sessions are never out of reach", async () => {
    listSessions.mockImplementation(async () =>
      answers([session("local-1", "2026-08-29T10:00:00.000Z")]),
    );
    await storeWith([], []).getState().reload();
    expect([...backing.keys()]).toEqual([]);
  });
});
