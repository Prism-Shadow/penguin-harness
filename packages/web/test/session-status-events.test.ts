/**
 * Live Session status over the user-level event stream (state/sessions.tsx).
 *
 * A tab subscribes to the one conversation it has open, so the Session channel's `task_state`
 * can only ever move that row's badge; every other row would sit on whatever status its last
 * list fetch returned. The user channel's `session_state` closes that gap, and these tests pin
 * what the store does with it: the right row moves, an unknown id moves nothing, and the row
 * stamp rides along so a Session that finished while the user was elsewhere reads as unread.
 *
 * The store is exercised directly (createSessionsStore / applyUserEvent): vitest runs this
 * package in Node with no DOM, so there is no React tree to mount.
 */
import { describe, expect, it } from "vitest";
import type { ServerEvent, SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import { applyUserEvent, createSessionsStore } from "../src/state/sessions";
import { isSessionUnread, markSessionSeen } from "../src/lib/session-seen";
import { sessionActivity } from "../src/lib/session-activity";

const CREATED = "2026-08-16T09:00:00.000Z";
/** When the user last had the Session open — every fixture's starting `lastActiveAt`. */
const LOOKED = "2026-08-16T10:00:00.000Z";
/** The server's run-end stamp, later than LOOKED: the Session ran after the user walked away. */
const FINISHED = "2026-08-16T10:05:00.000Z";

function session(sessionId: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId,
    projectId: "proj",
    agentId: "default_agent",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    createdAt: CREATED,
    lastActiveAt: LOOKED,
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    ...over,
  };
}

/** A store holding the given rows, as a loaded first page would. */
function storeWith(...rows: SessionInfo[]) {
  const store = createSessionsStore();
  store.setState({ projectId: "proj", agentIds: ["default_agent"], sessions: rows });
  return store;
}

const stateEvent = (
  sessionId: string,
  state: SessionStatus,
  lastActiveAt: string,
): ServerEvent => ({ type: "session_state", sessionId, state, lastActiveAt });

const rowOf = (store: ReturnType<typeof storeWith>, sessionId: string) =>
  store.getState().sessions.find((s) => s.sessionId === sessionId);

/** applyUserEvent's web_updated escape hatch, which no status test should ever trip. */
const neverReload = () => {
  throw new Error("web_updated handler must not fire");
};

describe("session_state on the user channel", () => {
  it("moves the named row and leaves every other row alone", () => {
    const store = storeWith(session("a"), session("b"));
    applyUserEvent(store, stateEvent("b", "running", FINISHED), neverReload);
    expect(rowOf(store, "b")?.status).toBe("running");
    expect(rowOf(store, "b")?.lastActiveAt).toBe(FINISHED);
    // The untouched row keeps both fields AND its object identity (no needless re-render).
    expect(rowOf(store, "a")?.status).toBe("idle");
    expect(rowOf(store, "a")?.lastActiveAt).toBe(LOOKED);
  });

  it("ignores a Session no loaded page holds instead of inventing a row", () => {
    const store = storeWith(session("a"));
    const before = store.getState().sessions;
    applyUserEvent(store, stateEvent("not-loaded", "running", FINISHED), neverReload);
    // Same array reference: nothing was appended and nothing re-rendered.
    expect(store.getState().sessions).toBe(before);
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["a"]);
  });

  it("a repeated event is a no-op (the state and the stamp both already match)", () => {
    const store = storeWith(session("a", { status: "running", lastActiveAt: FINISHED }));
    const before = store.getState().sessions;
    applyUserEvent(store, stateEvent("a", "running", FINISHED), neverReload);
    expect(store.getState().sessions).toBe(before);
  });

  it("carries a stamp change through even when the state itself did not change", () => {
    // Run start and run end both stamp the row; a goal loop's rounds keep it "running".
    const store = storeWith(session("a", { status: "running" }));
    applyUserEvent(store, stateEvent("a", "running", FINISHED), neverReload);
    expect(rowOf(store, "a")?.lastActiveAt).toBe(FINISHED);
  });

  it("compaction reaches the list as its own state, not as plain running", () => {
    const store = storeWith(session("a"));
    applyUserEvent(store, stateEvent("a", "compacting", FINISHED), neverReload);
    expect(rowOf(store, "a")?.status).toBe("compacting");
  });
});

describe("the glyph a background run produces", () => {
  it("starts running -> hourglass, without the user opening the Session", () => {
    const store = storeWith(session("a"));
    applyUserEvent(store, stateEvent("a", "running", FINISHED), neverReload);
    const row = rowOf(store, "a")!;
    expect(sessionActivity(row.status, row.hasTrace, false)).toBe("running");
  });

  it("finishes while the user is elsewhere -> completed UNREAD", () => {
    // The user opened this Session, then navigated away; the marker is that visit.
    const seen = markSessionSeen(
      { seededAt: Date.parse(CREATED), seen: new Map() },
      "a",
      LOOKED,
      Date.parse(LOOKED),
    );
    const store = storeWith(session("a", { status: "running" }));

    // Without the server's stamp the row would still claim it last ran when the user looked,
    // so the completion would settle straight into the muted "already read" glyph.
    expect(isSessionUnread(seen, "a", rowOf(store, "a")!.lastActiveAt)).toBe(false);

    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    const row = rowOf(store, "a")!;
    const unread = isSessionUnread(seen, "a", row.lastActiveAt);
    expect(unread).toBe(true);
    expect(sessionActivity(row.status, row.hasTrace, unread)).toBe("completedUnread");
  });

  it("a Session that has never run stays blank even while it runs its first turn", () => {
    const store = storeWith(session("a", { hasTrace: false }));
    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    const row = rowOf(store, "a")!;
    expect(sessionActivity(row.status, row.hasTrace, true)).toBeNull();
  });
});

describe("the open Session", () => {
  it("its own stream still writes the row, with no stamp of its own to offer", () => {
    // What chat-page does: two arguments, because the Session channel's task_state carries no
    // row stamp. The list's own lastActiveAt must survive that call untouched.
    const store = storeWith(session("open", { lastActiveAt: FINISHED }));
    store.getState().setStatus("open", "running");
    expect(rowOf(store, "open")?.status).toBe("running");
    expect(rowOf(store, "open")?.lastActiveAt).toBe(FINISHED);
  });

  it("the two sources converge on the same row rather than overwriting each other", () => {
    const store = storeWith(session("open", { status: "running" }));
    // The user channel wins the race and settles the row.
    applyUserEvent(store, stateEvent("open", "idle", FINISHED), neverReload);
    // This tab's own Session stream then reports the same flip.
    store.getState().setStatus("open", "idle");
    const row = rowOf(store, "open")!;
    expect(row.status).toBe("idle");
    expect(row.lastActiveAt).toBe(FINISHED);
  });

  it("a status for the open Session before its row is loaded is dropped, not stashed", () => {
    // Deep link: the route names a Session the paged list has not fetched yet.
    const store = storeWith(session("other"));
    store.getState().setStatus("deep-linked", "running");
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["other"]);
  });
});

describe("other user-channel events keep their behaviour", () => {
  it("web_updated reloads the window and touches no row", () => {
    const store = storeWith(session("a"));
    let reloaded = 0;
    applyUserEvent(store, { type: "web_updated", rev: "abc" }, () => (reloaded += 1));
    expect(reloaded).toBe(1);
    expect(rowOf(store, "a")?.status).toBe("idle");
  });

  it("an event this list has no use for is ignored", () => {
    const store = storeWith(session("a"));
    const before = store.getState().sessions;
    applyUserEvent(store, { type: "hello" }, neverReload);
    applyUserEvent(store, { type: "session_title", sessionId: "a", title: "T" }, neverReload);
    expect(store.getState().sessions).toBe(before);
  });

  it("resync_required refetches once: the flips it missed cannot be replayed", () => {
    const store = storeWith(session("a"));
    let reloads = 0;
    store.setState({
      reload: async () => {
        reloads += 1;
      },
    });
    applyUserEvent(store, { type: "resync_required" }, neverReload);
    expect(reloads).toBe(1);
  });

  it("schedule_fired still refetches, and still only for the current Project", () => {
    const store = storeWith(session("a"));
    let reloads = 0;
    store.setState({
      reload: async () => {
        reloads += 1;
      },
    });
    const fired = (projectId: string): ServerEvent => ({
      type: "schedule_fired",
      projectId,
      agentId: "default_agent",
      name: "nightly",
      sessionId: "a",
    });
    applyUserEvent(store, fired("another-project"), neverReload);
    expect(reloads).toBe(0);
    applyUserEvent(store, fired("proj"), neverReload);
    expect(reloads).toBe(1);
  });
});
