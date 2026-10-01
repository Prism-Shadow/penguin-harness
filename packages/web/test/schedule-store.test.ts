/**
 * The scheduled-tasks store (features/schedules/schedule-store.ts), which the session list's
 * marks and the dock's scheduled-tasks panel both read: one list per PROJECT (every Agent's
 * tasks in a single answer), so a row's mark never depends on which Agent is current. Driven
 * through the real `listProjectSchedules` against the fetch fake; each test uses its own
 * Project ids, so the module-level cache needs no reset.
 *
 * - Each Project keeps its own list, and a Project never answered reads as nothing.
 * - A Project asked for while another's read is out gets its own request, and each answer
 *   lands in its own Project's entry, whatever order they arrive in.
 * - One request per Project is shared while it is out; once settled, the next refresh asks again.
 * - A failure is confined to the Project that failed.
 * - A schedule event re-reads a Project only while a reader is mounted on it (readers are
 *   counted, so one surface unmounting does not silence the other), and never one nobody asked
 *   about.
 * - The session list marks the Sessions of every Agent out of one answer.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ProjectScheduleItem,
  ProjectSchedulesResponse,
} from "@prismshadow/penguin-server/api";
import { pendingScheduleSessions } from "../src/features/schedules/schedule-panel-state";
import {
  noteScheduleEvent,
  refreshSchedules,
  retainSchedules,
  scheduleError,
  scheduleItems,
} from "../src/features/schedules/schedule-store";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch, FetchRequest } from "./helpers/fetch";

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

/** A server answer held open until the test resolves it. */
function deferred(): {
  promise: Promise<Response>;
  resolve: (body: ProjectSchedulesResponse) => void;
} {
  let resolve!: (body: ProjectSchedulesResponse) => void;
  const promise = new Promise<Response>((res) => {
    resolve = (body) => res(json(body));
  });
  return { promise, resolve };
}

const projectOf = (request: FetchRequest) =>
  decodeURIComponent(/^\/api\/projects\/([^/]+)\/schedules$/.exec(request.path)?.[1] ?? "");

/** Answers queued for the next requests; with none queued, a Project's list is one task named after it. */
const answers: Array<Response | Promise<Response>> = [];
let fetch: FakeFetch;
/** The Projects asked about, in request order. */
const asked = () => fetch.requests.map(projectOf);

beforeEach(() => {
  answers.length = 0;
  fetch = stubFetch((request) => answers.shift() ?? json(response(projectOf(request))));
});

describe("refreshSchedules", () => {
  it("keeps a list per Project, so moving to another one never blanks the one already answered", async () => {
    await refreshSchedules("p1");
    await refreshSchedules("p1-other");

    expect(names("p1")).toEqual(["p1"]);
    expect(names("p1-other")).toEqual(["p1-other"]);
    // Null means "never answered" and nothing else — the one honest reason for a row to wear
    // no mark before the first read lands.
    expect(scheduleItems("p1-unseen")).toBeNull();
  });

  it("issues a request for the Project it was asked for, mid-flight, and lands each answer in its own entry", async () => {
    const first = deferred();
    const second = deferred();
    answers.push(first.promise, second.promise);

    const one = refreshSchedules("p2");
    const other = refreshSchedules("p2-other");

    // The switch happened while p2's read was still out: p2-other must have been fetched too,
    // rather than handed p2's promise and left forever unread.
    expect(asked()).toEqual(["p2", "p2-other"]);

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
    const pending = deferred();
    answers.push(pending.promise);

    const a = refreshSchedules("p3");
    const b = refreshSchedules("p3");
    expect(b).toBe(a);
    expect(asked()).toEqual(["p3"]);

    pending.resolve(response("nightly"));
    await a;

    answers.push(json(response("nightly", "weekly")));
    await refreshSchedules("p3");
    expect(asked()).toEqual(["p3", "p3"]);
    expect(names("p3")).toEqual(["nightly", "weekly"]);
  });

  it("confines a failure to the Project that failed", async () => {
    answers.push(json(response("nightly")), apiError(500, "internal"));
    await refreshSchedules("p4");
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
    await refreshSchedules("p5");
    // Loaded, but nothing on screen is reading it: the event costs nothing.
    noteScheduleEvent("p5");
    expect(asked()).toHaveLength(1);

    const release = retainSchedules("p5");
    noteScheduleEvent("p5");
    expect(asked()).toHaveLength(2);
    // Joins the request the event started rather than issuing a third.
    await refreshSchedules("p5");
    expect(asked()).toHaveLength(2);

    // Releasing the last reader keeps the list — that is exactly what the reader draws again on
    // return — and stops the events nothing would display.
    release();
    noteScheduleEvent("p5");
    expect(asked()).toHaveLength(2);
    expect(names("p5")).toEqual(["p5"]);
  });

  it("counts readers, so the panel unmounting does not silence the session list's refreshes", async () => {
    // Both surfaces on one Project, which is the only state there is now that they share a scope.
    // A flag rather than a count would let either release silence both.
    const sidebar = retainSchedules("p6");
    const panel = retainSchedules("p6");

    panel();
    noteScheduleEvent("p6");
    // Read before settling: the request goes out synchronously, so a count of 0 here is the
    // event having been dropped, not a request that has yet to be made.
    expect(asked()).toEqual(["p6"]);
    // Joins the request the event started rather than issuing one of its own.
    await refreshSchedules("p6");
    expect(asked()).toEqual(["p6"]);

    sidebar();
    noteScheduleEvent("p6");
    expect(asked()).toEqual(["p6"]);
  });

  it("ignores an event for a Project no reader has ever asked about", () => {
    noteScheduleEvent("p7");
    expect(fetch.requests).toEqual([]);
  });
});

describe("the session list's marks", () => {
  it("marks the Sessions of every Agent out of one answer", async () => {
    const due = "2026-09-11T00:00:00.000Z";
    answers.push(
      json({
        schedules: [
          task("nightly", { agentId: "writer", sessionId: "s1", nextFireAt: due }),
          task("hourly", { agentId: "reviewer", sessionId: "s2", nextFireAt: due }),
          // Agent-wide: it opens a new Session each run, so it marks no row.
          task("fresh", { agentId: "reviewer", nextFireAt: due }),
        ],
        invalidFiles: [],
      }),
    );

    await refreshSchedules("p8");

    // What the sidebar computes, from the list it actually reads: two Agents, two marked rows,
    // no current Agent anywhere in the question.
    expect([...pendingScheduleSessions(scheduleItems("p8") ?? [])]).toEqual(["s1", "s2"]);
  });
});
