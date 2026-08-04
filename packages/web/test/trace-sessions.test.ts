/**
 * Trace page Session-list logic (pure): mapping both server response shapes to the
 * page's Session groups, and partitioning rows by their server-classified category.
 */
import { describe, expect, it } from "vitest";
import type { AgentTracesResponse } from "@prismshadow/penguin-server/api";
import { partitionTraceRows, toSessionGroups } from "../src/features/traces/trace-sessions";
import type { TraceSessionRow } from "../src/features/traces/trace-sessions";

const S1 = "session-2026-07-05-10-00-00-aabbccdd";
const S2 = "session-2026-07-06-09-00-00-11112222";

describe("toSessionGroups", () => {
  it("paged response: server order kept, titles/classification carried, files re-sorted newest first", () => {
    const res: AgentTracesResponse = {
      dates: [],
      sessions: [
        {
          sessionId: S2,
          title: "标题",
          category: "subagent",
          workspace: "/ws/one",
          files: [
            { index: 1, date: "2026-07-06", sizeBytes: 10 },
            { index: 2, date: "2026-07-07", sizeBytes: 20 },
          ],
        },
        {
          sessionId: S1,
          category: "active",
          workspace: "",
          files: [{ index: 1, date: "2026-07-05", sizeBytes: 5 }],
        },
      ],
      totalSessions: 12,
    };
    const groups = toSessionGroups(res);
    expect(groups.map((g) => g.sessionId)).toEqual([S2, S1]);
    expect(groups[0]!.title).toBe("标题");
    expect(groups[0]!.category).toBe("subagent");
    expect(groups[0]!.workspace).toBe("/ws/one");
    expect(groups[0]!.files.map((f) => f.index)).toEqual([2, 1]); // newest first for display
    expect(groups[1]!.title).toBeUndefined();
  });

  it("legacy response: flattens date groups (merging a Session's files across dates), Sessions sorted by id descending, classification defaulted", () => {
    const res: AgentTracesResponse = {
      dates: [
        {
          date: "2026-07-06",
          sessions: [
            { sessionId: S2, files: [{ index: 1, sizeBytes: 1 }] },
            { sessionId: S1, files: [{ index: 2, sizeBytes: 2 }] },
          ],
        },
        { date: "2026-07-05", sessions: [{ sessionId: S1, files: [{ index: 1, sizeBytes: 3 }] }] },
      ],
    };
    const groups = toSessionGroups(res);
    expect(groups.map((g) => g.sessionId)).toEqual([S2, S1]);
    // S1's files merged across both dates, each carrying its own date, newest first.
    expect(groups[1]!.files).toEqual([
      { index: 2, date: "2026-07-06", sizeBytes: 2 },
      { index: 1, date: "2026-07-05", sizeBytes: 3 },
    ]);
    // No classification in the legacy shape: rows default to the active bucket / unknown workspace.
    expect(groups[0]!.category).toBe("active");
    expect(groups[0]!.workspace).toBe("");
  });
});

describe("partitionTraceRows", () => {
  it("splits rows by their server-classified category, preserving input order", () => {
    const row = (sessionId: string, category: TraceSessionRow["category"]): TraceSessionRow => ({
      sessionId,
      category,
      workspace: "",
      files: [],
      agentId: "a1",
    });
    const parts = partitionTraceRows([
      row("s-4", "archived"),
      row("s-3", "active"),
      row("s-2", "subagent"),
      row("s-1", "active"),
    ]);
    expect(parts.active.map((r) => r.sessionId)).toEqual(["s-3", "s-1"]);
    expect(parts.subagent.map((r) => r.sessionId)).toEqual(["s-2"]);
    expect(parts.schedule).toEqual([]);
    expect(parts.archived.map((r) => r.sessionId)).toEqual(["s-4"]);
  });
});
