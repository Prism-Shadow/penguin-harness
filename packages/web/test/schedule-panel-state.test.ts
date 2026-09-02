/**
 * The scheduled-tasks panel's pure rules (src/features/schedules/schedule-panel-state.ts and
 * schedule-upsert.ts): which tasks belong to the conversation on screen, how the chips bucket
 * the display statuses, what the search matches, and the whole-file toggle body.
 */
import { describe, expect, it } from "vitest";
import type { ScheduleItem } from "@prismshadow/penguin-server/api";
import {
  SCHEDULE_FILTERS,
  filterBucket,
  filterSchedules,
  matchesQuery,
  scheduleGlyph,
  sessionSchedules,
} from "../src/features/schedules/schedule-panel-state";
import { itemModelRef, toggleBody } from "../src/features/schedules/schedule-upsert";

function item(overrides: Partial<ScheduleItem> & { name: string }): ScheduleItem {
  return {
    prompt: "Summarize yesterday",
    enabled: true,
    startAt: "2026-09-01T00:00:00.000Z",
    status: "active",
    queued: false,
    ...overrides,
  };
}

describe("sessionSchedules", () => {
  it("keeps only the tasks bound to the given Session — new-Session tasks belong to the agent", () => {
    const items = [
      item({ name: "here", sessionId: "s1" }),
      item({ name: "elsewhere", sessionId: "s2" }),
      item({ name: "fresh" }),
    ];
    expect(sessionSchedules(items, "s1").map((i) => i.name)).toEqual(["here"]);
  });
});

describe("filterBucket / scheduleGlyph", () => {
  it("buckets every display status under exactly one chip, invalid under none", () => {
    expect(filterBucket("active")).toBe("active");
    expect(filterBucket("disabled")).toBe("paused");
    expect(filterBucket("done")).toBe("completed");
    expect(filterBucket("expired")).toBe("completed");
    expect(filterBucket("missed")).toBe("completed");
    expect(filterBucket("invalid")).toBeNull();
    // Every non-"all" chip is a bucket some status lands in.
    const landed = (["active", "disabled", "done"] as const).map((s) => filterBucket(s));
    for (const chip of SCHEDULE_FILTERS.filter((f) => f !== "all")) {
      expect(landed).toContain(chip);
    }
  });

  it("gives the glyph the same grouping as the chips, plus the alert for an invalid file", () => {
    expect(scheduleGlyph("active")).toBe("play");
    expect(scheduleGlyph("disabled")).toBe("pause");
    expect(scheduleGlyph("done")).toBe("check");
    expect(scheduleGlyph("missed")).toBe("check");
    expect(scheduleGlyph("invalid")).toBe("alert");
  });
});

describe("matchesQuery / filterSchedules", () => {
  const items = [
    item({ name: "daily_brief", prompt: "Morning summary" }),
    item({ name: "watch_docs", prompt: "Check the docs page", status: "disabled" }),
    item({ name: "reminder", prompt: "Follow up with Kim", status: "done" }),
    item({ name: "broken", prompt: "", status: "invalid" }),
  ];

  it("matches the name or the prompt, case-insensitively; a blank query matches all", () => {
    expect(matchesQuery(items[0]!, "BRIEF")).toBe(true);
    expect(matchesQuery(items[1]!, "docs page")).toBe(true);
    expect(matchesQuery(items[2]!, "docs")).toBe(false);
    expect(matchesQuery(items[2]!, "  ")).toBe(true);
  });

  it("combines the chip and the query, and shows an invalid file under 'all' only", () => {
    expect(filterSchedules(items, "all", "").map((i) => i.name)).toEqual([
      "daily_brief",
      "watch_docs",
      "reminder",
      "broken",
    ]);
    expect(filterSchedules(items, "paused", "").map((i) => i.name)).toEqual(["watch_docs"]);
    expect(filterSchedules(items, "completed", "kim").map((i) => i.name)).toEqual(["reminder"]);
    expect(filterSchedules(items, "active", "docs")).toEqual([]);
  });
});

describe("toggleBody", () => {
  it("resends every stored field with only `enabled` flipped, the model as a whole pair", () => {
    const full = item({
      name: "nightly",
      period: "1d",
      endAt: "2026-12-31T00:00:00.000Z",
      workspace: "/w",
      modelId: "gpt-x",
      provider: "openai",
    });
    expect(toggleBody(full, false)).toEqual({
      prompt: full.prompt,
      enabled: false,
      startAt: full.startAt,
      period: "1d",
      endAt: "2026-12-31T00:00:00.000Z",
      workspace: "/w",
      modelId: "gpt-x",
      provider: "openai",
    });
    // A bound task carries its Session and nothing of the new-Session mode.
    expect(toggleBody(item({ name: "bound", sessionId: "s1", enabled: false }), true)).toEqual({
      prompt: "Summarize yesterday",
      enabled: true,
      startAt: "2026-09-01T00:00:00.000Z",
      sessionId: "s1",
    });
  });

  it("never assembles half a model reference", () => {
    expect(itemModelRef({ modelId: "gpt-x" })).toBeNull();
    expect(itemModelRef({ provider: "openai" })).toBeNull();
    expect(itemModelRef({ modelId: "gpt-x", provider: "openai" })).toEqual({
      provider: "openai",
      modelId: "gpt-x",
    });
  });
});
