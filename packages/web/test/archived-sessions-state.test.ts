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
 * - Given a group's own action, it names the group through a filter carrying the current query.
 * - Given an action the server refuses, the rows stay and the failure is reported.
 * - Given a burst of user-channel events about the archive, the page reads itself again once;
 *   an event about something else does nothing.
 * - Given a run starting or settling on a row the page holds, the row's run state changes where
 *   it stands, with nothing read again.
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
  shownGroups,
  shownRows,
} from "../src/features/settings/archived-sessions-state";
import type { ArchiveFilters } from "../src/features/settings/archived-sessions-state";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch, FetchRequest } from "./helpers/fetch";

const ALL: ArchiveFilters = { q: "", source: null, projectId: null };

/** The server's archived rows. */
let rows: SessionInfo[];
let fetch: FakeFetch;
/** An action the server refuses, when set. */
let refuse = false;

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

/** The rows a query (or a batch's filter) matches, newest first. */
function matching(params: { get(name: string): string | null }): SessionInfo[] {
  const q = (params.get("q") ?? "").toLowerCase();
  const workspace = params.get("workspace");
  return rows
    .filter((s) => q === "" || (s.title ?? "").toLowerCase().includes(q))
    .filter((s) => workspace === null || s.workspace === workspace)
    .sort(newestFirst);
}

function serve(request: FetchRequest): Response {
  if (request.path === "/api/me/archived-sessions/groups") {
    const groups = new Map<string, ArchivedSessionGroup>();
    for (const s of matching(request.query)) {
      const g = groups.get(s.workspace);
      if (g) g.count += 1;
      else {
        groups.set(s.workspace, {
          projectId: "p",
          projectName: "Project",
          workspace: s.workspace,
          count: 1,
          latest: s.lastActiveAt,
        });
      }
    }
    const list = [...groups.values()];
    return json({ groups: list, total: list.reduce((n, g) => n + g.count, 0) });
  }
  if (request.path === "/api/me/archived-sessions") {
    const before = request.query.get("before");
    let list = matching(request.query);
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
    const body = request.body as { sessionIds?: string[]; filter?: Record<string, string> };
    const ids =
      body.sessionIds ?? matching(new URLSearchParams(body.filter ?? {})).map((s) => s.sessionId);
    rows = rows.filter((s) => !ids.includes(s.sessionId));
    return json({ done: ids.length, missing: [] });
  }
  return apiError(404, "not_found");
}

beforeEach(() => {
  rows = [];
  refuse = false;
  fetch = stubFetch(serve);
});
afterEach(() => vi.useRealTimers());

/** `n` rows in `workspace`, newest first by their index. */
const run = (prefix: string, workspace: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) =>
    row(`${prefix}-${String(i).padStart(2, "0")}`, workspace, from + n - i),
  );

const shownIds = (store: ReturnType<typeof createArchiveStore>, workspace: string) =>
  shownRows(store.getState().rows.get(groupKey({ projectId: "p", workspace }))).map(
    (s) => s.sessionId,
  );

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
    store.getState().toggle("a-00");
    fetch.requests.length = 0;
    await store.getState().load({ q: "deploy", source: "cli", projectId: "p" });
    expect(store.getState().selection.size).toBe(0);
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
    store.getState().toggle("a-00");
    store.getState().toggle("b-01");
    fetch.requests.length = 0;
    const ok = await store
      .getState()
      .unarchive({ kind: "ids", ids: [...store.getState().selection] });
    expect(ok).toBe(true);
    expect(fetch.requests[0]!.body).toEqual({ sessionIds: ["a-00", "b-01"] });
    expect(store.getState().selection.size).toBe(0);
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

  it("names a whole group through a filter that carries the current query", async () => {
    rows = [...run("a", "/a", 3, 100), row("a-x", "/a", 1, "Deploy"), ...run("b", "/b", 2)];
    const store = createArchiveStore();
    await store.getState().load({ ...ALL, q: "deploy" });
    fetch.requests.length = 0;
    await store
      .getState()
      .remove({ kind: "group", key: groupKey({ projectId: "p", workspace: "/a" }) });
    expect(fetch.requests[0]!.path).toBe("/api/me/archived-sessions/delete");
    expect(fetch.requests[0]!.body).toEqual({
      filter: { q: "deploy", projectId: "p", workspace: "/a" },
    });
    // Only what the query matched went; the rest of the group is still archived.
    expect(rows.map((s) => s.sessionId).sort()).toEqual(["a-00", "a-01", "a-02", "b-00", "b-01"]);
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
});
