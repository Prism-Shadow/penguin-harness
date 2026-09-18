/**
 * The development list holds the user's own conversations, end to end (state/sessions.tsx).
 *
 * An organization's desk and ticket Sessions (and the sub-sessions they spawn) must never
 * reach development mode's list — not as rows, and not as the totals and Workspace stamps
 * the sidebar builds groups from. The store therefore asks the server for its own rows only
 * on every fetch, keeps the server's totals as they are when an organization row still
 * enters by another door (a deep link's self-heal) and carries that row across reloads, and
 * remembers every live status the user channel reports whether or not a loaded page holds the
 * row — which is what company mode's surfaces read, now that the rows themselves are no longer
 * fetched here — until a resync says flips were lost.
 *
 * The store is exercised directly (node, no DOM); the API module is mocked at the seam.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent, SessionInfo, SessionsResponse } from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({ listSessions: vi.fn() }));

import * as api from "../src/api/endpoints";
import { applyUserEvent, createSessionsStore, liveSessionStatuses } from "../src/state/sessions";

const listSessions = vi.mocked(api.listSessions);

const NO_ROWS: SessionsResponse = { sessions: [] };
const COUNTS = { active: 1, subagent: 1, schedule: 0, benchmark: 0, archived: 0 };

function session(sessionId: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId,
    projectId: "proj",
    agentId: "default_agent",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    createdAt: "2026-09-16T09:00:00.000Z",
    lastActiveAt: "2026-09-16T09:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    ...over,
  };
}

const stateEvent = (sessionId: string, state: "running" | "idle"): ServerEvent => ({
  type: "session_state",
  sessionId,
  state,
  lastActiveAt: "2026-09-16T09:05:00.000Z",
  hasTrace: true,
});

beforeEach(() => {
  listSessions.mockReset();
});

describe("the list fetches the user's own rows only", () => {
  it("reload() asks the server to leave the organizations' rows out of the page and the totals", async () => {
    listSessions.mockResolvedValue({ ...NO_ROWS, counts: COUNTS });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent", "acme_dev"] });
    await store.getState().reload();
    expect(listSessions).toHaveBeenCalledTimes(2);
    for (const call of listSessions.mock.calls) {
      expect(call[0]).toBe("proj");
      expect(call[2]).toMatchObject({ category: "active", withCounts: true, excludeOrg: true });
    }
  });

  it("loadMoreFor() pages a folder down the same own-rows stream", async () => {
    listSessions.mockResolvedValue({ ...NO_ROWS, counts: COUNTS });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    listSessions.mockClear();
    listSessions.mockResolvedValue(NO_ROWS);
    await store.getState().loadMoreFor(["default_agent"], "subagent");
    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(listSessions.mock.calls[0]![2]).toMatchObject({
      category: "subagent",
      excludeOrg: true,
    });
  });
});

describe("an organization row that enters by another door", () => {
  /** A store whose one loaded pair is complete, so an added own row would count. */
  async function loadedStore() {
    listSessions.mockResolvedValue({
      sessions: [session("own")],
      counts: COUNTS,
      workspaceCounts: { "/w": COUNTS },
      workspaceLatest: { "/w": "2026-09-16T09:00:00.000Z" },
    });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    return store;
  }

  it("is held for the page that asked for it but never moves the server's own-only totals", async () => {
    const store = await loadedStore();
    const desk = session("s-desk", { client: "org", orgId: "acme" });
    store.getState().add(desk);
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["s-desk", "own"]);
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(1);
    expect(store.getState().workspaceCountsByAgent.get("default_agent")?.["/w"]?.active).toBe(1);
    store.getState().remove("s-desk");
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(1);
  });

  it("an own row added under the same conditions still counts (the rule is about organization rows)", async () => {
    const store = await loadedStore();
    store.getState().add(session("own-2"));
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(2);
  });

  it("survives a reload, which can never fetch it back for the page showing it", async () => {
    const store = await loadedStore();
    store.getState().add(session("s-desk", { client: "org", orgId: "acme" }));
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["own", "s-desk"]);
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(1);
  });
});

describe("live statuses outlive the rows", () => {
  it("remembers a session_state for a Session no loaded page holds, without inventing a row", () => {
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"], sessions: [session("own")] });
    applyUserEvent(store, stateEvent("s-desk", "running"), () => undefined);
    const state = store.getState();
    expect(state.sessions.map((s) => s.sessionId)).toEqual(["own"]);
    expect(liveSessionStatuses(state.sessions, state.liveStatuses).get("s-desk")).toBe("running");
    // The run ending is the fact no other channel reports: it must be kept, not dropped as
    // "nothing to draw".
    applyUserEvent(store, stateEvent("s-desk", "idle"), () => undefined);
    const after = store.getState();
    expect(liveSessionStatuses(after.sessions, after.liveStatuses).get("s-desk")).toBe("idle");
  });

  it("a loaded row's own status wins over an older remembered one", () => {
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"], sessions: [] });
    applyUserEvent(store, stateEvent("own", "running"), () => undefined);
    // A list fetch that landed after the event carries the row as it stands now.
    store.setState({ sessions: [session("own", { status: "idle" })] });
    const state = store.getState();
    expect(liveSessionStatuses(state.sessions, state.liveStatuses).get("own")).toBe("idle");
  });

  it("a resync forgets them: the flip that ended a run may be among the ones it lost", () => {
    const store = createSessionsStore();
    store.setState({
      projectId: "proj",
      agentIds: ["default_agent"],
      reload: vi.fn(() => Promise.resolve()),
    });
    applyUserEvent(store, stateEvent("s-desk", "running"), () => undefined);
    applyUserEvent(store, { type: "resync_required" }, () => undefined);
    const state = store.getState();
    expect(state.liveStatuses.has("s-desk")).toBe(false);
    expect(liveSessionStatuses(state.sessions, state.liveStatuses).has("s-desk")).toBe(false);
  });

  it("an organization row held for its page does not stand in for them", () => {
    const store = createSessionsStore();
    store.setState({
      projectId: "proj",
      agentIds: ["default_agent"],
      reload: vi.fn(() => Promise.resolve()),
    });
    // The desk the chat page opened while it ran: no list fetch ever refreshes this row, so
    // after a resync its status is as stale as the forgotten entry.
    store.getState().add(session("s-desk", { client: "org", orgId: "acme", status: "running" }));
    applyUserEvent(store, { type: "resync_required" }, () => undefined);
    const state = store.getState();
    expect(state.sessions.map((s) => s.sessionId)).toEqual(["s-desk"]);
    expect(liveSessionStatuses(state.sessions, state.liveStatuses).has("s-desk")).toBe(false);
  });
});
