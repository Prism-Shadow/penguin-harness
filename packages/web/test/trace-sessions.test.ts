/**
 * Trace page Session-list logic (pure): mapping both server response shapes to the
 * page's Session groups, and page appending with sessionId dedupe.
 */
import { describe, expect, it } from "vitest";
import type { AgentTracesResponse } from "@prismshadow/penguin-server/api";
import { appendSessionGroups, toSessionGroups } from "../src/features/traces/trace-sessions";
import type { TraceSessionGroup } from "../src/features/traces/trace-sessions";

const S1 = "session-2026-07-05-10-00-00-aabbccdd";
const S2 = "session-2026-07-06-09-00-00-11112222";

describe("toSessionGroups", () => {
  it("paged response: server order kept, titles carried, files re-sorted newest first", () => {
    const res: AgentTracesResponse = {
      dates: [],
      sessions: [
        {
          sessionId: S2,
          title: "标题",
          files: [
            { index: 1, date: "2026-07-06", sizeBytes: 10 },
            { index: 2, date: "2026-07-07", sizeBytes: 20 },
          ],
        },
        { sessionId: S1, files: [{ index: 1, date: "2026-07-05", sizeBytes: 5 }] },
      ],
      totalSessions: 12,
    };
    const groups = toSessionGroups(res);
    expect(groups.map((g) => g.sessionId)).toEqual([S2, S1]);
    expect(groups[0]!.title).toBe("标题");
    expect(groups[0]!.files.map((f) => f.index)).toEqual([2, 1]); // newest first for display
    expect(groups[1]!.title).toBeUndefined();
  });

  it("legacy response: flattens date groups (merging a Session's files across dates), Sessions sorted by id descending", () => {
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
  });
});

describe("appendSessionGroups", () => {
  it("appends the fetched page, deduplicating by sessionId (the loaded copy wins)", () => {
    const loaded: TraceSessionGroup[] = [
      { sessionId: S2, title: "loaded", files: [] },
      { sessionId: S1, files: [] },
    ];
    const fetched: TraceSessionGroup[] = [
      { sessionId: S1, title: "refetched", files: [] }, // offset shifted by a new Session: already loaded
      { sessionId: "session-2026-07-04-08-00-00-99990000", files: [] },
    ];
    const merged = appendSessionGroups(loaded, fetched);
    expect(merged.map((g) => g.sessionId)).toEqual([
      S2,
      S1,
      "session-2026-07-04-08-00-00-99990000",
    ]);
    expect(merged[1]!.title).toBeUndefined(); // the loaded copy wins
  });
});
