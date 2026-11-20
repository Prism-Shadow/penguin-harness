/**
 * The conversation list behind Clean up old chats and Manage chats
 * (plugins/storage/src/web/storage-sessions-state.ts), driven through the real endpoint wrappers
 * against the fetch fake, which answers as the storage list and the archive batch delete do.
 *
 * - Given the filters, every one rides on the list request, and none that is unset does.
 * - Given a list that opens with everything chosen, every row is chosen but a running one; and a
 *   running row cannot be chosen by hand either.
 * - Given chosen conversations deleted, exactly those ids go to the one batch delete, they leave
 *   the list at once, and the list is read again; the rows not chosen stay.
 * - Given a delete the server refuses, the rows stay and the failure is reported.
 */
// The face's host first: the page calls the app's `apiFetch` and toasts through it.
import "../src/web-app/plugin-host";
import { afterEach, describe, expect, it } from "vitest";
import type { StorageSessionRow } from "../../../plugins/storage/src/types";
import {
  ALL_SESSIONS,
  OLD_SESSIONS,
  createSessionsStore,
} from "../../../plugins/storage/src/web/storage-sessions-state";
import { apiError, json, stubFetch, type FakeFetch } from "./helpers/fetch";

function row(sessionId: string, running = false): StorageSessionRow {
  return {
    sessionId,
    projectId: "p",
    projectName: "Project",
    agentId: "a",
    agentName: "Writer",
    title: sessionId,
    createdAt: "2026-09-01T00:00:00.000Z",
    lastActiveAt: "2026-09-02T00:00:00.000Z",
    archived: true,
    running,
    traceBytes: 1000,
  };
}

/** The fake server's conversations; a delete removes them. */
let rows: StorageSessionRow[];
let refuse = false;
let fetch: FakeFetch;

function serve() {
  fetch = stubFetch((request) => {
    if (request.path === "/api/me/storage/sessions") {
      return json({ sessions: rows, total: rows.length, totalBytes: 0, truncated: false });
    }
    if (request.path === "/api/me/archived-sessions/delete") {
      if (refuse) return apiError(403, "forbidden");
      const ids = new Set((request.body as { sessionIds: string[] }).sessionIds);
      rows = rows.filter((r) => !ids.has(r.sessionId));
      return json({ done: ids.size, missing: [] });
    }
    return apiError(404, "not_found");
  });
}

afterEach(() => {
  refuse = false;
});

describe("the conversation list", () => {
  it("sends every filter that is set, and none that is not", async () => {
    rows = [];
    serve();
    const store = createSessionsStore();
    await store.getState().load({
      agent: { projectId: "p", agentId: "a" },
      listing: "archived",
      olderThanDays: 30,
      sort: "age",
    });
    await store.getState().load(ALL_SESSIONS);
    const [narrow, wide] = fetch.requests.map((r) => Object.fromEntries(r.query));
    expect(narrow).toEqual({
      projectId: "p",
      agentId: "a",
      listing: "archived",
      olderThanDays: "30",
      sort: "age",
    });
    expect(wide).toEqual({ listing: "all", sort: "size" });
  });

  it("never chooses a running conversation, opened with everything chosen or by hand", async () => {
    rows = [row("idle-1"), row("busy", true), row("idle-2")];
    serve();
    const store = createSessionsStore();
    await store.getState().load(OLD_SESSIONS, { chooseAll: true });
    expect([...store.getState().selected].sort()).toEqual(["idle-1", "idle-2"]);
    store.getState().setSelected(new Set(["busy", "idle-1"]));
    expect([...store.getState().selected]).toEqual(["idle-1"]);
  });

  it("deletes exactly the chosen ids through the batch delete, and drops them from the list", async () => {
    rows = [row("keep"), row("go-1"), row("go-2")];
    serve();
    const store = createSessionsStore();
    await store.getState().load(ALL_SESSIONS);
    store.getState().setSelected(new Set(["go-1", "go-2"]));
    expect(await store.getState().remove()).toBe(2);
    const deletes = fetch.requests.filter((r) => r.path === "/api/me/archived-sessions/delete");
    expect(deletes.map((r) => r.body)).toEqual([{ sessionIds: ["go-1", "go-2"] }]);
    expect(store.getState().list?.sessions.map((r) => r.sessionId)).toEqual(["keep"]);
    expect(store.getState().selected.size).toBe(0);
    // Read again after the delete.
    expect(fetch.requests.filter((r) => r.path === "/api/me/storage/sessions")).toHaveLength(2);
  });

  it("keeps the rows and reports the failure when the server refuses the delete", async () => {
    rows = [row("a"), row("b")];
    serve();
    refuse = true;
    const errors: string[] = [];
    const store = createSessionsStore((message) => errors.push(message));
    await store.getState().load(ALL_SESSIONS);
    store.getState().setSelected(new Set(["a"]));
    expect(await store.getState().remove()).toBeNull();
    expect(errors).toHaveLength(1);
    expect(store.getState().list?.sessions.map((r) => r.sessionId)).toEqual(["a", "b"]);
    expect([...store.getState().selected]).toEqual(["a"]);
  });
});
