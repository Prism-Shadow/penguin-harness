/**
 * An unanswered read is asked again over HTTP only when HTTP can do better (api/client.ts
 * retriesOverHttp).
 *
 * The incident this pins (53531, 2026-09-28): the relay to one machine could not build its
 * API socket, the page's socket to this server stayed open (its last frame 3.5 s old), and
 * every sessions query about that machine's 22 Agents timed out after ANSWER_TIMEOUT_MS and
 * was repeated as a fetch — to the same hub route and the same held forward, which answered
 * the fetch no better. Two dozen held browser connections per reload wave, several waves:
 * `net::ERR_INSUFFICIENT_RESOURCES`, down to the avatars.
 *
 * The socket is replaced at the module seam (its own behaviour is api-socket.test.ts'); the
 * client and the sessions store run for real against it and a counted `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SocketModule from "../src/api/socket";

/**
 * What the scripted hub sees and does, shared with the hoisted mock factory: the calls it got,
 * how it answers one (or leaves it to time out), whether the socket carried frames while an
 * unanswered call waited, and the timeout error as this tree spells it — `SocketTimeoutError`
 * where it exists, the plain `socket_timeout` Error of the tree before it otherwise — so this
 * file measures both trees.
 */
const hub = vi.hoisted(() => ({
  calls: [] as { method: string; path: string; at: number }[],
  answer: (() => "silent") as (
    method: string,
    path: string,
  ) => { status: number; headers: Record<string, string>; body: unknown } | "silent",
  socketLive: true,
  timeoutError: (() => new Error("socket_timeout")) as (live: boolean) => Error,
}));

vi.mock("../src/api/socket", async (importActual) => {
  const actual = await importActual<typeof SocketModule>();
  const Real = (actual as { SocketTimeoutError?: new (live: boolean) => Error }).SocketTimeoutError;
  hub.timeoutError = (live) => (Real ? new Real(live) : new Error("socket_timeout"));
  return {
    ...actual,
    apiSocket: {
      ready: async () => true,
      identityIs: () => undefined,
      identityChanged: () => undefined,
      call: (method: string, path: string) => {
        hub.calls.push({ method, path, at: Date.now() });
        const a = hub.answer(method, path);
        if (a !== "silent") return Promise.resolve(a);
        return new Promise((_, reject) =>
          setTimeout(() => reject(hub.timeoutError(hub.socketLive)), actual.ANSWER_TIMEOUT_MS),
        );
      },
    },
  };
});

import { ApiError, apiFetch, apiRequest } from "../src/api/client";
import { createSessionsStore } from "../src/state/sessions";

/** Fetches issued, by URL; a fetch to a silent machine never settles (a held browser connection). */
let fetches: { url: string; at: number }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  hub.calls.length = 0;
  fetches = [];
  hub.socketLive = true;
  hub.answer = () => "silent";
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      fetches.push({ url, at: Date.now() });
      return new Promise<Response>(() => undefined);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MACHINE_PATH = "/api/projects/p/agents/a1/sessions";

describe("an unanswered read and HTTP", () => {
  it("is not repeated over HTTP for a machine while the socket is live", async () => {
    const res = apiFetch(MACHINE_PATH, { server: "m1" });
    const caught = res.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await caught;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "machine_no_answer" });
    expect(fetches).toEqual([]);
  });

  it("is repeated over HTTP for a machine when the socket itself went quiet", async () => {
    hub.socketLive = false;
    void apiFetch(MACHINE_PATH, { server: "m1" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetches.map((f) => f.url)).toEqual([`/server/m1${MACHINE_PATH}`]);
  });

  it("is repeated over HTTP for this server even on a live socket (the socket's own dispatch is the suspect)", async () => {
    void apiFetch(MACHINE_PATH);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetches.map((f) => f.url)).toEqual([MACHINE_PATH]);
  });

  it("a write is never repeated, machine or not", async () => {
    const res = apiFetch(MACHINE_PATH, { server: "m1", method: "POST", body: {} });
    const caught = res.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await caught).toMatchObject({ code: "network_error" });
    expect(fetches).toEqual([]);
  });

  it("apiRequest follows the same rule for a machine's read", async () => {
    const res = apiRequest(`/server/m1${MACHINE_PATH}`);
    const caught = res.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await caught).toBeInstanceOf(TypeError);
    expect(fetches).toEqual([]);
  });
});

/**
 * The incident's shape end to end: 22 Agents on a machine whose forward is stuck, this server
 * answering at once, and the page's own reloads — three as the Provider settles on load (no
 * machines yet, the machine list, the machine's Agent set), then one per user event. Counts
 * what reaches the browser's connection pool (fetches to the machine) and what reaches the
 * socket, over the first minute.
 */
describe("the sessions list against a machine whose forward is stuck", () => {
  const AGENTS = Array.from({ length: 22 }, (_, i) => `agent_${i}`);

  it("holds no browser connection on the machine and, once found silent, asks it one question at a time", async () => {
    const t0 = Date.now();
    hub.answer = (_method, path) =>
      path.startsWith("/server/m1/")
        ? "silent"
        : {
            status: 200,
            headers: {},
            body: {
              sessions: [],
              counts: { active: 0, subagent: 0, schedule: 0, benchmark: 0, archived: 0 },
            },
          };
    const store = createSessionsStore();
    // Page load: the Provider's three context steps, each a reload.
    store.setState({ projectId: "p", agentIds: AGENTS });
    void store.getState().reload();
    store.setState({ machineIds: ["m1"] });
    void store.getState().reload();
    store.setState({ agentIdsByMachine: { m1: AGENTS } });
    void store.getState().reload();
    // Then a user event every 5 s (session_state, title, …), each a reload.
    let reloads = 3;
    for (let t = 0; t < 60_000; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      void store.getState().reload();
      reloads += 1;
    }
    const toMachine = hub.calls.filter((c) => c.path.startsWith("/server/m1/"));
    const afterFirstTimeout = toMachine.filter((c) => c.at - t0 > 20_000).length;
    const machineFetches = fetches.filter((f) => f.url.startsWith("/server/m1/")).length;
    console.log(
      `[fanout-scenario] 60 s, ${AGENTS.length} Agents, ${reloads} reloads: ` +
        `socket calls to m1 = ${toMachine.length} (after the first 20 s timeout: ${afterFirstTimeout}), ` +
        `fetches to m1 = ${machineFetches} (none of them ever settles), fetches in total = ${fetches.length}`,
    );
    // No browser connection is ever held on the silent machine.
    expect(machineFetches).toBe(0);
    // Once the first round timed out, the machine is probed with one question per rest
    // (2 s, then 4 s after each failed probe's 20 s) instead of 22 per reload.
    expect(afterFirstTimeout).toBeLessThanOrEqual(2);
  });
});
