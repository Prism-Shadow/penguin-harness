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
 * Activity order and cursors:
 * - Every list fetch asks for the activity order; a first page sends no cursor, and the next
 *   continues below the last row shown (never the overflow row).
 * - A Workspace group's first own page continues from its Agent's whole-stream cursor on that
 *   machine; when that stream is exhausted, no request is sent.
 * - The watermark over two machines is the more recent cursor with more; a machine nothing was
 *   read from bounds nothing; everything exhausted shows every row.
 * - A folder pages in activity order too: an archived conversation resumed yesterday lists
 *   above one archived last month, and its next page continues below it.
 *
 * Sessions that become active:
 * - A loaded row moves up without a request.
 * - A Session of this Project no page holds is fetched from the machine that announced it and
 *   shows at the top; one run's flips share one lookup and the newest flip lands on the row.
 * - Another Project's flip, an organization's Session, an id deleted here and an id that is
 *   gone are not listed, and the last three are not asked about again.
 * - A reload that was already running when such a Session was fetched keeps it.
 *
 * Property (seeded, 100 runs): after any sequence of loads, live flips and reloads, every list
 * the sidebar draws — time mode's, each Agent group's, each Workspace group's — is a prefix of
 * its true activity order; a load only appends below what was shown, and a "More" over every
 * stream with more shows at least a page more (or the rest).
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
import type {
  ServerEvent,
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
  SessionsResponse,
} from "@prismshadow/penguin-server/api";
import {
  applyUserEvent,
  createSessionsStore,
  liveSessionStatuses,
  watermarkFor,
} from "../src/state/sessions";
import {
  SIDEBAR_PAGE_SIZE,
  aggregateWorkspaceCounts,
  compareActivityDesc,
  cutAtWatermark,
  sessionCategory,
  workspaceGroupKey,
} from "../src/lib/session-grouping";
import { forgetSessionMachines, machineForSession } from "../src/lib/session-machines";
import { cachedMachineSessions, rememberMachineSessions } from "../src/lib/machine-cache";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch, FetchHandler, FetchRequest } from "./helpers/fetch";
import { stubLocalStorage } from "./helpers/storage";

/** A server's answer for one Agent: its list, or an HTTP failure. */
type Answer = SessionsResponse | { status: number; code: string };
/** What each (machine, Agent) answers; a missing entry is a server that cannot be reached. */
const answers = new Map<string, Answer>();
/**
 * Each (machine, Agent)'s whole row set, for a server that pages it the way the real one does
 * (servedPage) — what the cursor tests read from instead of a fixed answer. Also what
 * `GET /api/sessions/:id` reads on that machine; a row in none of them is a 404.
 */
const served = new Map<string, SessionInfo[]>();
const key = (machineId: string | null, agentId: string) => `${machineId ?? ""}|${agentId}`;
let fetch: FakeFetch;

/** The servers behind `fetch`: `served` rows by id and by page, else the fixed `answers`. */
const serve: FetchHandler = (request) => {
  const one = /^\/api\/sessions\/([^/]+)$/.exec(request.path);
  if (one) {
    const sessionId = decodeURIComponent(one[1]!);
    const machine = request.machine ?? "";
    const row = [...served]
      .filter(([k]) => k.startsWith(`${machine}|`))
      .flatMap(([, rows]) => rows)
      .find((s) => s.sessionId === sessionId);
    return row ? json({ session: row }) : apiError(404, "not_found");
  }
  // The whole sidebar reload in one POST: the same per-(Agent, source) answers, one entry each.
  if (request.method === "POST" && /^\/api\/projects\/[^/]+\/sessions\/batch$/.test(request.path)) {
    const entries = (request.body as { requests?: BatchEntry[] }).requests ?? [];
    const results = entries.map((entry) => {
      const k = key(request.machine, entry.agentId);
      const rows = served.get(k);
      if (rows !== undefined) {
        const page = servedBody(rows, entryQuery(entry));
        if ("error" in page) return { agentId: entry.agentId, ok: false, reason: "error" };
        return { agentId: entry.agentId, ok: true, ...page.body };
      }
      const answer = answers.get(k);
      // The transport never throws for one entry: an Agent this server does not host (404) is
      // an ANSWER, and anything else is a failure to answer — neither may become "no rows".
      if (answer === undefined) throw new TypeError("fetch failed");
      if ("status" in answer)
        return {
          agentId: entry.agentId,
          ok: false,
          reason: answer.status === 404 ? "absent" : "error",
        };
      return { agentId: entry.agentId, ok: true, ...answer };
    });
    return json({ results });
  }
  const agentId = /\/agents\/([^/]+)\/sessions$/.exec(request.path)?.[1] ?? "";
  const k = key(request.machine, decodeURIComponent(agentId));
  const rows = served.get(k);
  if (rows !== undefined) return servedPage(rows, request.query);
  const answer = answers.get(k);
  if (answer === undefined) throw new TypeError("fetch failed");
  return "status" in answer ? apiError(answer.status, answer.code) : json(answer);
};

beforeEach(() => {
  answers.clear();
  served.clear();
  stubLocalStorage();
  fetch = stubFetch(serve);
});

/** The page requests the batch calls carried, in order (their params live in the body). */
/** A batch entry's activity cursor in the list route's `before` param form. */
const entryCursor = (entry: BatchEntry | undefined): string | undefined =>
  entry?.before === undefined
    ? undefined
    : `${entry.before.lastActiveAt},${entry.before.sessionId}`;

const batchEntries = (): BatchEntry[] =>
  fetch.requests.flatMap((r) =>
    r.method === "POST" ? ((r.body as { requests?: BatchEntry[] }).requests ?? []) : [],
  );

/** The server's activity order, written out on its own (plain `<` / `>`, as the route compares). */
const serverRecent = (
  a: Pick<SessionInfo, "lastActiveAt" | "sessionId">,
  b: Pick<SessionInfo, "lastActiveAt" | "sessionId">,
) =>
  a.lastActiveAt < b.lastActiveAt
    ? 1
    : a.lastActiveAt > b.lastActiveAt
      ? -1
      : a.sessionId < b.sessionId
        ? 1
        : a.sessionId > b.sessionId
          ? -1
          : 0;

const zeroCounts = (): SessionCategoryCounts => ({
  active: 0,
  subagent: 0,
  schedule: 0,
  benchmark: 0,
  archived: 0,
});

/** One page of an Agent's rows as the list route answers it: order, cursor, filters, counts. */
/** One page request as the batch endpoint carries it. */
type BatchEntry = {
  agentId: string;
  limit: number;
  order?: "created" | "activity";
  before?: { lastActiveAt: string; sessionId: string };
  category?: string;
  workspaceGroup?: string;
  withCounts?: boolean;
  excludeOrg?: boolean;
};

/** One batch entry → the query the single-Agent list route would have been asked with. */
function entryQuery(entry: BatchEntry): URLSearchParams {
  const query = new URLSearchParams();
  query.set("limit", String(entry.limit));
  if (entry.order !== undefined) query.set("order", entry.order);
  if (entry.before !== undefined) {
    query.set("before", `${entry.before.lastActiveAt},${entry.before.sessionId}`);
  }
  if (entry.category !== undefined) query.set("category", entry.category);
  if (entry.workspaceGroup !== undefined) query.set("workspaceGroup", entry.workspaceGroup);
  if (entry.withCounts === true) query.set("counts", "1");
  if (entry.excludeOrg === true) query.set("excludeOrg", "1");
  return query;
}

function servedPage(rows: readonly SessionInfo[], query: URLSearchParams): Response {
  const page = servedBody(rows, query);
  return "error" in page ? apiError(400, "bad_request") : json(page.body);
}

/** The page the list route answers with, computed apart from the Response so the batch
 *  endpoint's per-entry answers can reuse it verbatim. */
function servedBody(
  rows: readonly SessionInfo[],
  query: URLSearchParams,
): { body: SessionsResponse } | { error: true } {
  const activity = query.get("order") === "activity";
  const before = query.get("before");
  if (before !== null && (!activity || query.has("offset") || !query.has("limit")))
    return { error: true };
  let list = [...rows].sort(
    activity ? serverRecent : (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
  );
  const category = query.get("category");
  if (category !== null) list = list.filter((s) => sessionCategory(s) === category);
  const group = query.get("workspaceGroup");
  if (group !== null) list = list.filter((s) => s.workspace === group);
  if (before !== null) {
    const comma = before.indexOf(",");
    const cursor = { lastActiveAt: before.slice(0, comma), sessionId: before.slice(comma + 1) };
    list = list.filter((s) => serverRecent(s, cursor) > 0);
  }
  const offset = Number(query.get("offset") ?? 0);
  const limit = Number(query.get("limit") ?? list.length);
  const body: SessionsResponse = { sessions: list.slice(offset, offset + limit) };
  if (query.get("counts") === "1") {
    const counts = zeroCounts();
    const workspaceCounts: Record<string, SessionCategoryCounts> = {};
    for (const s of rows) {
      counts[sessionCategory(s)] += 1;
      (workspaceCounts[s.workspace] ??= zeroCounts())[sessionCategory(s)] += 1;
    }
    Object.assign(body, { counts, workspaceCounts });
  }
  return { body };
}

afterEach(() => forgetSessionMachines());

/** Which servers were asked, and for which Workspace group. */
/** What the sidebar asked, per request: the machine it went to and each page it wanted. */
const asked = () =>
  fetch.requests.flatMap((r) =>
    batchEntriesOf(r).map((e) => ({
      machineId: r.machine,
      ...(e.workspaceGroup !== undefined ? { workspaceGroup: e.workspaceGroup } : {}),
    })),
  );

/** The page requests one recorded request carried (its params live in a batch body). */
const batchEntriesOf = (request: FetchRequest): BatchEntry[] =>
  request.method === "POST" ? ((request.body as { requests?: BatchEntry[] }).requests ?? []) : [];

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
    // Both hold more than a page, so a group's own stream has something left to ask for.
    served.set(key(null, "a1"), activeRun("here", 12));
    served.set(key("M1", "a1"), activeRun("there", 12));
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
    // One request for the whole reload, carrying both Agents' first pages.
    expect(fetch.requests.map((r) => r.path)).toEqual(["/api/projects/p/sessions/batch"]);
    expect(batchEntries().map((e) => e.agentId)).toEqual(["default_agent", "acme_dev"]);
    for (const entry of batchEntries()) {
      expect(entry.category).toBe("active");
      expect(entry.withCounts).toBe(true);
      expect(entry.excludeOrg).toBe(true);
    }
  });

  it("loadMoreFor() pages a folder down the same own-rows stream", async () => {
    answers.set(key(null, "a1"), { sessions: [], counts: COUNTS });
    const store = boot();
    await store.getState().reload();
    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "subagent");
    expect(fetch.requests).toHaveLength(1);
    expect(batchEntries()[0]).toMatchObject({ category: "subagent", excludeOrg: true });
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

/** A minute-spaced run of `n` rows, most recently active first; created in the REVERSE order, so creation order and activity order disagree on every pair. */
function activeRun(
  prefix: string,
  n: number,
  { day = 20, over = (_i: number): Partial<SessionInfo> => ({}) } = {},
): SessionInfo[] {
  const top = Date.parse(`2026-09-${day}T12:00:00.000Z`);
  return Array.from({ length: n }, (_, i) =>
    session(`${prefix}-${String(i).padStart(2, "0")}`, {
      lastActiveAt: new Date(top - i * 60_000).toISOString(),
      createdAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 60_000).toISOString(),
      ...over(i),
    }),
  );
}

const cursorOf = (row: SessionInfo) => `${row.lastActiveAt},${row.sessionId}`;

/** The rows a sidebar list of `category` shows: the pool's rows it holds, cut at its watermark. */
function shown(
  store: ReturnType<typeof boot>,
  agentIds: string[],
  category: SessionCategory,
  workspaceGroup?: string,
  holds: (s: SessionInfo) => boolean = () => true,
): string[] {
  const state = store.getState();
  const rows = state.sessions.filter((s) => sessionCategory(s) === category && holds(s));
  return cutAtWatermark(rows, watermarkFor(state, agentIds, category, workspaceGroup)).map(
    (s) => s.sessionId,
  );
}

const sessionState = (
  sessionId: string,
  lastActiveAt: string,
  state: "running" | "idle" = "running",
  projectId = "p",
): ServerEvent => ({
  type: "session_state",
  sessionId,
  projectId,
  state,
  lastActiveAt,
  hasTrace: true,
});

/**
 * Waits for the lookup a session_state started: adoptLiveSession joins one in flight rather
 * than starting another. It would start one if none were running, so every test asserts the
 * EVENT issued its lookup (the request is sent synchronously) before waiting on it here.
 */
const adopted = (
  store: ReturnType<typeof boot>,
  sessionId: string,
  source: string | null,
  lastActiveAt: string,
  state: "running" | "idle" = "running",
) => store.getState().adoptLiveSession(sessionId, source, state, { lastActiveAt, hasTrace: true });

const sessionLookups = () => fetch.requests.filter((r) => r.path.startsWith("/api/sessions/"));

describe("the list pages in activity order, under a cursor", () => {
  it("asks for the activity order; the next page continues below the last row shown", async () => {
    const rows = activeRun("r", 25);
    served.set(key(null, "a1"), rows);
    const store = boot();
    await store.getState().reload();
    const first = batchEntries()[0]!;
    expect(first.order).toBe("activity");
    expect(first.before).toBeUndefined();
    // The conversations used last lead, though they were created first.
    expect(ids(store)).toEqual(rows.slice(0, 10).map((s) => s.sessionId));

    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "active");
    const next = batchEntries()[0]!;
    expect(next.order).toBe("activity");
    // The tenth row, the last one shown — not the overflow row that only said "more".
    expect(entryCursor(next)).toBe(cursorOf(rows[9]!));
    expect(ids(store)).toEqual(rows.slice(0, 20).map((s) => s.sessionId));
  });

  it("a Workspace group's first own page continues from its Agent's cursor on that machine", async () => {
    const rows = activeRun("r", 15, { over: (i) => ({ workspace: i % 2 === 0 ? "/w" : "/x" }) });
    served.set(key(null, "a1"), rows);
    const store = boot();
    await store.getState().reload();
    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "active", "/w");
    expect(fetch.requests).toHaveLength(1);
    expect(batchEntries()[0]!.workspaceGroup).toBe("/w");
    expect(entryCursor(batchEntries()[0]!)).toBe(cursorOf(rows[9]!));
    // Nothing re-read, nothing skipped: the group holds its every row, in order.
    const inW = (s: SessionInfo) => s.workspace === "/w";
    expect(shown(store, ["a1"], "active", "/w", inW)).toEqual(
      rows.filter(inW).map((s) => s.sessionId),
    );
  });

  it("a Workspace group whose Agent's stream is exhausted asks nothing: the pool holds it all", async () => {
    served.set(
      key(null, "a1"),
      activeRun("r", 5, { over: (i) => ({ workspace: i % 2 === 0 ? "/w" : "/x" }) }),
    );
    const store = boot();
    await store.getState().reload();
    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "active", "/w");
    await store.getState().loadMoreFor(["a1"], "active", "/w");
    expect(fetch.requests).toEqual([]);
    expect(watermarkFor(store.getState(), ["a1"], "active", "/w")).toBeNull();
  });

  it("the watermark over two machines is the more recent cursor with more", async () => {
    const here = activeRun("here", 12, { day: 20 });
    const there = activeRun("there", 25, { day: 10 });
    served.set(key(null, "a1"), here);
    served.set(key("M1", "a1"), there);
    // M3 is held but its server does not answer: nothing was read from it, so it bounds
    // nothing, and the rows it left in the cache keep showing.
    rememberMachineSessions("p", "M3", [
      session("cached", { lastActiveAt: "2026-09-25T00:00:00.000Z" }),
    ]);
    const store = boot(["M1", "M3"]);
    await store.getState().reload();
    expect(watermarkFor(store.getState(), ["a1"], "active")).toEqual({
      lastActiveAt: here[9]!.lastActiveAt,
      sessionId: here[9]!.sessionId,
    });
    // The older machine's first page waits below the line: M1's rows are all older than
    // this server's tenth, and this server still has more above them.
    expect(shown(store, ["a1"], "active")).toEqual([
      "cached",
      ...here.slice(0, 10).map((s) => s.sessionId),
    ]);

    // This server runs out; M1's cursor is the line now.
    await store.getState().loadMoreFor(["a1"], "active");
    expect(watermarkFor(store.getState(), ["a1"], "active")?.sessionId).toBe(there[19]!.sessionId);
    expect(shown(store, ["a1"], "active")).toEqual([
      "cached",
      ...here.map((s) => s.sessionId),
      ...there.slice(0, 20).map((s) => s.sessionId),
    ]);

    // Everything read: every row shows.
    await store.getState().loadMoreFor(["a1"], "active");
    expect(watermarkFor(store.getState(), ["a1"], "active")).toBeNull();
    expect(shown(store, ["a1"], "active")).toHaveLength(1 + 12 + 25);
  });

  it("a folder pages in activity order: an archived conversation resumed yesterday lists first", async () => {
    // archived-00 was created first and resumed last; creation order would bury it.
    const archived = activeRun("archived", 12, { over: () => ({ archived: true }) });
    served.set(key(null, "a1"), [
      session("own", { createdAt: "2026-09-30T00:00:00.000Z" }),
      ...archived,
    ]);
    const store = boot();
    await store.getState().reload();
    fetch.requests.length = 0;
    await store.getState().loadMoreFor(["a1"], "archived");
    expect(batchEntries()[0]).toMatchObject({ category: "archived", order: "activity" });
    expect(shown(store, ["a1"], "archived")).toEqual(archived.slice(0, 10).map((s) => s.sessionId));
    await store.getState().loadMoreFor(["a1"], "archived");
    // The second request continues below the tenth row — its cursor, not the overflow row's.
    expect(entryCursor(batchEntries()[1]!)).toBe(cursorOf(archived[9]!));
    expect(shown(store, ["a1"], "archived")).toEqual(archived.map((s) => s.sessionId));
  });
});

describe("a Session that becomes active", () => {
  const NOW = "2026-09-30T08:00:00.000Z";
  const LATER = "2026-09-30T08:05:00.000Z";

  it("moves up in place, without a request, when its row is loaded", async () => {
    const rows = activeRun("r", 15);
    served.set(key(null, "a1"), rows);
    const store = boot();
    await store.getState().reload();
    fetch.requests.length = 0;
    applyUserEvent(store, sessionState("r-08", NOW), () => undefined);
    expect(fetch.requests).toEqual([]);
    expect(shown(store, ["a1"], "active")[0]).toBe("r-08");
  });

  it("is fetched from the machine that announced it, and shows at the top", async () => {
    const here = activeRun("here", 12, { day: 20 });
    const there = activeRun("there", 12, { day: 19 });
    served.set(key(null, "a1"), here);
    served.set(key("M1", "a1"), there);
    const store = boot(["M1"]);
    await store.getState().reload();
    expect(ids(store)).not.toContain("there-11");
    fetch.requests.length = 0;

    // Resumed from the CLI on M1: it moves above every cursor, so no page will serve it.
    there[11]!.lastActiveAt = NOW;
    applyUserEvent(store, sessionState("there-11", NOW), () => undefined, "M1");
    expect(sessionLookups().map((r) => [r.machine, r.path])).toEqual([
      ["M1", "/api/sessions/there-11"],
    ]);
    await adopted(store, "there-11", "M1", NOW);
    expect(machineForSession("there-11")).toBe("M1");
    expect(shown(store, ["a1"], "active")[0]).toBe("there-11");
  });

  it("one run's flips share one lookup, and the newest flip lands on the row", async () => {
    const rows = activeRun("r", 12);
    served.set(key(null, "a1"), rows);
    const store = boot();
    await store.getState().reload();
    fetch.requests.length = 0;
    // The lookup reads the row while it runs; the run ends before the answer arrives.
    rows[11]!.lastActiveAt = NOW;
    rows[11]!.status = "running";
    applyUserEvent(store, sessionState("r-11", NOW, "running"), () => undefined);
    applyUserEvent(store, sessionState("r-11", LATER, "idle"), () => undefined);
    expect(sessionLookups()).toHaveLength(1);
    await adopted(store, "r-11", null, LATER, "idle");
    expect(sessionLookups()).toHaveLength(1);
    const row = store.getState().sessions.find((s) => s.sessionId === "r-11");
    expect(row?.status).toBe("idle");
    expect(row?.lastActiveAt).toBe(LATER);
  });

  it("another Project's flip is only remembered", () => {
    const store = boot();
    applyUserEvent(store, sessionState("elsewhere", NOW, "running", "other"), () => undefined);
    expect(fetch.requests).toEqual([]);
    expect(store.getState().liveStatuses.get("elsewhere")).toBe("running");
  });

  it("an organization's Session, an id deleted here and an id that is gone are never listed, nor asked about twice", async () => {
    served.set(key(null, "a1"), [session("desk", { client: "org", lastActiveAt: NOW })]);
    const store = boot();
    store.setState({ sessions: [session("doomed")] });
    store.getState().remove("doomed");
    const all = ["desk", "doomed", "vanished"];
    for (const id of all) applyUserEvent(store, sessionState(id, NOW), () => undefined);
    expect(sessionLookups().map((r) => r.path)).toEqual([
      "/api/sessions/desk",
      "/api/sessions/vanished",
    ]);
    await Promise.all(all.map((id) => adopted(store, id, null, NOW)));
    for (const id of all) applyUserEvent(store, sessionState(id, LATER, "idle"), () => undefined);
    expect(sessionLookups()).toHaveLength(2);
    expect(ids(store)).toEqual([]);
  });

  it("a reload already running when it was fetched keeps it", async () => {
    const rows = activeRun("r", 3);
    served.set(key(null, "a1"), rows);
    const store = boot();
    await store.getState().reload();
    // The next reload's pages are read now, before the Session runs, and land only later.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    fetch.answer(async (request) => {
      if (!request.path.endsWith("/sessions")) return serve(request);
      const page = await serve(request);
      await gate;
      return page;
    });
    const reloading = store.getState().reload();
    rows.push(session("fresh", { lastActiveAt: NOW }));
    applyUserEvent(store, sessionState("fresh", NOW), () => undefined);
    expect(sessionLookups()).toHaveLength(1);
    await adopted(store, "fresh", null, NOW);
    expect(ids(store)).toContain("fresh");
    release();
    await reloading;
    expect(ids(store)[0]).toBe("fresh");
  });
});

/** A seeded linear congruential generator: deterministic runs whose failures name their seed. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("property: every list is a prefix of its activity order, and loads only append", () => {
  /** One list the sidebar draws, as the sidebar builds it. */
  interface List {
    name: string;
    agents: string[];
    group?: string;
    /** Whether a row on `source` belongs to the list. */
    holds: (s: SessionInfo, source: string | null) => boolean;
  }

  const STAMPS = [1, 2, 3, 5, 8, 13].map(
    (d) => `2026-09-${String(d).padStart(2, "0")}T00:00:00.000Z`,
  );
  const WORKSPACES = ["/w1", "/w2", "/w3"];

  it(
    "holds over 100 seeded runs of loads, live flips and reloads",
    { timeout: 120_000 },
    async () => {
      for (let seed = 1; seed <= 100; seed += 1) {
        served.clear();
        forgetSessionMachines();
        fetch.requests.length = 0;
        const rand = lcg(seed);
        const int = (n: number) => Math.floor(rand() * n);
        const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;

        const agents = ["a1", "a2", "a3"].slice(0, 1 + int(3));
        const sources: (string | null)[] = rand() < 0.5 ? [null] : [null, "M1"];
        let n = 0;
        for (const source of sources) {
          for (const agentId of agents) {
            served.set(
              key(source, agentId),
              Array.from({ length: int(26) }, () =>
                session(`s${String(n++).padStart(3, "0")}${pick(["a", "B", "c", "D"])}`, {
                  agentId,
                  workspace: pick(WORKSPACES),
                  lastActiveAt: pick(STAMPS),
                  createdAt: pick(STAMPS),
                }),
              ),
            );
          }
        }
        /** Every server row with the machine it is on. */
        const serverRows = () =>
          sources.flatMap((source) =>
            agents.flatMap((agentId) =>
              (served.get(key(source, agentId)) ?? []).map((row) => ({ row, source })),
            ),
          );
        let clock = Date.parse("2026-09-20T00:00:00.000Z");

        const store = boot(sources.includes("M1") ? ["M1"] : [], [], agents);
        await store.getState().reload();

        /** The lists on screen in each grouping mode: time mode's, each Agent's, each Workspace's. */
        const lists = (): List[] => {
          const state = store.getState();
          const wsCounts = aggregateWorkspaceCounts(state.workspaceCountsByAgent);
          const out: List[] = [
            {
              name: "time",
              agents: [...state.countsByAgent]
                .filter(([, counts]) => counts.active > 0)
                .map(([agentId]) => agentId),
              holds: () => true,
            },
            ...agents.map((agentId) => ({
              name: `agent ${agentId}`,
              agents: [agentId],
              holds: (s: SessionInfo) => s.agentId === agentId,
            })),
          ];
          for (const source of sources) {
            for (const path of WORKSPACES) {
              const group = workspaceGroupKey(path, source);
              const contributing = state.sessions
                .filter(
                  (s) => workspaceGroupKey(s.workspace, machineForSession(s.sessionId)) === group,
                )
                .map((s) => s.agentId);
              out.push({
                name: `workspace ${group.replace("\0", ":")}`,
                agents: [
                  ...new Set([...(wsCounts.get(group)?.agents.active ?? []), ...contributing]),
                ],
                group,
                holds: (s, rowSource) => s.workspace === path && rowSource === source,
              });
            }
          }
          return out;
        };
        /** What a list shows. */
        const view = (list: List) => {
          const state = store.getState();
          const rows = state.sessions.filter(
            (s) => sessionCategory(s) === "active" && list.holds(s, machineForSession(s.sessionId)),
          );
          return cutAtWatermark(rows, watermarkFor(state, list.agents, "active", list.group));
        };
        /** The list's true order, from the servers' rows as they stand. */
        const truth = (list: List) =>
          serverRows()
            .filter(({ row, source }) => list.holds(row, source))
            .map(({ row }) => row)
            .sort(compareActivityDesc)
            .map((s) => s.sessionId);

        const say = (step: number, what: string, list: List) =>
          `seed ${seed}, step ${step} (${what}), list ${list.name}`;
        const expectPrefixes = (step: number, what: string) => {
          for (const list of lists()) {
            const shownIds = view(list).map((s) => s.sessionId);
            expect(shownIds, say(step, what, list)).toEqual(truth(list).slice(0, shownIds.length));
          }
        };

        expectPrefixes(0, "first load");
        for (let step = 1; step <= 25; step += 1) {
          const roll = rand();
          if (roll < 0.55) {
            const target = pick(lists());
            const before = new Map(lists().map((list) => [list.name, view(list)]));
            await store.getState().loadMoreFor(target.agents, "active", target.group);
            expectPrefixes(step, `load ${target.name}`);
            for (const list of lists()) {
              const was = before.get(list.name)!;
              const now = view(list);
              const message = say(step, `load ${target.name}`, list);
              // Append-only: what was shown still leads, and every new row sits below it.
              expect(
                now.slice(0, was.length).map((s) => s.sessionId),
                message,
              ).toEqual(was.map((s) => s.sessionId));
              const floor = was.at(-1);
              if (floor !== undefined) {
                for (const row of now.slice(was.length)) {
                  expect(compareActivityDesc(row, floor), message).toBeGreaterThan(0);
                }
              }
              // Progress: the list asked shows a page more, or the rest.
              if (list.name === target.name) {
                const remaining = truth(list).length - was.length;
                expect(now.length - was.length, message).toBeGreaterThanOrEqual(
                  Math.min(SIDEBAR_PAGE_SIZE, remaining),
                );
              }
            }
          } else if (roll < 0.95) {
            const all = serverRows();
            if (all.length === 0) continue;
            const { row, source } = pick(all);
            clock += 60_000;
            row.lastActiveAt = new Date(clock).toISOString();
            const loaded = store.getState().sessions.some((s) => s.sessionId === row.sessionId);
            const lookups = sessionLookups().length;
            applyUserEvent(
              store,
              sessionState(row.sessionId, row.lastActiveAt),
              () => undefined,
              source,
            );
            // A loaded row moves in place; an unloaded one is looked up, on its own machine.
            expect(sessionLookups().slice(lookups), `seed ${seed}, step ${step}`).toEqual(
              loaded
                ? []
                : [
                    expect.objectContaining({
                      machine: source,
                      path: `/api/sessions/${row.sessionId}`,
                    }),
                  ],
            );
            await adopted(store, row.sessionId, source, row.lastActiveAt);
            expectPrefixes(step, `flip ${row.sessionId}`);
          } else {
            await store.getState().reload();
            expectPrefixes(step, "reload");
          }
        }
      }
    },
  );
});

describe("live statuses outlive the rows", () => {
  const STAMP = "2026-09-16T09:05:00.000Z";
  const stateEvent = (sessionId: string, state: "running" | "idle"): ServerEvent => ({
    type: "session_state",
    sessionId,
    projectId: "p",
    state,
    lastActiveAt: STAMP,
    hasTrace: true,
  });
  const live = (store: ReturnType<typeof boot>) =>
    liveSessionStatuses(store.getState().sessions, store.getState().liveStatuses);

  it("remembers a session_state for a Session no loaded page holds, without inventing a row", async () => {
    // An organization's desk: this Project's, so it is looked up — and never listed.
    served.set(key(null, "a1"), [session("s-desk", { client: "org", orgId: "acme" })]);
    const store = boot();
    store.setState({ sessions: [session("own")] });
    applyUserEvent(store, stateEvent("s-desk", "running"), () => undefined);
    await store.getState().adoptLiveSession("s-desk", null, "running", {
      lastActiveAt: STAMP,
      hasTrace: true,
    });
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
