/**
 * The Project-wide schedules page's pure rules (src/features/schedules/schedule-category.ts):
 * which type a task is, how the status and type chips count a list, and what both filters
 * together leave on screen.
 */
import { describe, expect, it } from "vitest";
import type { ScheduleItem, ScheduleStatus } from "@prismshadow/penguin-server/api";
import {
  NO_SCHEDULE_FILTERS,
  SCHEDULE_TYPES,
  countByStatus,
  countByType,
  filterSchedulePage,
  readScheduleFilters,
  scheduleType,
  writeScheduleFilters,
} from "../src/features/schedules/schedule-category";

function item(overrides: Partial<ScheduleItem> & { name: string }): ScheduleItem {
  return {
    prompt: "Summarize yesterday",
    enabled: true,
    startAt: "2026-10-01T00:00:00.000Z",
    status: "active",
    queued: false,
    ...overrides,
  };
}

describe("scheduleType", () => {
  it("no interval at all is a one-off", () => {
    expect(scheduleType(undefined)).toBe("once");
  });

  it("buckets the server's interval grammar by the words the plan column uses", () => {
    expect(scheduleType("5m")).toBe("minutes");
    expect(scheduleType("30m")).toBe("minutes");
    expect(scheduleType("2h")).toBe("hours");
    expect(scheduleType("12h")).toBe("hours");
    expect(scheduleType("24h")).toBe("days");
    expect(scheduleType("1d")).toBe("days");
    expect(scheduleType("7d")).toBe("weeks");
  });

  it("only the exact week is weekly: 14d reads as every 14 days", () => {
    expect(scheduleType("14d")).toBe("days");
  });

  it("an interval the grammar does not cover is custom, not silently dropped", () => {
    expect(scheduleType("every other tuesday")).toBe("custom");
    expect(scheduleType("0m")).toBe("custom");
    expect(scheduleType("")).toBe("custom");
  });

  it("every type has a chip", () => {
    expect([...SCHEDULE_TYPES]).toEqual(["once", "minutes", "hours", "days", "weeks", "custom"]);
  });
});

describe("countByStatus", () => {
  it("counts the panel's buckets; a settled task and an invalid file have no chip and count under 'all' alone", () => {
    const statuses: ScheduleStatus[] = [
      "active",
      "active",
      "disabled",
      "done",
      "expired",
      "missed",
      "invalid",
    ];
    const counts = countByStatus(statuses.map((status, i) => item({ name: `t${i}`, status })));
    expect(counts).toEqual({ all: 7, active: 2, paused: 1 });
  });
});

describe("countByType", () => {
  it("counts every type, including the ones nothing sits under", () => {
    const counts = countByType([
      item({ name: "once" }),
      item({ name: "hourly", period: "1h" }),
      item({ name: "daily", period: "24h" }),
      item({ name: "daily2", period: "24h" }),
    ]);
    expect(counts).toEqual({ once: 1, minutes: 0, hours: 1, days: 2, weeks: 0, custom: 0 });
  });
});

describe("the filters a URL carries", () => {
  it("an empty address is no filter", () => {
    expect(readScheduleFilters(new URLSearchParams())).toEqual(NO_SCHEDULE_FILTERS);
  });

  it("round-trips what this build knows", () => {
    const filters = { status: "paused", type: "days", query: "日报" } as const;
    expect(readScheduleFilters(writeScheduleFilters(filters))).toEqual(filters);
  });

  it("an unfiltered page has a clean address — no `status=all` clutter", () => {
    expect(writeScheduleFilters(NO_SCHEDULE_FILTERS).toString()).toBe("");
    // A blank search is no search, and a padded one keeps what was typed.
    expect(writeScheduleFilters({ ...NO_SCHEDULE_FILTERS, query: "   " }).toString()).toBe("");
    expect(writeScheduleFilters({ ...NO_SCHEDULE_FILTERS, query: " x " }).get("q")).toBe(" x ");
  });

  it("a hand-edited or stale address falls back to no filter instead of a state no control can show", () => {
    const params = new URLSearchParams("status=running&type=hourly&q=ok");
    expect(readScheduleFilters(params)).toEqual({ status: "all", type: "all", query: "ok" });
    expect(readScheduleFilters(new URLSearchParams("type=custom"))).toEqual({
      status: "all",
      type: "custom",
      query: "",
    });
  });
});

describe("filterSchedulePage", () => {
  const items = [
    item({ name: "watch", period: "5m", status: "active" }),
    item({ name: "daily-report", period: "24h", status: "active" }),
    item({ name: "old-daily", period: "24h", status: "done" }),
    item({ name: "paused-weekly", period: "7d", status: "disabled" }),
    item({ name: "one-shot", status: "done" }),
  ];

  it("passes everything when both chips are 'all' and the query is blank", () => {
    expect(filterSchedulePage(items, "all", "all", "")).toHaveLength(5);
  });

  it("narrows by status, by type, and by both at once", () => {
    expect(filterSchedulePage(items, "active", "all", "").map((i) => i.name)).toEqual([
      "watch",
      "daily-report",
    ]);
    expect(filterSchedulePage(items, "all", "days", "").map((i) => i.name)).toEqual([
      "daily-report",
      "old-daily",
    ]);
    expect(filterSchedulePage(items, "active", "days", "").map((i) => i.name)).toEqual([
      "daily-report",
    ]);
    expect(filterSchedulePage(items, "all", "once", "").map((i) => i.name)).toEqual(["one-shot"]);
  });

  it("the search matches the name or the prompt, case-insensitively, on top of the chips", () => {
    expect(filterSchedulePage(items, "all", "all", "DAILY").map((i) => i.name)).toEqual([
      "daily-report",
      "old-daily",
    ]);
    expect(filterSchedulePage(items, "all", "days", "watch")).toEqual([]);
  });

  it("an invalid file sits under 'all' only, and still answers to the search box", () => {
    const invalid = item({ name: "broken", status: "invalid", invalidReason: "bad date" });
    const list = [...items, invalid];
    expect(filterSchedulePage(list, "active", "all", "").map((i) => i.name)).not.toContain(
      "broken",
    );
    expect(filterSchedulePage(list, "all", "all", "broken").map((i) => i.name)).toEqual(["broken"]);
  });
});
