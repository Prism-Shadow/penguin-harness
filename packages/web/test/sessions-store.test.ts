/**
 * The sessions store's list (state/sessions.tsx), driven through the real `listSessions`
 * wrapper against the fetch fake: each server pages its own rows, counts are summed, and a
 * source that could not answer is never read as a source that answered nothing.
 *
 * Loading:
 * - A fresh store is loading, and a reload with no Agent set does not claim to be done.
 * - A refresh over rows already on screen does not raise loading.
 *
 * Several machines:
 * - Every source is merged newest first, each row remembers the machine it lives on, the
 *   counts are summed, and what a machine answered is cached for the next restart.
 * - A machine is asked about its own Agents too, and this server only about its own.
 * - One Agent this server cannot answer about keeps its rows and counts; the rest refresh.
 * - A 404 from a machine is an answer: its rows go and its cache is cleared.
 * - A machine that could not answer keeps its cached rows and its cache; counts come only
 *   from servers that answered.
 * - This server not answering abandons the reload: the rows stand and loading stays clear.
 * - Two machines' counts for one path stay apart.
 * - A group's next page is asked only of the machine the group is on, by path.
 *
 * The user's own rows only:
 * - Every fetch, a reload or a folder's next page, asks the server to leave the
 *   organizations' rows out of the page and the totals.
 * - An organization row that enters by another door is held for its page, survives reloads,
 *   and never moves the own-only totals; an own row added the same way still counts.
 *
 * Live statuses:
 * - A session_state for a Session no loaded page holds is remembered without inventing a
 *   row, the run's end included; a loaded row's own status wins over an older remembered one.
 * - A resync forgets the remembered statuses, and a held organization row does not stand in
 *   for them.
 *
 * Events from a machine:
 * - A session_created for this Project reloads wherever it happened; another Project's never.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent, SessionInfo, SessionsResponse } from "@prismshadow/penguin-server/api";
import { applyUserEvent, createSessionsStore, liveSessionStatuses } from "../src/state/sessions";
import { forgetSessionMachines, machineForSession } from "../src/lib/session-machines";
import { cachedMachineSessions, rememberMachineSessions } from "../src/lib/machine-cache";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";
import { stubLocalStorage } from "./helpers/storage";

/** A server's answer for one Agent: its list, or an HTTP failure. */
type Answer = SessionsResponse | { status: number; code: string };
/** What each (machine, Agent) answers; a missing entry is a server that cannot be reached. */
const answers = new Map<string, Answer>();
const key = (machineId: string | null, agentId: string) => `${machineId ?? ""}|${agentId}`;
let fetch: FakeFetch;

beforeEach(() => {
  answers.clear();
  stubLocalStorage();
  fetch = stubFetch((request) => {
    const agentId = /\/agents\/([^/]+)\/sessions$/.exec(request.path)?.[1] ?? "";
    const answer = answers.get(key(request.machine, decodeURIComponent(agentId)));
    if (answer === undefined) throw new TypeError("fetch failed");
    return "status" in answer ? apiError(answer.status, answer.code) : json(answer);
  });
});

afterEach(() => forgetSessionMachines());

/** Which servers were asked, and for which Workspace group. */
const asked = () =>
  fetch.requests.map((r) => ({
    machineId: r.machine,
    ...(r.query.has("workspaceGroup") ? { workspaceGroup: r.query.get("workspaceGroup") } : {}),
  }));

function session(sessionId: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId,
    projectId: "p",
    agentId: "a1",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
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

const row = (sessionId: string, createdAt: string, agentId = "a1") =>
  session(sessionId, { agentId, createdAt, lastActiveAt: createdAt });

const COUNTS = { active: 1, subagent: 1, schedule: 0, benchmark: 0, archived: 0 };

const page = (
  sessions: SessionInfo[],
  active: number,
  workspaceCounts?: Record<string, { active: number }>,
): SessionsResponse =>
  ({
    sessions,
    counts: { active, subagent: 0, schedule: 0, benchmark: 0, archived: 0 },
    ...(workspaceCounts === undefined ? {} : { workspaceCounts }),
  }) as SessionsResponse;

function boot(machineIds: string[] = [], offlineMachineIds: string[] = [], agentIds = ["a1"]) {
  const store = createSessionsStore();
  store.setState({ projectId: "p", agentIds, machineIds, offlineMachineIds });
  return store;
}

const ids = (store: ReturnType<typeof boot>) => store.getState().sessions.map((s) => s.sessionId);

describe("loading", () => {
  it("a fresh store is loading, and a reload with no Agent set does not claim to be done", async () => {
    const store = createSessionsStore();
    expect(store.getState().loading).toBe(true);
    store.setState({ projectId: "p", agentIds: [] });
    await store.getState().reload();
    // Nothing was fetched, so nothing may report "loaded": clearing here painted an empty
    // state over a list that was merely not known yet.
    expect(store.getState().loading).toBe(true);
    expect(fetch.requests).toEqual([]);
  });

  it("a refresh over rows already on screen does not raise loading", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    const store = boot();
    await store.getState().reload();
    let raised = false;
    const unsubscribe = store.subscribe((state) => {
      if (state.loading) raised = true;
    });
    await store.getState().reload();
    unsubscribe();
    expect(raised).toBe(false);
  });
});

describe("the list across machines", () => {
  it("merges every source newest-first, records where each row lives, and sums the counts", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), page([row("there", "2026-01-03T00:00:00Z")], 2));
    const store = boot(["M1"]);
    await store.getState().reload();
    const { countsByAgent, loading } = store.getState();
    expect(ids(store)).toEqual(["there", "here"]);
    expect(machineForSession("there")).toBe("M1");
    expect(machineForSession("here")).toBeNull();
    expect(countsByAgent.get("a1")?.active).toBe(3);
    expect(loading).toBe(false);
    // What the machine answered is remembered for the next restart.
    expect(cachedMachineSessions("p", "M1").map((s) => s.sessionId)).toEqual(["there"]);
  });

  it("asks a machine about ITS Agents too — an Agent that exists only there", async () => {
    // A new chat started from a machine's Agent card belongs to an Agent this server has
    // never heard of: asked only about this Project's Agents, the machine answers nothing
    // about it, the row vanishes on the next reload, and with it the record of where it lives.
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), { status: 404, code: "not_found" });
    answers.set(
      key("M1", "theirs"),
      page([row("over-there", "2026-01-03T00:00:00Z", "theirs")], 1),
    );
    const store = boot(["M1"]);
    store.setState({ agentIdsByMachine: { M1: ["theirs"] } });
    await store.getState().reload();
    expect(ids(store)).toEqual(["over-there", "here"]);
    expect(machineForSession("over-there")).toBe("M1");
    // And this server is never asked about an Agent that is not its own.
    expect(asked().filter((a) => a.machineId === null)).toHaveLength(1);
  });

  it("one Agent this server cannot answer about keeps its rows; the rest still refresh", async () => {
    answers.set(key(null, "a1"), page([row("a1-row", "2026-01-02T00:00:00Z")], 1));
    answers.set(key(null, "a2"), page([row("a2-row", "2026-01-01T00:00:00Z", "a2")], 1));
    const store = boot([], [], ["a1", "a2"]);
    await store.getState().reload();
    expect(ids(store)).toEqual(["a1-row", "a2-row"]);

    // a2's index is damaged and its list 500s, while a1 answers as before. Erasing a2 would
    // read as an Agent with no conversations; abandoning the whole reload would leave the
    // page on a skeleton nothing clears.
    answers.set(key(null, "a2"), { status: 500, code: "internal" });
    answers.set(
      key(null, "a1"),
      page([row("a1-row", "2026-01-02T00:00:00Z"), row("a1-new", "2026-01-04T00:00:00Z")], 2),
    );
    await store.getState().reload();
    expect(ids(store)).toEqual(["a1-new", "a1-row", "a2-row"]);
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(2);
    // Kept as last read: a total without this server's share would contradict the row below it.
    expect(store.getState().countsByAgent.get("a2")?.active).toBe(1);
    expect(store.getState().loading).toBe(false);
  });

  it("a server that has not got the Agent answered — 404 is an answer, and its cache is cleared", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), { status: 404, code: "not_found" });
    rememberMachineSessions("p", "M1", [row("stale", "2026-01-01T00:00:00Z")]);
    const store = boot(["M1"]);
    await store.getState().reload();
    expect(ids(store)).toEqual(["here"]);
    expect(cachedMachineSessions("p", "M1")).toEqual([]);
  });

  it("a machine that could not answer keeps its cached rows on screen and its cache intact", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    // M1 is held but its server does not answer; M2 has no connection at all.
    rememberMachineSessions("p", "M1", [row("m1-cached", "2026-01-01T00:00:00Z")]);
    rememberMachineSessions("p", "M2", [row("m2-cached", "2026-01-04T00:00:00Z")]);
    const store = boot(["M1"], ["M2"]);
    await store.getState().reload();
    expect(ids(store)).toEqual(["m2-cached", "here", "m1-cached"]);
    expect(machineForSession("m2-cached")).toBe("M2");
    expect(cachedMachineSessions("p", "M1").map((s) => s.sessionId)).toEqual(["m1-cached"]);
    // Counts come only from servers that answered: the cache makes no claim about now.
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(1);
  });

  it("this server not answering abandons the reload: the rows stand and loading is left alone", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    const store = boot();
    await store.getState().reload();
    expect(ids(store)).toEqual(["here"]);
    expect(store.getState().loading).toBe(false);

    answers.delete(key(null, "a1")); // mid-swap: nothing answers here
    await store.getState().reload();
    expect(ids(store)).toEqual(["here"]);
    expect(store.getState().loading).toBe(false);
  });

  it("keeps two machines' counts for one path apart — a badge is about a directory, not a string", async () => {
    // `/w` on this server and `/w` on M1 are two different directories, and each folder's
    // badge has to match the rows under it.
    answers.set(
      key(null, "a1"),
      page([row("here", "2026-01-02T00:00:00Z")], 1, { "/w": { active: 2 } }),
    );
    answers.set(
      key("M1", "a1"),
      page([row("there", "2026-01-03T00:00:00Z")], 1, { "/w": { active: 5 } }),
    );
    const store = boot(["M1"]);
    await store.getState().reload();
    const byGroup = store.getState().workspaceCountsByAgent.get("a1");
    expect(byGroup?.["/w"]?.active).toBe(2);
    expect(byGroup?.[`M1\u0000/w`]?.active).toBe(5);
  });

  it("a group's page is asked only of the machine that group is on, by path", async () => {
    answers.set(key(null, "a1"), page([row("here", "2026-01-02T00:00:00Z")], 1));
    answers.set(key("M1", "a1"), page([row("there", "2026-01-03T00:00:00Z")], 1));
    const store = boot(["M1"]);
    await store.getState().reload();

    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "active", `M1\u0000/w`);
    // `/w` exists on this server too: asking it would page another directory's rows into
    // this group. The machine half never travels in the query.
    expect(asked()).toEqual([{ machineId: "M1", workspaceGroup: "/w" }]);

    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "active", "/w");
    expect(asked()).toEqual([{ machineId: null, workspaceGroup: "/w" }]);
  });
});

describe("the list fetches the user's own rows only", () => {
  it("reload() asks the server to leave the organizations' rows out of the page and the totals", async () => {
    answers.set(key(null, "default_agent"), { sessions: [], counts: COUNTS });
    answers.set(key(null, "acme_dev"), { sessions: [], counts: COUNTS });
    await boot([], [], ["default_agent", "acme_dev"]).getState().reload();
    expect(fetch.requests.map((r) => r.path)).toEqual([
      "/api/projects/p/agents/default_agent/sessions",
      "/api/projects/p/agents/acme_dev/sessions",
    ]);
    for (const { query } of fetch.requests) {
      expect(query.get("category")).toBe("active");
      expect(query.get("counts")).toBe("1");
      expect(query.get("excludeOrg")).toBe("1");
    }
  });

  it("loadMoreFor() pages a folder down the same own-rows stream", async () => {
    answers.set(key(null, "a1"), { sessions: [], counts: COUNTS });
    const store = boot();
    await store.getState().reload();
    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "subagent");
    expect(fetch.requests).toHaveLength(1);
    expect(fetch.requests[0]!.query.get("category")).toBe("subagent");
    expect(fetch.requests[0]!.query.get("excludeOrg")).toBe("1");
  });
});

describe("an organization row that enters by another door", () => {
  /** A store whose one loaded pair is complete, so an added own row would count. */
  async function loadedStore() {
    answers.set(key(null, "a1"), {
      sessions: [session("own")],
      counts: COUNTS,
      workspaceCounts: { "/w": COUNTS },
      workspaceLatest: { "/w": "2026-09-16T09:00:00.000Z" },
    });
    const store = boot();
    await store.getState().reload();
    return store;
  }

  it("is held for the page that asked for it but never moves the server's own-only totals", async () => {
    const store = await loadedStore();
    store.getState().add(session("s-desk", { client: "org", orgId: "acme" }));
    expect(ids(store)).toEqual(["s-desk", "own"]);
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(1);
    expect(store.getState().workspaceCountsByAgent.get("a1")?.["/w"]?.active).toBe(1);
    store.getState().remove("s-desk");
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(1);
  });

  it("an own row added under the same conditions still counts (the rule is about organization rows)", async () => {
    const store = await loadedStore();
    store.getState().add(session("own-2"));
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(2);
  });

  it("survives a reload, which can never fetch it back for the page showing it", async () => {
    const store = await loadedStore();
    store.getState().add(session("s-desk", { client: "org", orgId: "acme" }));
    await store.getState().reload();
    expect(ids(store)).toEqual(["own", "s-desk"]);
    expect(store.getState().countsByAgent.get("a1")?.active).toBe(1);
  });
});

describe("live statuses outlive the rows", () => {
  const stateEvent = (sessionId: string, state: "running" | "idle"): ServerEvent => ({
    type: "session_state",
    sessionId,
    state,
    lastActiveAt: "2026-09-16T09:05:00.000Z",
    hasTrace: true,
  });
  const live = (store: ReturnType<typeof boot>) =>
    liveSessionStatuses(store.getState().sessions, store.getState().liveStatuses);

  it("remembers a session_state for a Session no loaded page holds, without inventing a row", () => {
    const store = boot();
    store.setState({ sessions: [session("own")] });
    applyUserEvent(store, stateEvent("s-desk", "running"), () => undefined);
    expect(ids(store)).toEqual(["own"]);
    expect(live(store).get("s-desk")).toBe("running");
    // The run ending is the fact no other channel reports: it must be kept, not dropped as
    // "nothing to draw".
    applyUserEvent(store, stateEvent("s-desk", "idle"), () => undefined);
    expect(live(store).get("s-desk")).toBe("idle");
  });

  it("a loaded row's own status wins over an older remembered one", () => {
    const store = boot();
    store.setState({ sessions: [] });
    applyUserEvent(store, stateEvent("own", "running"), () => undefined);
    // A list fetch that landed after the event carries the row as it stands now.
    store.setState({ sessions: [session("own", { status: "idle" })] });
    expect(live(store).get("own")).toBe("idle");
  });

  it("a resync forgets them: the flip that ended a run may be among the ones it lost", () => {
    const store = boot();
    store.setState({ reload: vi.fn(() => Promise.resolve()) });
    applyUserEvent(store, stateEvent("s-desk", "running"), () => undefined);
    applyUserEvent(store, { type: "resync_required" }, () => undefined);
    expect(store.getState().liveStatuses.has("s-desk")).toBe(false);
    expect(live(store).has("s-desk")).toBe(false);
  });

  it("an organization row held for its page does not stand in for them", () => {
    const store = boot();
    store.setState({ reload: vi.fn(() => Promise.resolve()) });
    // The desk the chat page opened while it ran: no list fetch ever refreshes this row, so
    // after a resync its status is as stale as the forgotten entry.
    store.getState().add(session("s-desk", { client: "org", orgId: "acme", status: "running" }));
    applyUserEvent(store, { type: "resync_required" }, () => undefined);
    expect(ids(store)).toEqual(["s-desk"]);
    expect(live(store).has("s-desk")).toBe(false);
  });
});

/**
 * A machine's Projects carry THIS server's ids (installing one creates the same Project over
 * there), so the id in an event is as meaningful from a machine as from here.
 */
describe("events arriving from a machine", () => {
  const created = (projectId: string): ServerEvent =>
    ({ type: "session_created", projectId, agentId: "a1", sessionId: "s1" }) as ServerEvent;

  it.each([
    ["p", 2],
    ["other", 0],
  ])(
    "a session_created in Project %s reloads the list %i times, from a machine or here",
    (projectId, reloads) => {
      const store = boot();
      let count = 0;
      store.setState({
        reload: async () => {
          count += 1;
        },
      });
      applyUserEvent(store, created(projectId), () => undefined, "M1");
      applyUserEvent(store, created(projectId), () => undefined, null);
      expect(count).toBe(reloads);
    },
  );
});
