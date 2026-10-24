/**
 * The archive page's state (features/settings/archived-sessions-state.ts), driven through the
 * real endpoint wrappers against the fetch fake, which answers as the four routes do.
 *
 * - Given archived Sessions in several groups, the groups load first, then each shown group's
 *   first ten rows; twenty groups show, and "more groups" loads the next ones' rows.
 * - Given a group of more than ten, "more" shows ten more — asking for the page below the last
 *   row held only when the reveal runs past what is held — and "less" folds back to ten.
 * - Given a new query or filter, the page starts over (no rows, no reveal, no choice), and the
 *   filters ride on every request.
 * - Given rows chosen across groups, unarchiving them takes them off the page at once, then
 *   reads the counts and every shown group again, keeping each group's reveal.
 * - Given Select all on a group, every Session of it is chosen, loaded or not, and the action
 *   names the group through a filter carrying the current query and the time its count was read
 *   at — the time of the Select all, even when the page has read itself again since.
 * - Given a row unticked after Select all, the rest stay chosen and the action leaves that row
 *   out; Deselect all shows once every Session of the group is chosen, picked one by one or not.
 * - Given a row's own button acting on a row of a group chosen whole, the selection counts that
 *   row out.
 * - Given an action the server refuses, the rows stay and the failure is reported.
 * - Given a burst of user-channel events about the archive, the page reads itself again once;
 *   an event about something else does nothing.
 * - Given a run starting or settling on a row the page holds, the row's run state changes where
 *   it stands, with nothing read again.
 * - Given a machine's groups beside this server's, each group's rows are read from the server it
 *   is on, and a machine that could not be read is named.
 * - Given rows on a machine, a row's own button, a selection spanning both servers and a whole
 *   group each act on the server the rows are on — the whole group pinned to the machine's own
 *   count time — and never on the other.
 * - Given a machine's own archive event or run state, relayed by this server, the page reads
 *   itself again or redraws the row, as for this server's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArchivedSessionGroup,
  ServerEvent,
  SessionInfo,
} from "@prismshadow/penguin-server/api";
import {
  ARCHIVE_GROUP_PAGE,
  ARCHIVE_REFRESH_DELAY_MS,
  createArchiveStore,
  groupKey,
  isChosen,
  selectedCount,
  shownGroups,
  shownRows,
  wholeGroupChosen,
  type ArchiveFilters,
} from "../src/features/settings/archived-sessions-state";

import { apiError, json, stubFetch, type FakeFetch, type FetchRequest } from "./helpers/fetch";

const ALL: ArchiveFilters = { q: "", source: null, projectId: null };

/** The server's archived rows. */
let rows: SessionInfo[];
/** Rows that live on a machine, by session id → machine id; the rest are this server's. */
let onMachine: Map<string, string>;
/** The machines the fake server could not read, by alias. */
let unreachable: string[];
/** The time the machine says it took its counts at. */
const MACHINE_AS_OF = "2026-10-11T09:59:30.000Z";
const MACHINE = "QS7J4YVgSovi-Z2c";
let fetch: FakeFetch;
/** An action the server refuses, when set. */
let refuse = false;
/** The time the fake server says it took the counts at (the groups' `asOf`). */
let asOf = "2026-10-11T10:00:00.000Z";

function row(sessionId: string, workspace: string, minute: number, title = sessionId): SessionInfo {
  const at = new Date(Date.UTC(2026, 9, 11, 9, minute)).toISOString();
  return {
    sessionId,
    projectId: "p",
    agentId: "a1",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace,
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    title,
    source: "cli",
    createdAt: at,
    lastActiveAt: at,
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: true,
  };
}

/** The routes' activity order: last activity first, ties by id, both by code point. */
const newestFirst = (
  a: Pick<SessionInfo, "lastActiveAt" | "sessionId">,
  b: Pick<SessionInfo, "lastActiveAt" | "sessionId">,
) =>
  a.lastActiveAt !== b.lastActiveAt
    ? a.lastActiveAt > b.lastActiveAt
      ? -1
      : 1
    : a.sessionId > b.sessionId
      ? -1
      : a.sessionId < b.sessionId
        ? 1
        : 0;

/** The rows a query (or a batch's filter) matches on one server (`machine` null: this one), newest first. */
function matching(
  params: { get(name: string): string | null },
  machine: string | null = null,
): SessionInfo[] {
  const q = (params.get("q") ?? "").toLowerCase();
  const workspace = params.get("workspace");
  return rows
    .filter((s) => (onMachine.get(s.sessionId) ?? null) === machine)
    .filter((s) => q === "" || (s.title ?? "").toLowerCase().includes(q))
    .filter((s) => workspace === null || s.workspace === workspace)
    .sort(newestFirst);
}

function serve(request: FetchRequest): Response {
  if (request.path === "/api/me/archived-sessions/groups") {
    const groups = new Map<string, ArchivedSessionGroup>();
    for (const machine of [null, MACHINE]) {
      for (const s of matching(request.query, machine)) {
        const key = `${machine}:${s.workspace}`;
        const g = groups.get(key);
        if (g) g.count += 1;
        else {
          groups.set(key, {
            projectId: "p",
            projectName: "Project",
            workspace: s.workspace,
            count: 1,
            latest: s.lastActiveAt,
            ...(machine === null
              ? {}
              : { machineId: machine, machineAlias: "box", asOf: MACHINE_AS_OF }),
          });
        }
      }
    }
    const list = [...groups.values()];
    return json({
      groups: list,
      total: list.reduce((n, g) => n + g.count, 0),
      asOf,
      ...(unreachable.length > 0
        ? { unreachable: unreachable.map((alias) => ({ machineId: `id-${alias}`, alias })) }
        : {}),
    });
  }
  if (request.path === "/api/me/archived-sessions") {
    const before = request.query.get("before");
    let list = matching(request.query, request.query.get("machineId"));
    if (before !== null) {
      const comma = before.indexOf(",");
      const cursor = { lastActiveAt: before.slice(0, comma), sessionId: before.slice(comma + 1) };
      list = list.filter((s) => newestFirst(s, cursor) > 0);
    }
    const limit = Number(request.query.get("limit"));
    return json({ sessions: list.slice(0, limit), hasMore: list.length > limit });
  }
  if (request.path.startsWith("/api/me/archived-sessions/")) {
    if (refuse) return apiError(500, "internal");
    const body = request.body as {
      sessionIds?: string[];
      filter?: Record<string, unknown>;
      machineId?: string;
    };
    const machine = body.machineId ?? null;
    // The filter's query part matches as the listing does; its rows left out stay.
    const exclude = (body.filter?.exclude as string[] | undefined) ?? [];
    const query = new URLSearchParams();
    for (const name of ["q", "source", "projectId", "workspace"]) {
      const value = body.filter?.[name];
      if (typeof value === "string") query.set(name, value);
    }
    // A batch acts on the server it names, and on nothing of another's.
    const ids = (
      body.sessionIds ??
      matching(query, machine)
        .map((s) => s.sessionId)
        .filter((id) => !exclude.includes(id))
    ).filter((id) => (onMachine.get(id) ?? null) === machine);
    rows = rows.filter((s) => !ids.includes(s.sessionId));
    return json({ done: ids.length, missing: [] });
  }
  return apiError(404, "not_found");
}

beforeEach(() => {
  rows = [];
  onMachine = new Map();
  unreachable = [];
  refuse = false;
  asOf = "2026-10-11T10:00:00.000Z";
  fetch = stubFetch(serve);
});
afterEach(() => vi.useRealTimers());

/** `n` rows in `workspace`, newest first by their index. */
const run = (prefix: string, workspace: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) =>
    row(`${prefix}-${String(i).padStart(2, "0")}`, workspace, from + n - i),
  );

const shownIds = (
  store: ReturnType<typeof createArchiveStore>,
  workspace: string,
  machineId?: string,
) =>
  shownRows(
    store
      .getState()
      .rows.get(groupKey({ projectId: "p", workspace, ...(machineId ? { machineId } : {}) })),
  ).map((s) => s.sessionId);

/** `n` rows in `workspace` on the machine, newest first by their index. */
const machineRun = (prefix: string, workspace: string, n: number, from = 0) =>
  run(prefix, workspace, n, from).map((s) => {
    onMachine.set(s.sessionId, MACHINE);
    return s;
  });

const paths = () => fetch.requests.map((r) => r.path);

describe("the archive page", () => {
  it("reads the groups first, then each shown group's first ten rows", async () => {
    rows = [...run("a", "/a", 12, 100), ...run("b", "/b", 3)];
    const store = createArchiveStore();
    await store.getState().load(ALL);
    expect(paths()[0]).toBe("/api/me/archived-sessions/groups");
    expect(paths().slice(1).sort()).toEqual([
      "/api/me/archived-sessions",
      "/api/me/archived-sessions",
    ]);
    expect(shownGroups(store.getState()).map((g) => g.workspace)).toEqual(["/a", "/b"]);
    expect(shownIds(store, "/a")).toEqual(rows.slice(0, 10).map((s) => s.sessionId));
    expect(shownIds(store, "/b")).toHaveLength(3);
  });

  it("shows ten more on more, asking only past what it holds, and folds back on less", async () => {
    rows = run("a", "/a", 25);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const key = groupKey({ projectId: "p", workspace: "/a" });
    fetch.requests.length = 0;
    await store.getState().showMoreRows(key);
    // The next page continues below the tenth row held.
    expect(fetch.requests).toHaveLength(1);
    const tenth = rows[9]!;
    expect(fetch.requests[0]!.query.get("before")).toBe(`${tenth.lastActiveAt},${tenth.sessionId}`);
    expect(shownIds(store, "/a")).toEqual(rows.slice(0, 20).map((s) => s.sessionId));
    store.getState().showLessRows(key);
    expect(shownIds(store, "/a")).toHaveLength(10);
    // Revealing again spends no request: those rows are held.
    fetch.requests.length = 0;
    await store.getState().showMoreRows(key);
    expect(fetch.requests).toEqual([]);
    expect(shownIds(store, "/a")).toHaveLength(20);
  });

  it("shows twenty groups, and loads the next ones' rows when more groups are shown", async () => {
    rows = Array.from({ length: ARCHIVE_GROUP_PAGE + 3 }, (_, i) =>
      row(`s-${i}`, `/w${String(i).padStart(2, "0")}`, i),
    );
    const store = createArchiveStore();
    await store.getState().load(ALL);
    expect(shownGroups(store.getState())).toHaveLength(ARCHIVE_GROUP_PAGE);
    expect(store.getState().rows.size).toBe(ARCHIVE_GROUP_PAGE);
    await store.getState().showMoreGroups();
    expect(shownGroups(store.getState())).toHaveLength(ARCHIVE_GROUP_PAGE + 3);
    expect(store.getState().rows.size).toBe(ARCHIVE_GROUP_PAGE + 3);
  });

  it("starts over on a new query, carrying the filters on every request", async () => {
    rows = [...run("a", "/a", 12, 100), row("deploy-docs", "/b", 1, "Deploy the docs")];
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const key = groupKey({ projectId: "p", workspace: "/a" });
    await store.getState().showMoreRows(key);
    store.getState().toggle(key, "a-00");
    fetch.requests.length = 0;
    await store.getState().load({ q: "deploy", source: "cli", projectId: "p" });
    expect(selectedCount(store.getState())).toBe(0);
    expect(shownGroups(store.getState()).map((g) => g.workspace)).toEqual(["/b"]);
    expect(shownIds(store, "/b")).toEqual(["deploy-docs"]);
    for (const request of fetch.requests) {
      expect(request.query.get("q")).toBe("deploy");
      expect(request.query.get("source")).toBe("cli");
      expect(request.query.get("projectId")).toBe("p");
    }
  });

  it("takes unarchived rows off at once, then reads the counts and the groups again, keeping each reveal", async () => {
    rows = [...run("a", "/a", 25, 100), ...run("b", "/b", 2)];
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const a = groupKey({ projectId: "p", workspace: "/a" });
    await store.getState().showMoreRows(a);
    store.getState().toggle(a, "a-00");
    store.getState().toggle(groupKey({ projectId: "p", workspace: "/b" }), "b-01");
    fetch.requests.length = 0;
    const ok = await store.getState().unarchive({ kind: "selection" });
    expect(ok).toBe(true);
    expect(fetch.requests[0]!.body).toEqual({ sessionIds: ["a-00", "b-01"] });
    expect(selectedCount(store.getState())).toBe(0);
    // Read again: the counts, then each group as far as it was revealed.
    expect(store.getState().groups?.map((g) => [g.workspace, g.count])).toEqual([
      ["/a", 24],
      ["/b", 1],
    ]);
    expect(shownIds(store, "/a")).toEqual(
      rows
        .filter((s) => s.workspace === "/a")
        .slice(0, 20)
        .map((s) => s.sessionId),
    );
    expect(shownIds(store, "/b")).toEqual(["b-00"]);
  });

  it("chooses every Session of a group with Select all, loaded or not, and acts on it through a filter", async () => {
    rows = [...run("a", "/a", 13, 100), ...run("b", "/b", 2)];
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const a = groupKey({ projectId: "p", workspace: "/a" });
    const group = () => store.getState().groups!.find((g) => groupKey(g) === a)!;
    store.getState().toggleGroup(a);
    // Thirteen chosen, three of them not loaded yet; every row on screen is ticked.
    expect(selectedCount(store.getState())).toBe(13);
    expect(shownIds(store, "/a").every((id) => isChosen(store.getState(), a, id))).toBe(true);
    expect(wholeGroupChosen(store.getState(), group())).toBe(true);
    fetch.requests.length = 0;
    await store.getState().remove({ kind: "selection" });
    expect(fetch.requests[0]!.path).toBe("/api/me/archived-sessions/delete");
    expect(fetch.requests[0]!.body).toEqual({
      filter: { projectId: "p", workspace: "/a", until: asOf },
    });
    expect(rows.map((s) => s.sessionId)).toEqual(["b-00", "b-01"]);
    expect(selectedCount(store.getState())).toBe(0);
  });

  it("carries the current query when a group is chosen whole", async () => {
    rows = [...run("a", "/a", 3, 100), row("a-x", "/a", 1, "Deploy"), ...run("b", "/b", 2)];
    const store = createArchiveStore();
    await store.getState().load({ ...ALL, q: "deploy" });
    store.getState().toggleGroup(groupKey({ projectId: "p", workspace: "/a" }));
    fetch.requests.length = 0;
    await store.getState().remove({ kind: "selection" });
    expect(fetch.requests[0]!.body).toEqual({
      filter: { q: "deploy", projectId: "p", workspace: "/a", until: asOf },
    });
    // Only what the query matched went; the rest of the group is still archived.
    expect(rows.map((s) => s.sessionId).sort()).toEqual(["a-00", "a-01", "a-02", "b-00", "b-01"]);
  });

  it("keeps the rest chosen when a row is unticked after Select all, and leaves that row out", async () => {
    rows = run("a", "/a", 13);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const a = groupKey({ projectId: "p", workspace: "/a" });
    const group = () => store.getState().groups!.find((g) => groupKey(g) === a)!;
    store.getState().toggleGroup(a);
    store.getState().toggle(a, "a-03");
    expect(isChosen(store.getState(), a, "a-03")).toBe(false);
    expect(isChosen(store.getState(), a, "a-04")).toBe(true);
    expect(selectedCount(store.getState())).toBe(12);
    // Not everything is chosen any more: the button offers Select all again.
    expect(wholeGroupChosen(store.getState(), group())).toBe(false);
    fetch.requests.length = 0;
    await store.getState().unarchive({ kind: "selection" });
    expect(fetch.requests[0]!.body).toEqual({
      filter: { projectId: "p", workspace: "/a", until: asOf, exclude: ["a-03"] },
    });
    expect(rows.map((s) => s.sessionId)).toEqual(["a-03"]);
  });

  it("counts a row out of a group chosen whole once the row's own button acts on it", async () => {
    rows = run("a", "/a", 13);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const a = groupKey({ projectId: "p", workspace: "/a" });
    const group = () => store.getState().groups!.find((g) => groupKey(g) === a)!;
    store.getState().toggleGroup(a);
    store.getState().toggle(a, "a-03");
    // A chosen row's own Unarchive: one fewer chosen.
    await store.getState().unarchive({ kind: "ids", ids: ["a-01"] });
    expect(selectedCount(store.getState())).toBe(11);
    // The unticked row's own delete: as many chosen, and nothing of the group left unticked.
    await store.getState().remove({ kind: "ids", ids: ["a-03"] });
    expect(selectedCount(store.getState())).toBe(11);
    expect(wholeGroupChosen(store.getState(), group())).toBe(true);
    fetch.requests.length = 0;
    await store.getState().remove({ kind: "selection" });
    expect(fetch.requests[0]!.body).toEqual({
      filter: { projectId: "p", workspace: "/a", until: asOf },
    });
    expect(rows).toEqual([]);
  });

  it("offers Deselect all once every Session of a group is chosen, picked one by one or whole", async () => {
    rows = run("a", "/a", 3);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const a = groupKey({ projectId: "p", workspace: "/a" });
    const group = () => store.getState().groups!.find((g) => groupKey(g) === a)!;
    for (const id of ["a-00", "a-01"]) store.getState().toggle(a, id);
    expect(wholeGroupChosen(store.getState(), group())).toBe(false);
    store.getState().toggle(a, "a-02");
    expect(wholeGroupChosen(store.getState(), group())).toBe(true);
    // Deselect all.
    store.getState().toggleGroup(a);
    expect(selectedCount(store.getState())).toBe(0);
    // Select all, then Deselect all.
    store.getState().toggleGroup(a);
    expect(selectedCount(store.getState())).toBe(3);
    store.getState().toggleGroup(a);
    expect(selectedCount(store.getState())).toBe(0);
  });

  it("acts on a group chosen whole as its count saw it, after the page read itself again", async () => {
    rows = run("a", "/a", 3);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    store.getState().toggleGroup(groupKey({ projectId: "p", workspace: "/a" }));
    const counted = asOf;
    asOf = "2026-10-11T10:05:00.000Z";
    await store.getState().refresh();
    fetch.requests.length = 0;
    await store.getState().remove({ kind: "selection" });
    expect(fetch.requests[0]!.body).toEqual({
      filter: { projectId: "p", workspace: "/a", until: counted },
    });
  });

  it("keeps the rows and reports the failure when the server refuses an action", async () => {
    rows = run("a", "/a", 2);
    const errors: string[] = [];
    const store = createArchiveStore((message) => errors.push(message));
    await store.getState().load(ALL);
    refuse = true;
    const ok = await store.getState().remove({ kind: "ids", ids: ["a-00"] });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(shownIds(store, "/a")).toEqual(["a-00", "a-01"]);
    expect(store.getState().busy).toBe(false);
  });

  it("reads itself again once for a burst of archive events, and not for anything else", async () => {
    vi.useFakeTimers();
    rows = run("a", "/a", 2);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    fetch.requests.length = 0;
    const events: ServerEvent[] = [
      { type: "session_archived", sessionId: "x", projectId: "p", agentId: "a1", archived: true },
      { type: "session_deleted", sessionId: "y", projectId: "p" },
      {
        type: "session_created",
        sessionId: "z",
        projectId: "p",
        agentId: "a1",
        source: "schedule",
      },
    ];
    for (const ev of events) store.getState().noteEvent(ev);
    await vi.advanceTimersByTimeAsync(ARCHIVE_REFRESH_DELAY_MS);
    await vi.runAllTimersAsync();
    expect(paths().filter((p) => p.endsWith("/groups"))).toHaveLength(1);

    fetch.requests.length = 0;
    store.getState().noteEvent({
      type: "session_created",
      sessionId: "c",
      projectId: "p",
      agentId: "a1",
      source: "user",
    });
    store.getState().noteEvent({ type: "session_title", sessionId: "a-00", title: "Renamed" });
    await vi.advanceTimersByTimeAsync(ARCHIVE_REFRESH_DELAY_MS);
    expect(fetch.requests).toEqual([]);
  });

  it("redraws a held row's run state where it stands, reading nothing again", async () => {
    vi.useFakeTimers();
    rows = run("a", "/a", 2);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    fetch.requests.length = 0;
    const state = (status: "running" | "idle") =>
      store.getState().noteEvent({
        type: "session_state",
        sessionId: "a-01",
        projectId: "p",
        state: status,
        lastActiveAt: new Date(Date.UTC(2026, 9, 11, 10, 0)).toISOString(),
        hasTrace: true,
      });
    const held = () =>
      shownRows(store.getState().rows.get(groupKey({ projectId: "p", workspace: "/a" })));

    state("running");
    expect(held().map((s) => [s.sessionId, s.status])).toEqual([
      ["a-00", "idle"],
      ["a-01", "running"],
    ]);
    state("idle");
    expect(held().map((s) => s.status)).toEqual(["idle", "idle"]);
    await vi.advanceTimersByTimeAsync(ARCHIVE_REFRESH_DELAY_MS);
    expect(fetch.requests).toEqual([]);
  });

  it("reads each group's rows from the server it is on, and names a machine it could not read", async () => {
    rows = [...run("l", "/a", 2, 100), ...machineRun("m", "/a", 3)];
    unreachable = ["nas"];
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const groups = shownGroups(store.getState());
    expect(groups.map((g) => [g.workspace, g.machineId ?? null, g.count])).toEqual([
      ["/a", null, 2],
      ["/a", MACHINE, 3],
    ]);
    // The same path on two servers is two groups, each read from its own.
    expect(shownIds(store, "/a")).toEqual(["l-00", "l-01"]);
    expect(shownIds(store, "/a", MACHINE)).toEqual(["m-00", "m-01", "m-02"]);
    const pages = fetch.requests.filter((r) => r.path === "/api/me/archived-sessions");
    expect(pages.map((r) => r.query.get("machineId")).sort()).toEqual([MACHINE, null]);
    expect(store.getState().unreachable).toEqual(["nas"]);
  });

  it("acts on a machine's rows on that machine: a row's own button, a mixed selection, a whole group", async () => {
    rows = [...run("l", "/a", 2, 100), ...machineRun("m", "/a", 3), ...machineRun("n", "/n", 2)];
    const store = createArchiveStore();
    await store.getState().load(ALL);
    const local = groupKey({ projectId: "p", workspace: "/a" });
    const remote = groupKey({ projectId: "p", workspace: "/a", machineId: MACHINE });
    const batches = () => fetch.requests.filter((r) => r.method === "POST");

    fetch.requests.length = 0;
    await store.getState().unarchive({ kind: "ids", ids: ["m-00"], machineId: MACHINE });
    expect(batches().map((r) => r.body)).toEqual([{ sessionIds: ["m-00"], machineId: MACHINE }]);

    fetch.requests.length = 0;
    store.getState().toggle(local, "l-00");
    store.getState().toggle(remote, "m-01");
    await store.getState().unarchive({ kind: "selection" });
    expect(batches().map((r) => r.body)).toEqual([
      { sessionIds: ["l-00"] },
      { sessionIds: ["m-01"], machineId: MACHINE },
    ]);
    expect(rows.map((s) => s.sessionId).sort()).toEqual(["l-01", "m-02", "n-00", "n-01"]);

    // The machine counted the group by its own clock; the batch is pinned to that time.
    fetch.requests.length = 0;
    store.getState().toggleGroup(groupKey({ projectId: "p", workspace: "/n", machineId: MACHINE }));
    await store.getState().remove({ kind: "selection" });
    expect(batches().map((r) => r.body)).toEqual([
      { filter: { projectId: "p", workspace: "/n", until: MACHINE_AS_OF }, machineId: MACHINE },
    ]);
    expect(rows.map((s) => s.sessionId).sort()).toEqual(["l-01", "m-02"]);
  });

  it("reads itself again for a machine's archive event, and redraws a machine row's run state", async () => {
    vi.useFakeTimers();
    rows = machineRun("m", "/a", 2);
    const store = createArchiveStore();
    await store.getState().load(ALL);
    fetch.requests.length = 0;
    const relayed = (event: ServerEvent): ServerEvent => ({
      type: "machine_event",
      machineId: MACHINE,
      event,
    });
    store.getState().noteEvent(
      relayed({
        type: "session_state",
        sessionId: "m-01",
        projectId: "p",
        state: "running",
        lastActiveAt: new Date(Date.UTC(2026, 9, 11, 10, 0)).toISOString(),
        hasTrace: true,
      }),
    );
    expect(
      shownRows(
        store
          .getState()
          .rows.get(groupKey({ projectId: "p", workspace: "/a", machineId: MACHINE })),
      ).map((s) => s.status),
    ).toEqual(["idle", "running"]);
    await vi.advanceTimersByTimeAsync(ARCHIVE_REFRESH_DELAY_MS);
    expect(fetch.requests).toEqual([]);

    store
      .getState()
      .noteEvent(relayed({ type: "session_deleted", sessionId: "m-00", projectId: "p" }));
    await vi.advanceTimersByTimeAsync(ARCHIVE_REFRESH_DELAY_MS);
    await vi.runAllTimersAsync();
    expect(paths().filter((p) => p.endsWith("/groups"))).toHaveLength(1);
  });
});
