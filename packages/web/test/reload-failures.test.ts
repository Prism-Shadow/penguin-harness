/**
 * A reload that cannot read something does not report it as absent (state/sessions.tsx).
 *
 * reload() rebuilds the list WHOLESALE, so every failure inside it is a claim: whatever a
 * source did not return is taken to be gone. That is right for one answer only — an Agent is
 * per-server, so a server that has not got this Agent answers 404, and its empty result is
 * the truth. Every other failure (this server mid-swap, a forward up but not yet serving, the
 * network) is NOT an answer, and standing an empty result in for it is what emptied the
 * sidebar after a reconnect and kept it empty: the local fetch failed, the merged list came
 * out empty and replaced the rows; and each machine's cache was overwritten with the nothing
 * its own failed fetch produced, so the fallback had nothing left to fall back to.
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
const { ApiError } = await import("../src/api/client");
const { forgetSessionMachines } = await import("../src/lib/session-machines");
const { cachedMachineSessions, rememberMachineSessions } = await import("../src/lib/machine-cache");

const REMOTE = "AtZ2EEKC5jxZipMN";
const PROJECT = "default_project";

function session(sessionId: string): SessionInfo {
  return {
    sessionId,
    projectId: PROJECT,
    agentId: "default_agent",
    provider: "custom",
    modelId: "deepseek-v4-flash",
    workspace: "/w",
    approvalMode: "allow-all",
    createdAt: "2026-08-29T10:00:00.000Z",
    lastActiveAt: "2026-08-29T10:00:00.000Z",
    status: "idle",
    hasTrace: true,
  } as SessionInfo;
}

const answers = (rows: SessionInfo[]) => ({
  sessions: rows,
  counts: { active: rows.length, archived: 0, subagent: 0, schedule: 0 },
});

function installMemoryStorage(): void {
  const backing = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  });
}

function storeWith(machineIds: string[], offlineMachineIds: string[] = []) {
  const store = createSessionsStore();
  store.setState({
    projectId: PROJECT,
    agentIds: ["default_agent"],
    machineIds,
    offlineMachineIds,
  });
  return store;
}

beforeEach(() => {
  listSessions.mockReset();
  forgetSessionMachines();
  installMemoryStorage();
});

afterEach(() => vi.unstubAllGlobals());

describe("this server not answering", () => {
  it("abandons the reload rather than replacing the list with nothing", async () => {
    const store = storeWith([]);
    store.setState({ sessions: [session("on-screen")], loading: false });
    // A hot swap, or the moment after a reconnect.
    listSessions.mockRejectedValue(new ApiError(503, "unavailable", "restarting"));

    await store.getState().reload();

    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["on-screen"]);
    // And still not "loading": the rows on screen are as true as they were a moment ago.
    expect(store.getState().loading).toBe(false);
  });

  it("does not report a list it never read, when there was nothing on screen", async () => {
    const store = storeWith([]);
    listSessions.mockRejectedValue(new ApiError(503, "unavailable", "restarting"));

    await store.getState().reload();

    // Clearing this is what paints "no Sessions yet" over a list that is merely unreadable.
    expect(store.getState().loading).toBe(true);
  });

  it("still trusts a 404 — an Agent this server has not got is an answer", async () => {
    const store = storeWith([]);
    store.setState({ sessions: [session("stale")], loading: false });
    listSessions.mockRejectedValue(new ApiError(404, "agent_not_found", "no such Agent"));

    await store.getState().reload();

    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().loading).toBe(false);
  });
});

describe("a machine not answering", () => {
  it("keeps its cache instead of overwriting it with its own failure", async () => {
    rememberMachineSessions(PROJECT, REMOTE, [session("remembered")]);
    listSessions.mockImplementation(
      async (_p: string, _a: string, _o: unknown, source: unknown) => {
        if (source === REMOTE) throw new ApiError(503, "not_connected", "no live forward");
        return answers([]);
      },
    );

    // The machine passed the reachability probe, so it is named here — and then went quiet.
    await storeWith([REMOTE]).getState().reload();

    expect(cachedMachineSessions(PROJECT, REMOTE).map((s) => s.sessionId)).toEqual(["remembered"]);
  });

  it("shows what it last held, rather than dropping its rows", async () => {
    rememberMachineSessions(PROJECT, REMOTE, [session("remembered")]);
    listSessions.mockImplementation(
      async (_p: string, _a: string, _o: unknown, source: unknown) => {
        if (source === REMOTE) throw new ApiError(503, "not_connected", "no live forward");
        return answers([session("local")]);
      },
    );

    const store = storeWith([REMOTE]);
    await store.getState().reload();

    expect(
      store
        .getState()
        .sessions.map((s) => s.sessionId)
        .sort(),
    ).toEqual(["local", "remembered"]);
  });

  it("lets a machine that answered nothing clear its own cache", async () => {
    // The distinction the whole fix rests on: this machine ANSWERED, with nothing.
    rememberMachineSessions(PROJECT, REMOTE, [session("deleted-over-there")]);
    listSessions.mockImplementation(async () => answers([]));

    const store = storeWith([REMOTE]);
    await store.getState().reload();

    expect(cachedMachineSessions(PROJECT, REMOTE)).toEqual([]);
    expect(store.getState().sessions).toEqual([]);
  });

  it("treats an Agent the machine has not got as an answer, not as silence", async () => {
    rememberMachineSessions(PROJECT, REMOTE, [session("stale")]);
    listSessions.mockImplementation(
      async (_p: string, _a: string, _o: unknown, source: unknown) => {
        if (source === REMOTE) throw new ApiError(404, "agent_not_found", "no such Agent");
        return answers([session("local")]);
      },
    );

    const store = storeWith([REMOTE]);
    await store.getState().reload();

    expect(cachedMachineSessions(PROJECT, REMOTE)).toEqual([]);
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["local"]);
  });
});
