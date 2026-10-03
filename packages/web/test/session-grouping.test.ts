/**
 * How the chat sidebar groups Sessions (lib/session-grouping.ts): by Workspace, by time
 * bucket, and into the folders under each group.
 *
 * - A temporary Workspace (`…/workspaces/<dir>` of an Agent, or an empty path) is recognized
 *   on either path separator; near misses and nested directories are not.
 * - A group key is the trimmed path, or one shared sentinel for every temporary Workspace; a
 *   machine's directory keys under that machine and splits back into machine and path, while
 *   the server query carries the path only. A label is the path's last segment.
 * - Grouping by Workspace merges Agents on one path (newest Session first, newest group first),
 *   folds every temporary Workspace into one trailing group per machine, keeps one path on two
 *   machines apart, and keeps archived rows in their group.
 * - A Session's folder is decided by archived first, then its source; partitioning keeps the
 *   order inside each folder, and the Test Sessions an evaluation starts get a folder of their
 *   own while the evaluation conversation stays an active row.
 * - The auto-opened "last conversation" is the most recently active user or scheduled row
 *   (ties by id), never an archived, subagent or benchmark one.
 * - A page fetched with one extra row reports whether the server has more, never showing it.
 * - Server counts sum per Workspace across Agents (recording which Agents hold each folder) and
 *   stay apart per machine; the newest stamp per group survives aggregation.
 * - Pinned items come first, each partition keeping its order; unknown pins are ignored.
 * - Title search is a case-insensitive substring match; a blank query matches everything and
 *   an untitled Session matches no non-blank query.
 * - Time buckets cut at 24 hours and 30 days on last activity, skewed stamps land newest and
 *   unreadable ones oldest, empty buckets are dropped, and bucket keys never collide with a
 *   path or an Agent id.
 * - Every counted Workspace becomes a group (empty when none of its rows loaded), placed by
 *   the newer of its stamp and its loaded rows, the temp group last; a count of zero forms none.
 * - The activity order is last activity, then id, both by code point — where a locale's
 *   collation would rank case or punctuation the other way, it does not follow it.
 * - A merged list's watermark is the most recent cursor among the streams with more; a stream
 *   with nothing read, or nothing left, bounds nothing. The cut keeps the rows at or above it
 *   and the open conversation wherever it falls; no watermark keeps every row.
 * - Property (seeded, 200 runs): over 1–4 streams paged by cursor, with live flips moving rows
 *   up (a loaded one in place, an unloaded one fetched), the cut list is always a prefix of the
 *   true order; a load only appends below it, and loading every stream with more shows at
 *   least a page more, or the rest.
 */
import { describe, expect, it } from "vitest";
import type { SessionCategoryCounts, SessionInfo } from "@prismshadow/penguin-server/api";
import type { ActivityKey, StreamPosition } from "../src/lib/session-grouping";
import {
  SIDEBAR_PAGE_SIZE,
  TEMP_WORKSPACE_GROUP_KEY,
  TIME_BUCKETS,
  TIME_FOLDERS_GROUP_KEY,
  aggregateWorkspaceCounts,
  aggregateWorkspaceLatest,
  activityCursorParam,
  activityWatermark,
  compareActivityDesc,
  completeWorkspaceGroups,
  cutAtWatermark,
  matchesSessionQuery,
  groupSessionsByTime,
  groupSessionsByWorkspace,
  isTempWorkspace,
  latestConversation,
  partitionSessions,
  pinnedFirst,
  sessionCategory,
  splitPage,
  timeBucketOf,
  timeGroupKey,
  totalCategoryCounts,
  workspaceGroupKey,
  workspaceGroupMachine,
  workspaceGroupPath,
  workspaceGroupQuery,
  workspaceLabel,
} from "../src/lib/session-grouping";

let seq = 0;
function session(
  workspace: string,
  createdAt: string,
  over: {
    sessionId?: string;
    agentId?: string;
    archived?: boolean;
    source?: "schedule" | "subagent" | "benchmark";
    lastActiveAt?: string;
  } = {},
): SessionInfo {
  seq += 1;
  return {
    sessionId: over.sessionId ?? `session-${seq}`,
    projectId: "proj",
    agentId: over.agentId ?? "default_agent",
    provider: "custom",
    modelId: "claude-4-8",
    workspace,
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    createdAt,
    lastActiveAt: over.lastActiveAt ?? createdAt,
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: false,
    archived: over.archived ?? false,
    ...(over.source !== undefined ? { source: over.source } : {}),
  };
}

const TEMP_A = "/data/proj/agents/default_agent/workspaces/tmp-1a2b3c4d";
const TEMP_B = "/data/proj/agents/agent_helper/workspaces/tmp-00ff00aa";
/** A machine's own id, as one mints for itself: 16 base64url characters. */
const MACHINE = "noeSE0FFHhNXl2J5";

describe("isTempWorkspace (temporary-workspace pattern from core's createTempWorkspace)", () => {
  it("matches <...>/workspaces/tmp-<8hex> with either path separator, and the empty path", () => {
    expect(isTempWorkspace(TEMP_A)).toBe(true);
    expect(isTempWorkspace("C:\\pg\\data\\proj\\agents\\a\\workspaces\\tmp-00ff00aa")).toBe(true);
    expect(isTempWorkspace("")).toBe(true);
    expect(isTempWorkspace("   ")).toBe(true);
  });

  it("matches any directory directly under an Agent's workspaces/ — the evaluation Skill's Test Workspaces", () => {
    expect(
      isTempWorkspace("/pg/data/proj/agents/a/workspaces/eval-example-benchmark-case-1-run-1"),
    ).toBe(true);
    expect(isTempWorkspace("C:\\pg\\data\\proj\\agents\\a\\workspaces\\run-7")).toBe(true);
    // A directory below one of them is not itself such a Workspace, and a workspaces/
    // directory that is not an Agent's is a user directory that just looks similar.
    expect(isTempWorkspace("/pg/data/proj/agents/a/workspaces/run-7/nested")).toBe(false);
    expect(isTempWorkspace("/srv/repo/workspaces/run-7")).toBe(false);
    expect(isTempWorkspace("/pg/data/proj/agents/a/workspaces")).toBe(false);
  });

  it("rejects named directories and near misses", () => {
    expect(isTempWorkspace("/srv/repo")).toBe(false);
    // tmp-<8hex> without a workspaces/ parent is a user directory that just looks similar
    expect(isTempWorkspace("/srv/tmp-1a2b3c4d")).toBe(false);
    // non-hex / wrong-length ids
    expect(isTempWorkspace("/x/workspaces/tmp-XYZWQPRS")).toBe(false);
    expect(isTempWorkspace("/x/workspaces/tmp-1a2b3c4")).toBe(false);
    expect(isTempWorkspace("/x/workspaces/tmp-1a2b3c4d5")).toBe(false);
    // a subdirectory below a temporary workspace is not itself the temporary workspace
    expect(isTempWorkspace(`${TEMP_A}/nested`)).toBe(false);
  });
});

describe("workspaceGroupKey / workspaceLabel", () => {
  it("named paths key by the (trimmed) path itself; temp and empty paths share the sentinel", () => {
    expect(workspaceGroupKey("/srv/repo")).toBe("/srv/repo");
    expect(workspaceGroupKey(" /srv/repo ")).toBe("/srv/repo");
    expect(workspaceGroupKey(TEMP_A)).toBe(TEMP_WORKSPACE_GROUP_KEY);
    expect(workspaceGroupKey("")).toBe(TEMP_WORKSPACE_GROUP_KEY);
  });

  it("a machine's directory keys under that machine, and this server keys as it always did", () => {
    // The same path on two machines is two different directories. Absence keeps meaning
    // "here", which is what every key already persisted in a browser was written as.
    expect(workspaceGroupKey("/srv/repo", MACHINE)).toBe(`${MACHINE}\u0000/srv/repo`);
    expect(workspaceGroupKey("/srv/repo", null)).toBe("/srv/repo");
    expect(workspaceGroupKey("/srv/repo", MACHINE)).not.toBe(workspaceGroupKey("/srv/repo"));
    expect(workspaceGroupKey(TEMP_A, MACHINE)).toBe(`${MACHINE}\u0000${TEMP_WORKSPACE_GROUP_KEY}`);
  });

  it("a key splits back into the machine that holds it and the workspace half", () => {
    expect(workspaceGroupMachine(workspaceGroupKey("/srv/repo", MACHINE))).toBe(MACHINE);
    expect(workspaceGroupMachine(workspaceGroupKey(TEMP_A, MACHINE))).toBe(MACHINE);
    expect(workspaceGroupMachine("/srv/repo")).toBeNull();
    expect(workspaceGroupMachine(TEMP_WORKSPACE_GROUP_KEY)).toBeNull();
    expect(workspaceGroupPath(workspaceGroupKey("/srv/repo", MACHINE))).toBe("/srv/repo");
    expect(workspaceGroupPath(workspaceGroupKey(TEMP_A, MACHINE))).toBe(TEMP_WORKSPACE_GROUP_KEY);
  });

  it("the server query drops the machine half — the request already goes to that machine", () => {
    expect(workspaceGroupQuery(workspaceGroupKey("/srv/repo", MACHINE))).toBe("/srv/repo");
    expect(workspaceGroupQuery(workspaceGroupKey(TEMP_A, MACHINE))).toBe("temp");
    expect(workspaceGroupQuery("/srv/repo")).toBe("/srv/repo");
    expect(workspaceGroupQuery(TEMP_WORKSPACE_GROUP_KEY)).toBe("temp");
  });

  it("labels are the last path segment; the filesystem root yields '/'", () => {
    expect(workspaceLabel("/srv/penguin/repo")).toBe("repo");
    expect(workspaceLabel("/srv/repo/")).toBe("repo");
    expect(workspaceLabel("/")).toBe("/");
    expect(workspaceLabel("C:\\work\\site")).toBe("site");
  });
});

describe("groupSessionsByWorkspace", () => {
  it("empty input yields no groups", () => {
    expect(groupSessionsByWorkspace([])).toEqual([]);
  });

  it("groups by path across Agents, labels by basename, and keeps the full path for tooltips", () => {
    const a1 = session("/srv/alpha", "2026-07-01T10:00:00.000Z", { agentId: "default_agent" });
    const a2 = session("/srv/alpha", "2026-07-03T10:00:00.000Z", { agentId: "agent_helper" });
    const groups = groupSessionsByWorkspace([a1, a2]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "/srv/alpha",
      label: "alpha",
      fullPath: "/srv/alpha",
      temp: false,
    });
    // Newest first even though the two sessions came from different Agents' lists.
    expect(groups[0]!.sessions.map((s) => s.sessionId)).toEqual([a2.sessionId, a1.sessionId]);
  });

  it("merges every temporary Workspace into one trailing group, after named groups sorted by newest session", () => {
    const oldAlpha = session("/srv/alpha", "2026-07-01T10:00:00.000Z");
    const newAlpha = session("/srv/alpha", "2026-07-06T10:00:00.000Z");
    const beta = session("/srv/beta", "2026-07-05T10:00:00.000Z");
    const temp1 = session(TEMP_A, "2026-07-02T10:00:00.000Z");
    // The newest session overall is a temp one: the temp group still stays last.
    const temp2 = session(TEMP_B, "2026-07-07T10:00:00.000Z");
    const groups = groupSessionsByWorkspace([oldAlpha, beta, temp1, newAlpha, temp2]);
    expect(groups.map((g) => g.key)).toEqual(["/srv/alpha", "/srv/beta", TEMP_WORKSPACE_GROUP_KEY]);
    const temp = groups[2]!;
    expect(temp).toMatchObject({ temp: true, label: "", fullPath: null });
    expect(temp.sessions.map((s) => s.sessionId)).toEqual([temp2.sessionId, temp1.sessionId]);
    expect(groups[0]!.sessions.map((s) => s.sessionId)).toEqual([
      newAlpha.sessionId,
      oldAlpha.sessionId,
    ]);
  });

  it("named-only input has no temp group; temp-only input yields just the temp group", () => {
    expect(
      groupSessionsByWorkspace([session("/srv/alpha", "2026-07-01T10:00:00.000Z")]),
    ).toHaveLength(1);
    const tempOnly = groupSessionsByWorkspace([session(TEMP_A, "2026-07-01T10:00:00.000Z")]);
    expect(tempOnly).toHaveLength(1);
    expect(tempOnly[0]!.key).toBe(TEMP_WORKSPACE_GROUP_KEY);
  });

  it("splits one path across machines into one group each, and names the machine on the group", () => {
    // The sidebar's "+" opens a chat in the group's directory: one merged group would open
    // it here, in whatever this machine happens to have at that path.
    const here = session("/srv/app", "2026-07-01T10:00:00.000Z");
    const there = session("/srv/app", "2026-07-02T10:00:00.000Z");
    const groups = groupSessionsByWorkspace([here, there], (s) =>
      s.sessionId === there.sessionId ? MACHINE : null,
    );
    expect(groups.map((g) => g.key)).toEqual([`${MACHINE}\u0000/srv/app`, "/srv/app"]);
    expect(groups[0]).toMatchObject({ machineId: MACHINE, label: "app", fullPath: "/srv/app" });
    expect(groups[1]).toMatchObject({ machineId: null, label: "app", fullPath: "/srv/app" });
  });

  it("keeps each machine's temporary workspaces in its own temp group", () => {
    const here = session(TEMP_A, "2026-07-01T10:00:00.000Z");
    const there = session(TEMP_B, "2026-07-02T10:00:00.000Z");
    const groups = groupSessionsByWorkspace([here, there], (s) =>
      s.sessionId === there.sessionId ? MACHINE : null,
    );
    expect(groups.map((g) => g.key)).toEqual([
      `${MACHINE}\u0000${TEMP_WORKSPACE_GROUP_KEY}`,
      TEMP_WORKSPACE_GROUP_KEY,
    ]);
    expect(groups.every((g) => g.temp)).toBe(true);
  });

  it("keeps archived sessions in their group (the sidebar splits active/archived per group)", () => {
    const active = session("/srv/alpha", "2026-07-02T10:00:00.000Z");
    const archived = session("/srv/alpha", "2026-07-01T10:00:00.000Z", { archived: true });
    const groups = groupSessionsByWorkspace([archived, active]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sessions).toHaveLength(2);
  });
});

describe("sessionCategory (the bucket a Session renders under = the server's list filter)", () => {
  it("archived wins over source; a source names its bucket; no source is active", () => {
    const at = "2026-07-01T10:00:00.000Z";
    expect(sessionCategory(session("/srv/a", at))).toBe("active");
    expect(sessionCategory(session("/srv/a", at, { source: "subagent" }))).toBe("subagent");
    expect(sessionCategory(session("/srv/a", at, { source: "schedule" }))).toBe("schedule");
    expect(sessionCategory(session("/srv/a", at, { archived: true }))).toBe("archived");
    expect(sessionCategory(session("/srv/a", at, { source: "subagent", archived: true }))).toBe(
      "archived",
    );
  });
});

describe("partitionSessions (per-group user / subagent / scheduled / evaluations / archived split)", () => {
  it("splits user rows and one bucket per origin, preserving order within each part", () => {
    const user1 = session("/srv/alpha", "2026-07-06T10:00:00.000Z");
    const sched1 = session("/srv/alpha", "2026-07-05T10:00:00.000Z", { source: "schedule" });
    const sub1 = session("/srv/alpha", "2026-07-04T10:00:00.000Z", { source: "subagent" });
    const user2 = session("/srv/alpha", "2026-07-03T10:00:00.000Z");
    const sub2 = session("/srv/alpha", "2026-07-02T10:00:00.000Z", { source: "subagent" });
    const gone = session("/srv/alpha", "2026-07-01T10:00:00.000Z", { archived: true });
    const parts = partitionSessions([user1, sched1, sub1, user2, sub2, gone]);
    expect(parts.active.map((s) => s.sessionId)).toEqual([user1.sessionId, user2.sessionId]);
    expect(parts.subagent.map((s) => s.sessionId)).toEqual([sub1.sessionId, sub2.sessionId]);
    expect(parts.schedule.map((s) => s.sessionId)).toEqual([sched1.sessionId]);
    expect(parts.archived.map((s) => s.sessionId)).toEqual([gone.sessionId]);
  });

  it("archived wins over source: an archived automation-created session goes to the Archived folder only", () => {
    const sub = session("/srv/alpha", "2026-07-01T10:00:00.000Z", {
      source: "subagent",
      archived: true,
    });
    const sched = session("/srv/alpha", "2026-07-02T10:00:00.000Z", {
      source: "schedule",
      archived: true,
    });
    const parts = partitionSessions([sub, sched]);
    expect(parts.subagent).toEqual([]);
    expect(parts.schedule).toEqual([]);
    expect(parts.archived.map((s) => s.sessionId)).toEqual([sub.sessionId, sched.sessionId]);
    expect(parts.active).toEqual([]);
  });

  it("empty input yields five empty parts", () => {
    expect(partitionSessions([])).toEqual({
      active: [],
      subagent: [],
      schedule: [],
      benchmark: [],
      archived: [],
    });
  });
});

describe("latestConversation (the auto-opened 'last conversation')", () => {
  it("picks the most recently active active/schedule row regardless of input order; archived and subagent rows never win", () => {
    // Created first but returned to since: this is the conversation the user was last in,
    // and the one created last is not.
    const revisited = session("/srv/a", "2026-07-01T10:00:00.000Z", {
      lastActiveAt: "2026-07-06T10:00:00.000Z",
    });
    const newerUntouched = session("/srv/a", "2026-07-03T10:00:00.000Z");
    // Active more recently than every conversation, but never auto-opened:
    const subAfter = session("/srv/a", "2026-07-08T10:00:00.000Z", { source: "subagent" });
    const goneAfter = session("/srv/a", "2026-07-09T10:00:00.000Z", { archived: true });
    expect(latestConversation([subAfter, newerUntouched, goneAfter, revisited])).toBe(revisited);

    // A schedule-created run is the user's conversation: the most recently active one qualifies.
    const schedAfter = session("/srv/a", "2026-07-05T10:00:00.000Z", {
      lastActiveAt: "2026-07-07T10:00:00.000Z",
      source: "schedule",
    });
    expect(latestConversation([revisited, schedAfter, subAfter])).toBe(schedAfter);
  });

  it("ties on lastActiveAt break by sessionId, and no qualifying row yields null", () => {
    const at = "2026-07-02T10:00:00.000Z";
    const a = session("/srv/a", at, { sessionId: "session-a" });
    const b = session("/srv/a", at, { sessionId: "session-b" });
    expect(latestConversation([a, b])).toBe(b);
    expect(latestConversation([b, a])).toBe(b);
    expect(latestConversation([])).toBeNull();
    expect(latestConversation([session("/srv/a", at, { source: "subagent" })])).toBeNull();
  });
});

describe("benchmark Sessions (the Test Sessions an evaluation starts)", () => {
  it("files a Test Session into the Evaluations folder and never auto-opens it, while the evaluation conversation stays an active row", () => {
    // The conversation the Evaluation Center's Use dialog opened carries no source; the Test
    // Session it launched for a Case × Run (`penguin run --source benchmark`) ran after it.
    const evaluation = session("/srv/a", "2026-07-02T10:00:00.000Z");
    const run = session("/srv/a", "2026-07-08T10:00:00.000Z", { source: "benchmark" });
    const parts = partitionSessions([run, evaluation]);
    expect(parts.benchmark.map((s) => s.sessionId)).toEqual([run.sessionId]);
    expect(parts.active.map((s) => s.sessionId)).toEqual([evaluation.sessionId]);
    // The conversation the user was last in is the evaluation they sent, not a run it launched.
    expect(latestConversation([run, evaluation])).toBe(evaluation);
  });
});

describe("splitPage (limit+1 fetch trick)", () => {
  it("an overflow row proves the server has more and is never shown", () => {
    const fetched = [1, 2, 3, 4];
    expect(splitPage(fetched, 3)).toEqual({ items: [1, 2, 3], hasMore: true });
  });

  it("a short or exactly-full page means the server is exhausted", () => {
    expect(splitPage([1, 2], 3)).toEqual({ items: [1, 2], hasMore: false });
    expect(splitPage([1, 2, 3], 3)).toEqual({ items: [1, 2, 3], hasMore: false });
    expect(splitPage([], SIDEBAR_PAGE_SIZE)).toEqual({ items: [], hasMore: false });
  });
});

describe("aggregateWorkspaceCounts (per-group exact server share)", () => {
  const zero = { active: 0, subagent: 0, schedule: 0, benchmark: 0, archived: 0 };

  it("sums each Workspace path across Agents and records which Agents hold each category", () => {
    const byAgent = new Map<string, Record<string, SessionCategoryCounts>>([
      [
        "agent_a",
        {
          "/srv/alpha": { ...zero, active: 2, subagent: 1 },
          "/srv/beta": { ...zero, archived: 3 },
        },
      ],
      ["agent_b", { "/srv/alpha": { ...zero, active: 1, schedule: 2 } }],
    ]);
    const groups = aggregateWorkspaceCounts(byAgent);
    expect(groups.get("/srv/alpha")).toEqual({
      totals: { active: 3, subagent: 1, schedule: 2, benchmark: 0, archived: 0 },
      agents: {
        active: ["agent_a", "agent_b"],
        subagent: ["agent_a"],
        schedule: ["agent_b"],
        benchmark: [],
        archived: [],
      },
    });
    expect(groups.get("/srv/beta")).toEqual({
      totals: { ...zero, archived: 3 },
      agents: {
        active: [],
        subagent: [],
        schedule: [],
        benchmark: [],
        archived: ["agent_a"],
      },
    });
    // A group only in another Workspace never appears — its content can't surface elsewhere.
    expect(groups.has("/srv/gamma")).toBe(false);
    expect(aggregateWorkspaceCounts(new Map()).size).toBe(0);
  });

  it("sums the temp group's paths, which the store has already folded onto its key", () => {
    const byAgent = new Map([
      [
        "agent_a",
        {
          [TEMP_WORKSPACE_GROUP_KEY]: { ...zero, active: 3, archived: 1 },
        },
      ],
    ]);
    const groups = aggregateWorkspaceCounts(byAgent);
    expect(groups.size).toBe(1);
    expect(groups.get(TEMP_WORKSPACE_GROUP_KEY)).toEqual({
      totals: { ...zero, active: 3, archived: 1 },
      agents: {
        active: ["agent_a"],
        subagent: [],
        schedule: [],
        benchmark: [],
        archived: ["agent_a"],
      },
    });
  });

  it("counts one path on two machines as two groups (one badge each, matching its own rows)", () => {
    const byAgent = new Map<string, Record<string, SessionCategoryCounts>>([
      [
        "agent_a",
        {
          "/srv/app": { ...zero, active: 2 },
          [`${MACHINE}\u0000/srv/app`]: { ...zero, active: 5 },
        },
      ],
    ]);
    const groups = aggregateWorkspaceCounts(byAgent);
    expect(groups.get("/srv/app")?.totals.active).toBe(2);
    expect(groups.get(`${MACHINE}\u0000/srv/app`)?.totals.active).toBe(5);
  });
});

describe("pinnedFirst (stable pinned-before-unpinned partition)", () => {
  const items = [{ k: "a" }, { k: "b" }, { k: "c" }, { k: "d" }];
  const keyOf = (i: { k: string }) => i.k;
  const keys = (out: { k: string }[]) => out.map((i) => i.k);

  it("empty pinned set keeps the order (and returns a copy, never the input array)", () => {
    const out = pinnedFirst(items, keyOf, new Set());
    expect(keys(out)).toEqual(["a", "b", "c", "d"]);
    expect(out).not.toBe(items);
  });

  it("pinned items move to the front, each partition preserving the input order", () => {
    expect(keys(pinnedFirst(items, keyOf, new Set(["c", "a"])))).toEqual(["a", "c", "b", "d"]);
    expect(keys(pinnedFirst(items, keyOf, new Set(["d"])))).toEqual(["d", "a", "b", "c"]);
  });

  it("pinned keys with no matching item are ignored; all-pinned keeps the order", () => {
    expect(keys(pinnedFirst(items, keyOf, new Set(["nope"])))).toEqual(["a", "b", "c", "d"]);
    expect(keys(pinnedFirst(items, keyOf, new Set(["a", "b", "c", "d"])))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("pinning the merged temp group lifts it above named workspace groups", () => {
    const groups = groupSessionsByWorkspace([
      session("/srv/alpha", "2026-07-02T10:00:00.000Z"),
      session(TEMP_A, "2026-07-01T10:00:00.000Z"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["/srv/alpha", TEMP_WORKSPACE_GROUP_KEY]);
    const pinned = pinnedFirst(groups, (g) => g.key, new Set([TEMP_WORKSPACE_GROUP_KEY]));
    expect(pinned.map((g) => g.key)).toEqual([TEMP_WORKSPACE_GROUP_KEY, "/srv/alpha"]);
  });

  it("agent-mode ordering: pinned agentIds lift agents, the unpinned keep the configured order", () => {
    // The sidebar's agent mode partitions the Project's Agent list (agentId is the group key).
    const agents = [{ agentId: "default_agent" }, { agentId: "agent_a" }, { agentId: "agent_b" }];
    const byId = (a: { agentId: string }) => a.agentId;
    expect(pinnedFirst(agents, byId, new Set(["agent_b"])).map(byId)).toEqual([
      "agent_b",
      "default_agent",
      "agent_a",
    ]);
    // Multiple pinned Agents keep their relative configured order inside the pinned partition.
    expect(pinnedFirst(agents, byId, new Set(["agent_b", "default_agent"])).map(byId)).toEqual([
      "default_agent",
      "agent_b",
      "agent_a",
    ]);
  });
});

describe("matchesSessionQuery (sidebar live title search)", () => {
  const titled = (title: string): SessionInfo => ({
    ...session("/w", "2026-08-13T00:00:00Z"),
    title,
  });

  it("matches case-insensitive substrings of the title, ignoring surrounding whitespace in the query", () => {
    const s = titled("Fix login bug");
    expect(matchesSessionQuery(s, "login")).toBe(true);
    expect(matchesSessionQuery(s, "FIX")).toBe(true);
    expect(matchesSessionQuery(s, "  bug  ")).toBe(true);
    expect(matchesSessionQuery(s, "logout")).toBe(false);
  });

  it("a blank or whitespace-only query matches everything (search inactive)", () => {
    expect(matchesSessionQuery(titled("anything"), "")).toBe(true);
    expect(matchesSessionQuery(titled("anything"), "   ")).toBe(true);
    expect(matchesSessionQuery(session("/w", "2026-08-13T00:00:00Z"), "")).toBe(true);
  });

  it("untitled Sessions never match a non-empty query (no stored title to search)", () => {
    expect(matchesSessionQuery(session("/w", "2026-08-13T00:00:00Z"), "new")).toBe(false);
  });
});

/**
 * Time buckets (the sidebar's "by time" grouping): last day / last month / earlier, cut on
 * `lastActiveAt` against a caller-supplied "now" so the boundaries are testable without a
 * clock. The bucket a row lands in must agree with the compact relative timestamp rendered
 * beside it, which reads the same field.
 */
const NOW = Date.parse("2026-08-21T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("timeBucketOf", () => {
  it("cuts at 24 hours and at 30 days, the older side of each boundary losing", () => {
    expect(timeBucketOf(ago(0), NOW)).toBe("day");
    expect(timeBucketOf(ago(DAY - 1), NOW)).toBe("day");
    expect(timeBucketOf(ago(DAY), NOW)).toBe("month");
    expect(timeBucketOf(ago(30 * DAY - 1), NOW)).toBe("month");
    expect(timeBucketOf(ago(30 * DAY), NOW)).toBe("earlier");
  });

  it("puts a clock-skewed future stamp in the newest bucket, and an unreadable one in the oldest", () => {
    expect(timeBucketOf(new Date(NOW + HOUR).toISOString(), NOW)).toBe("day");
    // Never the top of the list on a value nothing can be concluded from.
    expect(timeBucketOf("", NOW)).toBe("earlier");
    expect(timeBucketOf("not-a-date", NOW)).toBe("earlier");
  });
});

describe("groupSessionsByTime", () => {
  it("renders newest bucket first and drops the empty ones", () => {
    const groups = groupSessionsByTime(
      [session("/w", ago(40 * DAY)), session("/w", ago(2 * HOUR))],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["day", "earlier"]);
    expect(groups.map((g) => g.key)).toEqual([timeGroupKey("day"), timeGroupKey("earlier")]);
    expect(groupSessionsByTime([], NOW)).toEqual([]);
  });

  it("buckets and sorts on last activity, not on creation", () => {
    // An old conversation used today belongs where its own timestamp says it does: the row
    // reads "2h ago", so a bucket claiming it is older would contradict the row beside it.
    const revived = session("/w", ago(90 * DAY), {
      sessionId: "session-revived",
      lastActiveAt: ago(2 * HOUR),
    });
    const fresh = session("/w", ago(3 * DAY), {
      sessionId: "session-fresh",
      lastActiveAt: ago(3 * HOUR),
    });
    const groups = groupSessionsByTime([fresh, revived], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.bucket).toBe("day");
    expect(groups[0]?.sessions.map((s) => s.sessionId)).toEqual([
      "session-revived",
      "session-fresh",
    ]);
  });

  it("keys buckets so they can never collide with a Workspace path or an Agent id", () => {
    const keys = TIME_BUCKETS.map(timeGroupKey);
    expect(new Set([...keys, TIME_FOLDERS_GROUP_KEY, TEMP_WORKSPACE_GROUP_KEY]).size).toBe(
      keys.length + 2,
    );
    // "\0" is the one byte a filesystem path and an Agent id cannot contain.
    for (const key of [...keys, TIME_FOLDERS_GROUP_KEY]) expect(key.startsWith("\0")).toBe(true);
  });
});

describe("totalCategoryCounts", () => {
  const counts = (over: Partial<SessionCategoryCounts>): SessionCategoryCounts => ({
    active: 0,
    subagent: 0,
    schedule: 0,
    benchmark: 0,
    archived: 0,
    ...over,
  });

  it("sums every Agent's share, since a time bucket spans all of them", () => {
    expect(
      totalCategoryCounts(
        new Map([
          ["a", counts({ active: 3, archived: 2 })],
          ["b", counts({ active: 4, subagent: 1 })],
        ]),
      ),
    ).toEqual({ active: 7, subagent: 1, schedule: 0, benchmark: 0, archived: 2 });
  });

  it("reports zeros for an empty map rather than leaving fields undefined", () => {
    expect(totalCategoryCounts(new Map())).toEqual({
      active: 0,
      subagent: 0,
      schedule: 0,
      benchmark: 0,
      archived: 0,
    });
  });
});

describe("aggregateWorkspaceLatest (per-group newest-Session stamp)", () => {
  it("keeps the newest stamp per path across Agents, and the newest temporary path for the temp group", () => {
    const byAgent = new Map<string, Record<string, string>>([
      [
        "agent_a",
        {
          "/srv/alpha": "2026-07-03T09:00:00.000Z",
          [TEMP_A]: "2026-07-03T08:00:00.000Z",
        },
      ],
      [
        "agent_b",
        {
          "/srv/alpha": "2026-07-03T09:30:00.000Z",
          "/srv/beta": "2026-07-01T00:00:00.000Z",
          [TEMP_B]: "2026-07-03T08:30:00.000Z",
        },
      ],
    ]);
    const latest = aggregateWorkspaceLatest(byAgent);
    expect(latest.get("/srv/alpha")).toBe("2026-07-03T09:30:00.000Z");
    expect(latest.get("/srv/beta")).toBe("2026-07-01T00:00:00.000Z");
    expect(latest.get(TEMP_WORKSPACE_GROUP_KEY)).toBe("2026-07-03T08:30:00.000Z");
    expect(latest.size).toBe(3);
    expect(aggregateWorkspaceLatest(new Map()).size).toBe(0);
  });
});

describe("completeWorkspaceGroups (every counted Workspace is a group, placed by recency)", () => {
  const zero = { active: 0, subagent: 0, schedule: 0, benchmark: 0, archived: 0 };
  const counted = (totals: Partial<SessionCategoryCounts>) => ({
    totals: { ...zero, ...totals },
    agents: { active: [], subagent: [], schedule: [], benchmark: [], archived: [] },
  });

  it("reads a machine-qualified count key as that machine's directory, not as a path", () => {
    const key = workspaceGroupKey("/srv/alpha", "gpu-box");
    const groups = completeWorkspaceGroups([], new Map([[key, counted({ active: 1 })]]), new Map());
    expect(groups).toEqual([
      {
        key,
        label: workspaceLabel("/srv/alpha"),
        fullPath: "/srv/alpha",
        machineId: "gpu-box",
        temp: false,
        sessions: [],
      },
    ]);
  });

  it("adds an empty group for a counted Workspace the loaded rows never touched, and orders every group by its newest stamp", () => {
    // Loaded: one Agent's first page reached only alpha (newest) and a temp workspace.
    const loaded = groupSessionsByWorkspace([
      session("/srv/alpha", "2026-07-03T09:00:00.000Z"),
      session(TEMP_A, "2026-07-02T12:00:00.000Z"),
    ]);
    const counts = new Map([
      ["/srv/alpha", counted({ active: 40 })],
      // Unloaded, newer than alpha's loaded row: the stamp places it first.
      ["/srv/beta", counted({ active: 300 })],
      // Unloaded, older: last among the named groups.
      ["/srv/gamma", counted({ active: 2, archived: 5 })],
      [TEMP_WORKSPACE_GROUP_KEY, counted({ active: 7 })],
    ]);
    const latest = new Map([
      ["/srv/alpha", "2026-07-03T09:00:00.000Z"],
      ["/srv/beta", "2026-07-03T10:00:00.000Z"],
      ["/srv/gamma", "2026-06-01T00:00:00.000Z"],
      [TEMP_WORKSPACE_GROUP_KEY, "2026-07-03T11:00:00.000Z"],
    ]);
    const groups = completeWorkspaceGroups(loaded, counts, latest);
    expect(groups.map((g) => g.key)).toEqual([
      "/srv/beta",
      "/srv/alpha",
      "/srv/gamma",
      TEMP_WORKSPACE_GROUP_KEY,
    ]);
    const beta = groups[0]!;
    expect(beta).toMatchObject({ label: "beta", fullPath: "/srv/beta", temp: false });
    expect(beta.sessions).toEqual([]);
    // Groups already formed keep their loaded rows.
    expect(groups[1]!.sessions).toHaveLength(1);
    // The temp group stays last however new its stamp is, and keeps its loaded row.
    expect(groups[3]!.sessions).toHaveLength(1);
  });

  it("places a group by its newest loaded row when that is newer than the stamp (a conversation added since the counts)", () => {
    const loaded = groupSessionsByWorkspace([
      session("/srv/alpha", "2026-07-03T12:00:00.000Z"),
      session("/srv/beta", "2026-07-03T09:00:00.000Z"),
    ]);
    const counts = new Map([
      ["/srv/alpha", counted({ active: 1 })],
      ["/srv/beta", counted({ active: 1 })],
    ]);
    // Stale stamps say beta is newer; alpha's loaded row is newer than both.
    const latest = new Map([
      ["/srv/alpha", "2026-07-01T00:00:00.000Z"],
      ["/srv/beta", "2026-07-02T00:00:00.000Z"],
    ]);
    expect(completeWorkspaceGroups(loaded, counts, latest).map((g) => g.key)).toEqual([
      "/srv/alpha",
      "/srv/beta",
    ]);
  });

  it("forms no group for a counted key with nothing left in any category, and none without counts", () => {
    const loaded = groupSessionsByWorkspace([session("/srv/alpha", "2026-07-03T09:00:00.000Z")]);
    const counts = new Map([
      ["/srv/alpha", counted({ active: 1 })],
      ["/srv/gone", counted({})],
    ]);
    expect(completeWorkspaceGroups(loaded, counts, new Map()).map((g) => g.key)).toEqual([
      "/srv/alpha",
    ]);
    expect(completeWorkspaceGroups(loaded, new Map(), new Map()).map((g) => g.key)).toEqual([
      "/srv/alpha",
    ]);
    expect(completeWorkspaceGroups([], new Map(), new Map())).toEqual([]);
  });

  it("forms the temp group from its counts alone, empty and last, when no temporary row is loaded", () => {
    const loaded = groupSessionsByWorkspace([session("/srv/alpha", "2026-07-03T09:00:00.000Z")]);
    const counts = new Map([[TEMP_WORKSPACE_GROUP_KEY, counted({ archived: 3 })]]);
    const groups = completeWorkspaceGroups(loaded, counts, new Map());
    expect(groups.map((g) => g.key)).toEqual(["/srv/alpha", TEMP_WORKSPACE_GROUP_KEY]);
    expect(groups[1]).toMatchObject({ label: "", fullPath: null, temp: true, sessions: [] });
  });
});

describe("the activity order", () => {
  const key = (lastActiveAt: string, sessionId: string): ActivityKey => ({
    lastActiveAt,
    sessionId,
  });
  const ids = (keys: ActivityKey[]) => keys.map((k) => k.sessionId);

  it("puts the most recent activity first, then the higher id", () => {
    const rows = [
      key("2026-09-01T00:00:00.000Z", "s-b"),
      key("2026-09-02T00:00:00.000Z", "s-a"),
      key("2026-09-01T00:00:00.000Z", "s-c"),
    ];
    expect(ids([...rows].sort(compareActivityDesc))).toEqual(["s-a", "s-c", "s-b"]);
  });

  it("compares by code point where a locale's collation would order the pair the other way", () => {
    // The browser names the cursor and the server slices on it: both must agree on one order.
    const stamp = "2026-09-01T00:00:00.000Z";
    for (const [higher, lower] of [
      ["session-abcd", "session-ABCD"],
      ["session-a_b", "session-a-b"],
    ] as const) {
      expect(higher.localeCompare(lower, "en")).toBeLessThan(0);
      expect(compareActivityDesc(key(stamp, higher), key(stamp, lower))).toBeLessThan(0);
    }
  });

  it("names a cursor as <lastActiveAt>,<sessionId>", () => {
    expect(activityCursorParam(key("2026-09-01T00:00:00.000Z", "session-x"))).toBe(
      "2026-09-01T00:00:00.000Z,session-x",
    );
  });
});

describe("the watermark of a merged list", () => {
  const at = (day: number, sessionId = `s-${day}`): ActivityKey => ({
    lastActiveAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    sessionId,
  });

  it("is the most recent cursor among the streams that still have more", () => {
    expect(
      activityWatermark([
        { hasMore: true, cursor: at(3) },
        { hasMore: true, cursor: at(7) },
        // Exhausted: everything it holds is already in hand, however recent its last row.
        { hasMore: false, cursor: at(9) },
      ]),
    ).toEqual(at(7));
  });

  it("is absent when no stream has more, and a stream with nothing read bounds nothing", () => {
    expect(activityWatermark([])).toBeNull();
    expect(activityWatermark([{ hasMore: false, cursor: at(3) }])).toBeNull();
    expect(
      activityWatermark([
        { hasMore: true, cursor: null },
        { hasMore: true, cursor: at(2) },
      ]),
    ).toEqual(at(2));
  });

  it("the cut keeps the rows at or above it, in order, and the open conversation wherever it falls", () => {
    const rows = [at(1), at(5), at(3), at(4), at(2)];
    expect(cutAtWatermark(rows, at(3)).map((r) => r.sessionId)).toEqual(["s-5", "s-4", "s-3"]);
    expect(cutAtWatermark(rows, at(3), "s-1").map((r) => r.sessionId)).toEqual([
      "s-5",
      "s-4",
      "s-3",
      "s-1",
    ]);
    expect(cutAtWatermark(rows, null).map((r) => r.sessionId)).toEqual([
      "s-5",
      "s-4",
      "s-3",
      "s-2",
      "s-1",
    ]);
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

describe("property: a list merged from cursor-paged streams", () => {
  /** One server stream and the client's position in it. */
  interface Stream extends StreamPosition {
    rows: ActivityKey[];
  }

  it("is a prefix of the true order after any loads and flips, and loads only append", () => {
    const STAMPS = [1, 2, 3, 5, 8].map((d) => `2026-09-0${d}T00:00:00.000Z`);
    for (let seed = 1; seed <= 200; seed += 1) {
      const rand = lcg(seed);
      const int = (n: number) => Math.floor(rand() * n);
      let n = 0;
      const streams: Stream[] = Array.from({ length: 1 + int(4) }, () => ({
        hasMore: false,
        cursor: null,
        rows: Array.from({ length: int(26) }, () => ({
          lastActiveAt: STAMPS[int(STAMPS.length)]!,
          sessionId: `s${String(n++).padStart(3, "0")}`,
        })),
      }));
      /** What the client holds: its own copy of each row it was served or fetched. */
      const pool = new Map<string, ActivityKey>();
      let clock = Date.parse("2026-09-20T00:00:00.000Z");

      /** The server answering a page: the rows strictly below the cursor, one extra for "more". */
      const load = (stream: Stream) => {
        const below = [...stream.rows]
          .sort(compareActivityDesc)
          .filter((r) => stream.cursor === null || compareActivityDesc(r, stream.cursor) > 0);
        const { items, hasMore } = splitPage(
          below.slice(0, SIDEBAR_PAGE_SIZE + 1),
          SIDEBAR_PAGE_SIZE,
        );
        for (const r of items) pool.set(r.sessionId, { ...r });
        const last = items.at(-1);
        stream.hasMore = hasMore;
        if (last !== undefined) stream.cursor = { ...last };
      };
      const view = () => cutAtWatermark([...pool.values()], activityWatermark(streams));
      const truth = () =>
        streams
          .flatMap((s) => s.rows)
          .sort(compareActivityDesc)
          .map((r) => r.sessionId);
      const expectPrefix = (what: string) => {
        const shown = view().map((r) => r.sessionId);
        expect(shown, `seed ${seed}, ${what}`).toEqual(truth().slice(0, shown.length));
      };

      for (const stream of streams) load(stream);
      expectPrefix("first pages");
      for (let step = 1; step <= 30; step += 1) {
        const roll = rand();
        const withMore = streams.filter((s) => s.hasMore);
        if (roll < 0.65 && withMore.length > 0) {
          const every = roll < 0.25;
          const chosen = every ? withMore : withMore.filter(() => rand() < 0.5);
          if (chosen.length === 0) chosen.push(withMore[int(withMore.length)]!);
          const before = view();
          for (const stream of chosen) load(stream);
          const what = `step ${step}: load ${every ? "every stream" : "some streams"}`;
          expectPrefix(what);
          const after = view();
          expect(after.slice(0, before.length), `seed ${seed}, ${what}`).toEqual(before);
          const floor = before.at(-1);
          if (floor !== undefined) {
            for (const r of after.slice(before.length)) {
              expect(compareActivityDesc(r, floor), `seed ${seed}, ${what}`).toBeGreaterThan(0);
            }
          }
          if (every) {
            const remaining = truth().length - before.length;
            expect(after.length - before.length, `seed ${seed}, ${what}`).toBeGreaterThanOrEqual(
              Math.min(SIDEBAR_PAGE_SIZE, remaining),
            );
          }
        } else {
          const all = streams.flatMap((s) => s.rows);
          if (all.length === 0) continue;
          const row = all[int(all.length)]!;
          clock += 60_000;
          row.lastActiveAt = new Date(clock).toISOString();
          // Loaded: its own key rises in place. Not loaded: the event fetches it (it has moved
          // above every cursor, so no page will serve it again).
          pool.set(row.sessionId, { ...row });
          expectPrefix(`step ${step}: flip ${row.sessionId}`);
        }
      }
    }
  });
});
