/**
 * The scheduled-tasks store (src/features/schedules/schedule-store.ts), which two surfaces read:
 * the session list's alarm-clock marks and the dock's scheduled-tasks panel. What is asserted
 * here is that the one list they share is the PROJECT's — every Agent's tasks in a single answer,
 * cached per Project — so a row's mark never depends on which Agent happens to be current. A
 * per-Agent list was what made the marks come and go as the user walked the list: the chat page
 * moves the current Agent to whatever conversation is open, and every other Agent's rows then had
 * no list to be marked from.
 *
 * No React and no DOM: the hook is a thin wrapper over these functions, and the caching is the
 * part that was wrong. Each test uses its own project ids, so the module-level cache needs no
 * reset between them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectScheduleItem,
  ProjectSchedulesResponse,
} from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({ listProjectSchedules: vi.fn() }));

import * as api from "../src/api/endpoints";
import { pendingScheduleSessions } from "../src/features/schedules/schedule-panel-state";
import {
  noteScheduleEvent,
  refreshSchedules,
  retainSchedules,
  scheduleError,
  scheduleItems,
} from "../src/features/schedules/schedule-store";

const listProjectSchedules = vi.mocked(api.listProjectSchedules);

/** A task as the Project-wide listing returns it: stamped with the agent whose directory holds it. */
function task(name: string, over: Partial<ProjectScheduleItem> = {}): ProjectScheduleItem {
  return {
    name,
    agentId: "writer",
    prompt: "Summarize yesterday",
    enabled: true,
    startAt: "2026-09-01T00:00:00.000Z",
    status: "active",
    queued: false,
    ...over,
  };
}

function response(...names: string[]): ProjectSchedulesResponse {
  return { schedules: names.map((name) => task(name)), invalidFiles: [] };
}

const names = (projectId: string) => scheduleItems(projectId)?.map((i) => i.name) ?? null;

/** A promise plus its resolve handle, so a request can be held open across assertions. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  listProjectSchedules.mockReset();
});

describe("refreshSchedules", () => {
  it("keeps a list per Project, so moving to another one never blanks the one already answered", async () => {
    listProjectSchedules.mockImplementation(async (projectId) => response(projectId));

    await refreshSchedules("p1");
    await refreshSchedules("p1-other");

    expect(names("p1")).toEqual(["p1"]);
    expect(names("p1-other")).toEqual(["p1-other"]);
    // Null means "never answered" and nothing else — the one honest reason for a row to wear
    // no mark before the first read lands.
    expect(scheduleItems("p1-unseen")).toBeNull();
  });

  it("issues a request for the Project it was asked for, mid-flight, and lands each answer in its own entry", async () => {
    const first = deferred<ProjectSchedulesResponse>();
    const second = deferred<ProjectSchedulesResponse>();
    listProjectSchedules.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const one = refreshSchedules("p2");
    const other = refreshSchedules("p2-other");

    // The switch happened while p2's read was still out: p2-other must have been fetched too,
    // rather than handed p2's promise and left forever unread.
    expect(listProjectSchedules.mock.calls.map((c) => c[0])).toEqual(["p2", "p2-other"]);

    second.resolve(response("nightly"));
    await other;
    expect(names("p2-other")).toEqual(["nightly"]);
    expect(scheduleItems("p2")).toBeNull();

    // The older request answers about its own Project, not about whoever asked last.
    first.resolve(response("hourly"));
    await one;
    expect(names("p2")).toEqual(["hourly"]);
    expect(names("p2-other")).toEqual(["nightly"]);
  });

  it("shares one request per Project while it is out, and refetches once it has settled", async () => {
    const pending = deferred<ProjectSchedulesResponse>();
    listProjectSchedules.mockReturnValueOnce(pending.promise);

    const a = refreshSchedules("p3");
    const b = refreshSchedules("p3");
    expect(b).toBe(a);
    expect(listProjectSchedules).toHaveBeenCalledTimes(1);

    pending.resolve(response("nightly"));
    await a;

    listProjectSchedules.mockResolvedValueOnce(response("nightly", "weekly"));
    await refreshSchedules("p3");
    expect(listProjectSchedules).toHaveBeenCalledTimes(2);
    expect(names("p3")).toEqual(["nightly", "weekly"]);
  });

  it("confines a failure to the Project that failed", async () => {
    listProjectSchedules.mockResolvedValueOnce(response("nightly"));
    await refreshSchedules("p4");
    listProjectSchedules.mockRejectedValueOnce(new Error("offline"));
    await refreshSchedules("p4-other");

    expect(scheduleError("p4-other")).not.toBeNull();
    expect(scheduleItems("p4-other")).toBeNull();
    // The healthy Project keeps both its list and its clean slate: one global error field used to
    // mean a failure anywhere put an error message under every reader.
    expect(scheduleError("p4")).toBeNull();
    expect(names("p4")).toEqual(["nightly"]);
  });
});

/**
 * The reader count is what decides whether a `schedule_fired` / `schedule_queued` event costs a
 * request: the store cannot tell "on screen" from "cached" by asking which Project it points at,
 * because it points at every one it has loaded. Refreshing a Project nothing is showing would
 * spend a request on an answer the next mount re-reads anyway, and skipping one a reader IS
 * showing would leave a fired task's row stale until the next poll — so both directions are
 * asserted here.
 */
describe("retainSchedules and noteScheduleEvent", () => {
  it("re-reads a Project a reader is mounted on, and leaves a cached one nobody shows alone", async () => {
    listProjectSchedules.mockImplementation(async (projectId) => response(projectId));

    await refreshSchedules("p5");
    // Loaded, but nothing on screen is reading it: the event costs nothing.
    noteScheduleEvent("p5");
    expect(listProjectSchedules).toHaveBeenCalledTimes(1);

    const release = retainSchedules("p5");
    noteScheduleEvent("p5");
    expect(listProjectSchedules).toHaveBeenCalledTimes(2);
    // Joins the request the event started rather than issuing a third.
    await refreshSchedules("p5");
    expect(listProjectSchedules).toHaveBeenCalledTimes(2);

    // Releasing the last reader keeps the list — that is exactly what the reader draws again on
    // return — and stops the events nothing would display.
    release();
    noteScheduleEvent("p5");
    expect(listProjectSchedules).toHaveBeenCalledTimes(2);
    expect(names("p5")).toEqual(["p5"]);
  });

  it("counts readers, so the panel unmounting does not silence the session list's refreshes", async () => {
    listProjectSchedules.mockImplementation(async (projectId) => response(projectId));
    // Both surfaces on one Project, which is the only state there is now that they share a scope.
    // A flag rather than a count would let either release silence both.
    const sidebar = retainSchedules("p6");
    const panel = retainSchedules("p6");

    panel();
    noteScheduleEvent("p6");
    // Read before settling: the request goes out synchronously, so a count of 0 here is the
    // event having been dropped, not a request that has yet to be made.
    expect(listProjectSchedules).toHaveBeenCalledTimes(1);
    // Joins the request the event started rather than issuing one of its own.
    await refreshSchedules("p6");
    expect(listProjectSchedules).toHaveBeenCalledTimes(1);

    sidebar();
    noteScheduleEvent("p6");
    expect(listProjectSchedules).toHaveBeenCalledTimes(1);
  });

  it("ignores an event for a Project no reader has ever asked about", () => {
    noteScheduleEvent("p7");
    expect(listProjectSchedules).not.toHaveBeenCalled();
  });
});

describe("the session list's marks", () => {
  it("marks the Sessions of every Agent out of one answer", async () => {
    const due = "2026-09-11T00:00:00.000Z";
    listProjectSchedules.mockResolvedValueOnce({
      schedules: [
        task("nightly", { agentId: "writer", sessionId: "s1", nextFireAt: due }),
        task("hourly", { agentId: "reviewer", sessionId: "s2", nextFireAt: due }),
        // Agent-wide: it opens a new Session each run, so it marks no row.
        task("fresh", { agentId: "reviewer", nextFireAt: due }),
      ],
      invalidFiles: [],
    });

    await refreshSchedules("p8");

    // What the sidebar computes, from the list it actually reads: two Agents, two marked rows,
    // no current Agent anywhere in the question.
    expect([...pendingScheduleSessions(scheduleItems("p8") ?? [])]).toEqual(["s1", "s2"]);
  });
});
