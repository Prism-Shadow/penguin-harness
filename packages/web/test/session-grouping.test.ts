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
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  TEMP_WORKSPACE_GROUP_KEY,
  groupSessionsByWorkspace,
  isTempWorkspace,
  partitionSessions,
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

describe("partitionSessions (per-group user / automated / archived split)", () => {
  it("splits user, automation-created (schedule/subagent) and archived rows, preserving order", () => {
    const user1 = session("/srv/alpha", "2026-07-05T10:00:00.000Z");
    const sched = session("/srv/alpha", "2026-07-04T10:00:00.000Z", { source: "schedule" });
    const sub = session("/srv/alpha", "2026-07-03T10:00:00.000Z", { source: "subagent" });
    const user2 = session("/srv/alpha", "2026-07-02T10:00:00.000Z");
    const gone = session("/srv/alpha", "2026-07-01T10:00:00.000Z", { archived: true });
    const parts = partitionSessions([user1, sched, sub, user2, gone]);
    expect(parts.active.map((s) => s.sessionId)).toEqual([user1.sessionId, user2.sessionId]);
    expect(parts.automated.map((s) => s.sessionId)).toEqual([sched.sessionId, sub.sessionId]);
    expect(parts.archived.map((s) => s.sessionId)).toEqual([gone.sessionId]);
  });

  it("archived wins over source: an archived automated session goes to the Archived folder only", () => {
    const both = session("/srv/alpha", "2026-07-01T10:00:00.000Z", {
      source: "subagent",
      archived: true,
    });
    const parts = partitionSessions([both]);
    expect(parts.automated).toEqual([]);
    expect(parts.archived.map((s) => s.sessionId)).toEqual([both.sessionId]);
    expect(parts.active).toEqual([]);
  });

  it("empty input yields three empty parts", () => {
    expect(partitionSessions([])).toEqual({ active: [], automated: [], archived: [] });
  });
});
