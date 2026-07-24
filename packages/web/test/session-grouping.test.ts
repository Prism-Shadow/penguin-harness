/**
 * Workspace grouping for the chat sidebar (pure logic):
 * - named Workspaces group by exact path, labeled by basename (full path kept for
 *   tooltips), newest group first;
 * - auto temp Workspaces (`<agentDir>/workspaces/tmp-<8hex>`, the shape produced by
 *   core's createTempWorkspace) are all merged into ONE trailing temp group — an
 *   empty path (defensive; the server always backfills the resolved dir) counts too;
 * - sessions inside every group are re-sorted newest first: the flat store list
 *   concatenates per-Agent server responses, so its order isn't globally chronological.
 */
import { describe, expect, it } from "vitest";
import type { SessionCategoryCounts, SessionInfo } from "@prismshadow/penguin-server/api";
import {
  SIDEBAR_PAGE_SIZE,
  TEMP_WORKSPACE_GROUP_KEY,
  aggregateWorkspaceCounts,
  groupSessionsByWorkspace,
  isTempWorkspace,
  latestConversation,
  partitionSessions,
  pinnedFirst,
  sessionCategory,
  splitPage,
  workspaceGroupKey,
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
    source?: "schedule" | "subagent";
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
    createdAt,
    status: "idle",
    pendingApprovalCount: 0,
    hasTrace: false,
    archived: over.archived ?? false,
    ...(over.source !== undefined ? { source: over.source } : {}),
  };
}

const TEMP_A = "/data/proj/agents/default_agent/workspaces/tmp-1a2b3c4d";
const TEMP_B = "/data/proj/agents/agent_helper/workspaces/tmp-00ff00aa";

describe("isTempWorkspace (auto temp directory pattern from core's createTempWorkspace)", () => {
  it("matches <...>/workspaces/tmp-<8hex> with either path separator, and the empty path", () => {
    expect(isTempWorkspace(TEMP_A)).toBe(true);
    expect(isTempWorkspace("C:\\pg\\data\\proj\\agents\\a\\workspaces\\tmp-00ff00aa")).toBe(true);
    expect(isTempWorkspace("")).toBe(true);
    expect(isTempWorkspace("   ")).toBe(true);
  });

  it("rejects named directories and near misses", () => {
    expect(isTempWorkspace("/srv/repo")).toBe(false);
    // tmp-<8hex> without a workspaces/ parent is a user directory that just looks similar
    expect(isTempWorkspace("/srv/tmp-1a2b3c4d")).toBe(false);
    // non-hex / wrong-length ids
    expect(isTempWorkspace("/x/workspaces/tmp-XYZWQPRS")).toBe(false);
    expect(isTempWorkspace("/x/workspaces/tmp-1a2b3c4")).toBe(false);
    expect(isTempWorkspace("/x/workspaces/tmp-1a2b3c4d5")).toBe(false);
    // a subdirectory below a temp Workspace is not itself the temp Workspace
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

  it("merges every temp Workspace into one trailing group, after named groups sorted by newest session", () => {
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

describe("partitionSessions (per-group user / subagent / scheduled / archived split)", () => {
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

  it("empty input yields four empty parts", () => {
    expect(partitionSessions([])).toEqual({
      active: [],
      subagent: [],
      schedule: [],
      archived: [],
    });
  });
});

describe("latestConversation (the auto-opened 'last conversation')", () => {
  it("picks the newest active/schedule row regardless of input order; archived and subagent rows never win", () => {
    const oldActive = session("/srv/a", "2026-07-01T10:00:00.000Z");
    const newActive = session("/srv/a", "2026-07-03T10:00:00.000Z");
    // Newer than every conversation, but never auto-opened:
    const newerSub = session("/srv/a", "2026-07-08T10:00:00.000Z", { source: "subagent" });
    const newerGone = session("/srv/a", "2026-07-09T10:00:00.000Z", { archived: true });
    expect(latestConversation([newerSub, oldActive, newerGone, newActive])).toBe(newActive);

    // A schedule-created run is the user's conversation: the newest one qualifies.
    const newerSched = session("/srv/a", "2026-07-05T10:00:00.000Z", { source: "schedule" });
    expect(latestConversation([newActive, newerSched, newerSub])).toBe(newerSched);
  });

  it("ties on createdAt break by sessionId, and no qualifying row yields null", () => {
    const at = "2026-07-02T10:00:00.000Z";
    const a = session("/srv/a", at, { sessionId: "session-a" });
    const b = session("/srv/a", at, { sessionId: "session-b" });
    expect(latestConversation([a, b])).toBe(b);
    expect(latestConversation([b, a])).toBe(b);
    expect(latestConversation([])).toBeNull();
    expect(latestConversation([session("/srv/a", at, { source: "subagent" })])).toBeNull();
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
  const zero = { active: 0, subagent: 0, schedule: 0, archived: 0 };

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
      totals: { active: 3, subagent: 1, schedule: 2, archived: 0 },
      agents: {
        active: ["agent_a", "agent_b"],
        subagent: ["agent_a"],
        schedule: ["agent_b"],
        archived: [],
      },
    });
    expect(groups.get("/srv/beta")).toEqual({
      totals: { ...zero, archived: 3 },
      agents: { active: [], subagent: [], schedule: [], archived: ["agent_a"] },
    });
    // A group only in another Workspace never appears — its content can't surface elsewhere.
    expect(groups.has("/srv/gamma")).toBe(false);
    expect(aggregateWorkspaceCounts(new Map()).size).toBe(0);
  });

  it("folds every auto-temp path into the merged temp group, deduplicating agents", () => {
    const byAgent = new Map([
      [
        "agent_a",
        {
          [TEMP_A]: { ...zero, active: 1 },
          [TEMP_B]: { ...zero, active: 2, archived: 1 },
        },
      ],
    ]);
    const groups = aggregateWorkspaceCounts(byAgent);
    expect(groups.size).toBe(1);
    expect(groups.get(TEMP_WORKSPACE_GROUP_KEY)).toEqual({
      totals: { ...zero, active: 3, archived: 1 },
      agents: { active: ["agent_a"], subagent: [], schedule: [], archived: ["agent_a"] },
    });
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
