import { describe, expect, it } from "vitest";
import type { MediaStat } from "@prismshadow/penguin-server/api";
import { statsTables } from "../src/features/activities/activity-stats";

const stat = (over: Partial<MediaStat> & Pick<MediaStat, "key">): MediaStat => ({
  language: "en-US",
  type: "audio",
  bound: true,
  bytes: 100,
  mimeType: null,
  ...over,
});

describe("activity stats", () => {
  it("counts and weighs the plan by type in Loom's order, and by language default first", () => {
    const tables = statsTables([
      stat({ key: "hola", language: "es-MX", bytes: 50 }),
      stat({ key: "hi" }),
      stat({ key: "cat", type: "image", bytes: 30 }),
      stat({ key: "bye", bound: false, bytes: null }),
      stat({ key: "gone", type: "image", bytes: null }),
    ]);
    expect(tables.byType).toEqual([
      { key: "image", count: 2, bound: 2, bytes: 30, missing: 1 },
      { key: "audio", count: 3, bound: 2, bytes: 150, missing: 0 },
    ]);
    expect(tables.byLanguage.map((row) => [row.key, row.count, row.bytes])).toEqual([
      ["en-US", 4, 130],
      ["es-MX", 1, 50],
    ]);
    expect(tables.total).toEqual({ key: "total", count: 5, bound: 4, bytes: 180, missing: 1 });
  });

  it("has nothing to count in an empty plan", () => {
    expect(statsTables([])).toEqual({
      byType: [],
      byLanguage: [],
      total: { key: "total", count: 0, bound: 0, bytes: 0, missing: 0 },
    });
  });
});
