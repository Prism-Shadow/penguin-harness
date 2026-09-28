/**
 * A machine that answers none of a reload's questions rests, then is probed with one
 * (state/sessions.tsx `resting`).
 *
 * A reload asks each machine about every Agent at once; asked again on every reload, a
 * machine whose relay is down holds the Agent count's worth of calls per wave — the fan-out
 * behind 2026-09-28's ERR_INSUFFICIENT_RESOURCES. The store is exercised directly (node, no
 * DOM); the API module is mocked at the seam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionsResponse } from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({ listSessions: vi.fn() }));

import * as api from "../src/api/endpoints";
import { ApiError } from "../src/api/client";
import { MACHINE_REST_MIN_MS, createSessionsStore } from "../src/state/sessions";

const listSessions = vi.mocked(api.listSessions);
const COUNTS = { active: 0, subagent: 0, schedule: 0, benchmark: 0, archived: 0 };
const OK: SessionsResponse = { sessions: [], counts: COUNTS };
const AGENTS = ["a1", "a2", "a3"];

/** Whether m1 answers; this server always does. */
let m1Answers = false;
const askedOf = (machineId: string | null) =>
  listSessions.mock.calls.filter((c) => (c[3] ?? null) === machineId).length;

beforeEach(() => {
  vi.useFakeTimers();
  m1Answers = false;
  listSessions.mockReset();
  listSessions.mockImplementation(async (_p, _a, _o, machineId) => {
    if (machineId === "m1" && !m1Answers) throw new ApiError(0, "machine_no_answer", "no answer");
    return OK;
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function storeWithMachine() {
  const store = createSessionsStore();
  store.setState({ projectId: "p", agentIds: AGENTS, machineIds: ["m1"] });
  return store;
}

describe("a machine that answers nothing", () => {
  it("is left out of the next reload, while this server is still asked about every Agent", async () => {
    const store = storeWithMachine();
    await store.getState().reload();
    expect(askedOf("m1")).toBe(3);
    listSessions.mockClear();
    await store.getState().reload();
    expect(askedOf("m1")).toBe(0);
    expect(askedOf(null)).toBe(3);
  });

  it("is probed with ONE question when its rest is over, and rests twice as long when that fails", async () => {
    const store = storeWithMachine();
    await store.getState().reload();
    listSessions.mockClear();
    await vi.advanceTimersByTimeAsync(MACHINE_REST_MIN_MS); // the booked reload probes
    expect(askedOf("m1")).toBe(1);
    listSessions.mockClear();
    await vi.advanceTimersByTimeAsync(MACHINE_REST_MIN_MS); // still resting: 2 × the first rest
    await store.getState().reload();
    expect(askedOf("m1")).toBe(0);
    await vi.advanceTimersByTimeAsync(MACHINE_REST_MIN_MS);
    expect(askedOf("m1")).toBe(1);
  });

  it("is asked about every Agent again once the probe is answered", async () => {
    const store = storeWithMachine();
    await store.getState().reload();
    m1Answers = true;
    listSessions.mockClear();
    await vi.advanceTimersByTimeAsync(MACHINE_REST_MIN_MS); // probe answers → the full round
    expect(askedOf("m1")).toBe(1 + 3);
    listSessions.mockClear();
    await store.getState().reload();
    expect(askedOf("m1")).toBe(3);
  });

  it("a machine that answers about one Agent (404 on the rest) is not resting", async () => {
    listSessions.mockImplementation(async (_p, agentId, _o, machineId) => {
      if (machineId === "m1" && agentId !== "a1") throw new ApiError(404, "not_found", "no agent");
      return OK;
    });
    const store = storeWithMachine();
    await store.getState().reload();
    listSessions.mockClear();
    await store.getState().reload();
    expect(askedOf("m1")).toBe(3);
  });
});
