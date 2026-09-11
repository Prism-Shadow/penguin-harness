/**
 * The scheduled-tasks store (src/features/schedules/schedule-store.ts), which is shared by two
 * readers whose scopes disagree while a navigation settles: the sidebar names the current Agent,
 * which flips the instant a session row is clicked, and the dock's panel names the open
 * conversation's. What is asserted here is that neither reader can take the other's answer away
 * — one entry and one request per scope — because a single shared slot is what made the session
 * rows' alarm-clock marks blink in and out on every switch.
 *
 * No React and no DOM: the hook is a thin wrapper over these functions, and the scope behaviour
 * is the part that was wrong. Each test uses its own project id, so the module-level cache needs
 * no reset between them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleItem, SchedulesResponse } from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({ listSchedules: vi.fn() }));

import * as api from "../src/api/endpoints";
import {
  refreshSchedules,
  scheduleError,
  scheduleItems,
} from "../src/features/schedules/schedule-store";

const listSchedules = vi.mocked(api.listSchedules);

function response(...names: string[]): SchedulesResponse {
  const schedules: ScheduleItem[] = names.map((name) => ({
    name,
    prompt: "Summarize yesterday",
    enabled: true,
    startAt: "2026-09-01T00:00:00.000Z",
    status: "active",
    queued: false,
  }));
  return { schedules, invalidFiles: [] };
}

const names = (projectId: string, agentId: string) =>
  scheduleItems(projectId, agentId)?.map((i) => i.name) ?? null;

/** A promise plus its resolve handle, so a request can be held open across assertions. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  listSchedules.mockReset();
});

describe("refreshSchedules", () => {
  it("keeps a list per agent, so moving to another scope never blanks the one already answered", async () => {
    listSchedules.mockImplementation(async (_projectId, agentId) => response(agentId));

    await refreshSchedules("p1", "a1");
    await refreshSchedules("p1", "a2");

    expect(names("p1", "a1")).toEqual(["a1"]);
    expect(names("p1", "a2")).toEqual(["a2"]);
    // Null means "never answered" and nothing else — the one honest reason for a row to wear
    // no mark before the first read lands.
    expect(scheduleItems("p1", "a3")).toBeNull();
  });

  it("issues a request for the scope it was asked for, mid-flight, and lands each answer in its own entry", async () => {
    const first = deferred<SchedulesResponse>();
    const second = deferred<SchedulesResponse>();
    listSchedules.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a1 = refreshSchedules("p2", "a1");
    const a2 = refreshSchedules("p2", "a2");

    // The switch happened while a1's read was still out: a2 must have been fetched too, rather
    // than handed a1's promise and left forever unread.
    expect(listSchedules.mock.calls.map((c) => c[1])).toEqual(["a1", "a2"]);

    second.resolve(response("nightly"));
    await a2;
    expect(names("p2", "a2")).toEqual(["nightly"]);
    expect(scheduleItems("p2", "a1")).toBeNull();

    // The older request answers about its own agent, not about whoever asked last.
    first.resolve(response("hourly"));
    await a1;
    expect(names("p2", "a1")).toEqual(["hourly"]);
    expect(names("p2", "a2")).toEqual(["nightly"]);
  });

  it("shares one request per scope while it is out, and refetches once it has settled", async () => {
    const pending = deferred<SchedulesResponse>();
    listSchedules.mockReturnValueOnce(pending.promise);

    const a = refreshSchedules("p3", "a1");
    const b = refreshSchedules("p3", "a1");
    expect(b).toBe(a);
    expect(listSchedules).toHaveBeenCalledTimes(1);

    pending.resolve(response("nightly"));
    await a;

    listSchedules.mockResolvedValueOnce(response("nightly", "weekly"));
    await refreshSchedules("p3", "a1");
    expect(listSchedules).toHaveBeenCalledTimes(2);
    expect(names("p3", "a1")).toEqual(["nightly", "weekly"]);
  });

  it("confines a failure to the scope that failed", async () => {
    listSchedules.mockResolvedValueOnce(response("nightly"));
    await refreshSchedules("p4", "a1");
    listSchedules.mockRejectedValueOnce(new Error("offline"));
    await refreshSchedules("p4", "a2");

    expect(scheduleError("p4", "a2")).not.toBeNull();
    expect(scheduleItems("p4", "a2")).toBeNull();
    // The healthy agent keeps both its list and its clean slate: one global error field used to
    // mean a failure anywhere put an error message under every reader.
    expect(scheduleError("p4", "a1")).toBeNull();
    expect(names("p4", "a1")).toEqual(["nightly"]);
  });
});
