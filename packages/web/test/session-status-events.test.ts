/**
 * Live Session status over the user-level event stream (state/sessions.tsx, applyUserEvent),
 * and the glyph a sidebar row ends up drawing across a whole run (sessionRowActivity, the
 * function the row itself calls). A tab subscribes only to the conversation it has open, so
 * every other row depends on the user channel.
 *
 * - session_state moves the named row (state and stamp, compaction as its own state) and
 *   leaves every other row alone; a stamp change alone still lands.
 * - session_background sets or clears the named row's counts, and moves neither the glyph nor
 *   the status.
 * - session_title renames the named row in place.
 * - An event for a Session no loaded page holds changes nothing (a status from another Project;
 *   one of this Project's is fetched — sessions-store.test.ts), and one that matches the row
 *   already is a no-op (the same array, so nothing re-renders).
 * - A first run settles into the unread dot, not a blank: the run itself proves the Session
 *   has a Trace, from the server's flag or a live status, and a Session that ran never goes
 *   back to blank; a brand-new or genuinely never-run Session stays blank.
 * - For a Session the user is not looking at: nothing, hourglass, unread dot, and nothing
 *   again once opened — also for one opened earlier, for compaction, and in a tab that did not
 *   start the task.
 * - The open Session finishes as read; its own stream and the user channel converge on one
 *   row; a status before its row is loaded is dropped.
 * - web_updated reloads the window, resync_required and this Project's schedule_fired refetch
 *   the list, and anything else is ignored.
 */
import { describe, expect, it } from "vitest";
import type { ServerEvent, SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import { applyUserEvent, createSessionsStore } from "../src/state/sessions";
import { isSessionUnread, markSessionSeen } from "../src/lib/session-seen";
import type { SessionSeenState } from "../src/lib/session-seen";
import { sessionBackgroundTasks, sessionRowActivity } from "../src/lib/session-activity";

const CREATED = "2026-08-19T09:00:00.000Z";
/** When the user last had the Session open — every fixture's starting `lastActiveAt`. */
const LOOKED = "2026-08-19T10:00:00.000Z";
/** The server's run-start stamp, after the user walked away. */
const STARTED = "2026-08-19T10:03:00.000Z";
/** The server's run-end stamp. */
const FINISHED = "2026-08-19T10:05:00.000Z";

function session(sessionId: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId,
    projectId: "proj",
    agentId: "default_agent",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
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

/** A brand-new conversation: created, never run, so its row is blank. */
const freshSession = (sessionId: string) =>
  session(sessionId, { hasTrace: false, lastActiveAt: CREATED });

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
  hasTrace = true,
  projectId = "proj",
): ServerEvent => ({ type: "session_state", sessionId, projectId, state, lastActiveAt, hasTrace });

const rowOf = (store: ReturnType<typeof storeWith>, sessionId: string) =>
  store.getState().sessions.find((s) => s.sessionId === sessionId)!;

/** The user has this Session open and has looked at it as of `at`. */
const seenAt = (sessionId: string, at: string): SessionSeenState =>
  markSessionSeen(
    { seededAt: Date.parse(CREATED), seen: new Map() },
    sessionId,
    at,
    Date.parse(at),
  );

/** No marker of its own; everything since the baseline counts as unread. */
const neverSeen: SessionSeenState = { seededAt: Date.parse(CREATED), seen: new Map() };

/** The glyph the sidebar would draw for this row. `open` is the conversation on screen. */
const glyph = (
  store: ReturnType<typeof storeWith>,
  sessionId: string,
  seen: SessionSeenState,
  open: string | null = null,
) => sessionRowActivity(rowOf(store, sessionId), seen, open);

/** applyUserEvent's web_updated escape hatch, which no status test should ever trip. */
const neverReload = () => {
  throw new Error("web_updated handler must not fire");
};

describe("session_state on the user channel", () => {
  it("moves the named row and leaves every other row alone", () => {
    const store = storeWith(session("a"), session("b"));
    applyUserEvent(store, stateEvent("b", "running", STARTED), neverReload);
    expect(rowOf(store, "b").status).toBe("running");
    expect(rowOf(store, "b").lastActiveAt).toBe(STARTED);
    // The untouched row keeps both fields AND its object identity (no needless re-render).
    expect(rowOf(store, "a").status).toBe("idle");
    expect(rowOf(store, "a").lastActiveAt).toBe(LOOKED);
  });

  it("carries a stamp change through even when the state itself did not change", () => {
    // Run start and run end both stamp the row; a goal loop's rounds keep it "running".
    const store = storeWith(session("a", { status: "running" }));
    applyUserEvent(store, stateEvent("a", "running", FINISHED), neverReload);
    expect(rowOf(store, "a").lastActiveAt).toBe(FINISHED);
  });

  it("compaction reaches the list as its own state, not as plain running", () => {
    const store = storeWith(session("a"));
    applyUserEvent(store, stateEvent("a", "compacting", STARTED), neverReload);
    expect(rowOf(store, "a").status).toBe("compacting");
  });
});

describe("session_background on the user channel", () => {
  const backgroundEvent = (
    sessionId: string,
    processes: number,
    subagents: number,
  ): ServerEvent => ({ type: "session_background", sessionId, processes, subagents });

  it("sets the named row's counts and leaves every other row alone", () => {
    const store = storeWith(session("a"), session("b"));
    applyUserEvent(store, backgroundEvent("b", 1, 2), neverReload);
    expect(rowOf(store, "b").backgroundTasks).toEqual({ processes: 1, subagents: 2 });
    expect(sessionBackgroundTasks(rowOf(store, "b"))).toBe(3);
    expect("backgroundTasks" in rowOf(store, "a")).toBe(false);
  });

  it("clears the field at zero, the shape a list fetch returns", () => {
    const store = storeWith(session("a", { backgroundTasks: { processes: 1, subagents: 0 } }));
    applyUserEvent(store, backgroundEvent("a", 0, 0), neverReload);
    // Absent, not present-and-empty: every "has background work" check is one key test.
    expect("backgroundTasks" in rowOf(store, "a")).toBe(false);
    expect(sessionBackgroundTasks(rowOf(store, "a"))).toBe(0);
  });

  it("moves neither the glyph nor the status: an idle, read row keeps its blank glyph and gains the mark", () => {
    const store = storeWith(session("a"));
    const seen = seenAt("a", LOOKED);
    applyUserEvent(store, backgroundEvent("a", 1, 0), neverReload);
    expect(glyph(store, "a", seen)).toBeNull();
    expect(rowOf(store, "a").status).toBe("idle");
    expect(sessionBackgroundTasks(rowOf(store, "a"))).toBe(1);
    // A run ending does not touch the count either: the mark outlives the hourglass.
    applyUserEvent(store, stateEvent("a", "running", STARTED), neverReload);
    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    expect(sessionBackgroundTasks(rowOf(store, "a"))).toBe(1);
  });
});

describe("session_title on the user channel", () => {
  const titleEvent = (sessionId: string, title: string): ServerEvent => ({
    type: "session_title",
    sessionId,
    title,
  });

  it("renames the named row in place and leaves every other row alone", () => {
    // Titles land at Task start — before the tab watching the brand-new conversation has
    // subscribed to its Session channel — so the list depends on this delivery.
    const store = storeWith(session("a"), session("b"));
    applyUserEvent(store, titleEvent("b", "Login page bug"), neverReload);
    expect(rowOf(store, "b").title).toBe("Login page bug");
    expect(rowOf(store, "a").title).toBeUndefined();
  });
});

describe("events that need no change", () => {
  const events: ServerEvent[] = [
    stateEvent("not-loaded", "running", STARTED, true, "another-project"),
    { type: "session_background", sessionId: "not-loaded", processes: 1, subagents: 0 },
    { type: "session_title", sessionId: "not-loaded", title: "whatever" },
  ];

  it("an event for a Session no loaded page holds invents no row and re-renders nothing", () => {
    // The user channel carries every Session this user can see, most of them absent from
    // this list: an unlisted id must not churn the array and re-render every row.
    const store = storeWith(session("a"));
    const before = store.getState().sessions;
    for (const event of events) applyUserEvent(store, event, neverReload);
    expect(store.getState().sessions).toBe(before);
  });

  it("an event the row already matches is a no-op (both channels deliver the same facts)", () => {
    const store = storeWith(
      session("a", {
        status: "running",
        lastActiveAt: STARTED,
        title: "Login page bug",
        backgroundTasks: { processes: 2, subagents: 1 },
      }),
      session("b"),
    );
    const before = store.getState().sessions;
    applyUserEvent(store, stateEvent("a", "running", STARTED), neverReload);
    applyUserEvent(
      store,
      { type: "session_background", sessionId: "a", processes: 2, subagents: 1 },
      neverReload,
    );
    applyUserEvent(
      store,
      { type: "session_title", sessionId: "a", title: "Login page bug" },
      neverReload,
    );
    // Zero onto an already-clear row is the same non-event.
    applyUserEvent(
      store,
      { type: "session_background", sessionId: "b", processes: 0, subagents: 0 },
      neverReload,
    );
    expect(store.getState().sessions).toBe(before);
  });
});

describe("hasTrace across a status flip", () => {
  // The regression this pins: `sessionActivity` checks status first, so `running` draws the
  // hourglass whatever hasTrace says — and then falls to `if (!hasTrace) return null` once the
  // run settles. A first run on a row still carrying the `hasTrace: false` it was fetched with
  // therefore turned the hourglass into nothing, where the unread dot belongs.
  it("running -> idle on a never-run row settles into the unread dot, not a blank", () => {
    const store = storeWith(freshSession("a"));
    expect(glyph(store, "a", neverSeen)).toBeNull();

    applyUserEvent(store, stateEvent("a", "running", STARTED), neverReload);
    expect(glyph(store, "a", neverSeen)).toBe("running");

    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    expect(rowOf(store, "a").hasTrace).toBe(true);
    expect(glyph(store, "a", neverSeen)).toBe("completedUnread");
  });

  it("the server's flag alone settles a first run seen only at its end", () => {
    // This tab connected mid-run, so the only event it gets is the settle.
    const store = storeWith(freshSession("a"));
    applyUserEvent(store, stateEvent("a", "idle", FINISHED, true), neverReload);
    expect(glyph(store, "a", neverSeen)).toBe("completedUnread");
  });

  it("a live status is proof enough on its own, for the caller that carries no flag", () => {
    // chat-page's two-argument call: the Session channel's task_state has no row fields.
    const store = storeWith(freshSession("a"));
    store.getState().setStatus("a", "running");
    expect(rowOf(store, "a").hasTrace).toBe(true);
    store.getState().setStatus("a", "idle");
    // Read, so nothing is drawn: the two-argument call moves no stamp, so nothing has happened
    // since this browser first saw the Project. hasTrace still had to flip, though — the next
    // run's settle depends on it.
    expect(glyph(store, "a", neverSeen)).toBeNull();
    expect(rowOf(store, "a").hasTrace).toBe(true);
  });

  it("never regresses to blank once the Session has run", () => {
    const store = storeWith(session("a", { hasTrace: true }));
    // A stale or conservative flag must not un-run a Session: has_trace is a one-way cache.
    applyUserEvent(store, stateEvent("a", "idle", FINISHED, false), neverReload);
    expect(rowOf(store, "a").hasTrace).toBe(true);
  });

  it("a brand-new conversation does not wear the dot before it has ever run", () => {
    // Read and never-ran both render nothing now, which makes hasTrace look redundant. It is
    // not. This Session was created AFTER this browser first saw the Project, so it has no read
    // marker of its own and falls back to the baseline — and its own timestamp is later, so the
    // unread test says TRUE. hasTrace is the only thing standing between a fresh conversation
    // and a "there is something to read here" dot it has never earned.
    const store = storeWith(
      session("new-one", { hasTrace: false, createdAt: STARTED, lastActiveAt: STARTED }),
    );
    expect(isSessionUnread(neverSeen, "new-one", STARTED)).toBe(true);
    expect(glyph(store, "new-one", neverSeen)).toBeNull();

    // The moment it actually runs, that same row earns the dot.
    applyUserEvent(store, stateEvent("new-one", "idle", FINISHED), neverReload);
    expect(glyph(store, "new-one", neverSeen)).toBe("completedUnread");
  });

  it("a Session that genuinely never ran stays blank", () => {
    const store = storeWith(freshSession("a"));
    // An idle republish for a Session with no Trace (e.g. an approval resolution on a row that
    // never started a Task) must not invent a completion.
    applyUserEvent(store, stateEvent("a", "idle", CREATED, false), neverReload);
    expect(glyph(store, "a", neverSeen)).toBeNull();
  });
});

describe("the full sequence, for a Session the user is not looking at", () => {
  it("nothing -> hourglass -> unread dot -> nothing again once opened", () => {
    const store = storeWith(freshSession("a"));
    // The user has this Project open and has looked at nothing in particular.
    let seen = neverSeen;
    expect(glyph(store, "a", seen)).toBeNull();

    applyUserEvent(store, stateEvent("a", "running", STARTED), neverReload);
    expect(glyph(store, "a", seen)).toBe("running");

    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    expect(glyph(store, "a", seen)).toBe("completedUnread");

    // Opening it is what marks it read (sidebar's openSession -> noteSessionSeen), and a read
    // row goes back to showing nothing at all — the dot is removed, not muted.
    seen = markSessionSeen(seen, "a", rowOf(store, "a").lastActiveAt);
    expect(glyph(store, "a", seen)).toBeNull();
  });

  it("a Session the user opened earlier still goes unread when it later runs", () => {
    const store = storeWith(session("a"));
    const seen = seenAt("a", LOOKED);
    expect(glyph(store, "a", seen)).toBeNull();

    applyUserEvent(store, stateEvent("a", "running", STARTED), neverReload);
    expect(glyph(store, "a", seen)).toBe("running");
    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    expect(glyph(store, "a", seen)).toBe("completedUnread");
  });

  it("compaction shows the hourglass too, and settles to the unread dot", () => {
    const store = storeWith(session("a"));
    const seen = seenAt("a", LOOKED);
    applyUserEvent(store, stateEvent("a", "compacting", STARTED), neverReload);
    expect(glyph(store, "a", seen)).toBe("compacting");
    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    expect(glyph(store, "a", seen)).toBe("completedUnread");
  });

  it("the same sequence in a tab that did not start the task", () => {
    // The only difference is that nothing here ever calls setStatus with a task_state: this tab
    // has some OTHER conversation open, so every transition arrives on the user channel alone.
    const store = storeWith(freshSession("a"), session("elsewhere"));
    const open = "elsewhere";
    const seen = neverSeen;
    expect(glyph(store, "a", seen, open)).toBeNull();
    applyUserEvent(store, stateEvent("a", "running", STARTED), neverReload);
    expect(glyph(store, "a", seen, open)).toBe("running");
    applyUserEvent(store, stateEvent("a", "idle", FINISHED), neverReload);
    expect(glyph(store, "a", seen, open)).toBe("completedUnread");
    // And the conversation this tab IS looking at was never touched: read, so nothing.
    expect(glyph(store, "elsewhere", seen, open)).toBeNull();
  });
});

describe("the open Session", () => {
  it("finishes under the user's eyes as READ — nothing drawn, no unread flash", () => {
    const store = storeWith(freshSession("open"));
    // Stale marker on purpose: the seen stamp is older than the run that is about to end, so
    // only the "this is the conversation on screen" rule can keep it out of unread.
    const seen = seenAt("open", LOOKED);

    store.getState().setStatus("open", "running"); // this tab's own task_state
    expect(glyph(store, "open", seen, "open")).toBe("running");

    // The user channel settles the row first, moving lastActiveAt past the marker.
    applyUserEvent(store, stateEvent("open", "idle", FINISHED), neverReload);
    expect(glyph(store, "open", seen, "open")).toBeNull();
    // Then this tab's own stream reports the same flip: still no dot.
    store.getState().setStatus("open", "idle");
    expect(glyph(store, "open", seen, "open")).toBeNull();
  });

  it("its own stream writes the row with no stamp of its own to offer", () => {
    const store = storeWith(session("open", { lastActiveAt: FINISHED }));
    store.getState().setStatus("open", "running");
    expect(rowOf(store, "open").status).toBe("running");
    expect(rowOf(store, "open").lastActiveAt).toBe(FINISHED);
  });

  it("the two sources converge on the same row rather than overwriting each other", () => {
    const store = storeWith(session("open", { status: "running" }));
    applyUserEvent(store, stateEvent("open", "idle", FINISHED), neverReload);
    store.getState().setStatus("open", "idle");
    expect(rowOf(store, "open").status).toBe("idle");
    expect(rowOf(store, "open").lastActiveAt).toBe(FINISHED);
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
    expect(rowOf(store, "a").status).toBe("idle");
  });

  it("an event this list has no use for is ignored", () => {
    const store = storeWith(session("a"));
    const before = store.getState().sessions;
    applyUserEvent(store, { type: "hello" }, neverReload);
    applyUserEvent(
      store,
      {
        type: "schedule_queued",
        projectId: "proj",
        agentId: "default_agent",
        name: "n",
        sessionId: "a",
      },
      neverReload,
    );
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
