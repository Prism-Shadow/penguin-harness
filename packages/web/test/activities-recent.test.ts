import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@prismshadow/penguin-server/api";
import {
  RECENT_ACTIVITIES_KEY,
  RECENT_KEEP,
  RECENT_SHOW,
  pushRecent,
  readRecent,
  recentActivities,
  type RecentActivitiesStorage,
} from "../src/features/activities/recent-activities";

function memory(initial?: string): RecentActivitiesStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RECENT_ACTIVITIES_KEY, initial);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const record = (id: string) => ({ id, title: id, productCode: id, refNum: 1 }) as ActivityRecord;

const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);

describe("pushRecent / readRecent", () => {
  it("puts the latest opening first and moves a reopened activity back to the front", () => {
    const storage = memory();
    pushRecent("p1", "a", "2026-09-25T10:00:00.000Z", storage);
    pushRecent("p1", "b", "2026-09-25T10:01:00.000Z", storage);
    const next = pushRecent("p1", "a", "2026-09-25T10:02:00.000Z", storage);
    expect(ids(next)).toEqual(["a", "b"]);
    expect(readRecent("p1", storage)).toEqual([
      { id: "a", at: "2026-09-25T10:02:00.000Z" },
      { id: "b", at: "2026-09-25T10:01:00.000Z" },
    ]);
  });

  it("keeps the newest 15 openings", () => {
    const storage = memory();
    for (let index = 0; index < 20; index++) pushRecent("p1", `a${index}`, `t${index}`, storage);
    const list = readRecent("p1", storage);
    expect(list).toHaveLength(RECENT_KEEP);
    expect(list[0]?.id).toBe("a19");
    expect(list.at(-1)?.id).toBe("a5");
  });

  it("keeps each project's list apart", () => {
    const storage = memory();
    pushRecent("p1", "a", "t1", storage);
    pushRecent("p2", "b", "t2", storage);
    expect(ids(readRecent("p1", storage))).toEqual(["a"]);
    expect(ids(readRecent("p2", storage))).toEqual(["b"]);
    expect(readRecent("p3", storage)).toEqual([]);
  });

  it("reads nothing from corrupt or foreign-shaped data, and a push starts over from it", () => {
    for (const raw of ["{not json", "[]", "null", '"x"', '{"p1": 3}', '{"p1": [1, {"id": 2}]}'])
      expect(readRecent("p1", memory(raw))).toEqual([]);
    const storage = memory("{not json");
    expect(ids(pushRecent("p1", "a", "t", storage))).toEqual(["a"]);
    expect(ids(readRecent("p1", storage))).toEqual(["a"]);
  });

  it("drops malformed and duplicate entries but keeps the good ones", () => {
    const raw = JSON.stringify({
      p1: [{ id: "a", at: "t1" }, { id: "" }, { id: "a", at: "t0" }, { id: "b", at: "t2" }],
    });
    expect(readRecent("p1", memory(raw))).toEqual([
      { id: "a", at: "t1" },
      { id: "b", at: "t2" },
    ]);
  });

  it("degrades to nothing when storage throws, and still answers a push", () => {
    const broken: RecentActivitiesStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readRecent("p1", broken)).toEqual([]);
    expect(ids(pushRecent("p1", "a", "t", broken))).toEqual(["a"]);
  });
});

describe("recentActivities", () => {
  it("returns the listed activities in recent order, at most four", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map(record);
    const recent = ["f", "a", "c", "e", "b"].map((id) => ({ id, at: "t" }));
    expect(ids(recentActivities(items, recent))).toEqual(["f", "a", "c", "e"]);
    expect(recentActivities(items, recent)).toHaveLength(RECENT_SHOW);
  });

  it("skips activities no longer in the list, filling from older openings", () => {
    const items = ["a", "c", "d"].map(record);
    const recent = ["gone", "a", "deleted", "c"].map((id) => ({ id, at: "t" }));
    expect(ids(recentActivities(items, recent))).toEqual(["a", "c"]);
    expect(recentActivities([], recent)).toEqual([]);
  });
});
