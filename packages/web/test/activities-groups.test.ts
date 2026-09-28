import { describe, expect, it } from "vitest";
import type { ActivityRecord, ActivitySummary } from "@prismshadow/penguin-server/api";
import {
  groupByProduct,
  readCollapsed,
  writeCollapsed,
} from "../src/features/activities/activity-groups";

function item(id: string, productCode: string, refNum: number, updatedAt: string, extra: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id,
    productCode,
    refNum,
    collectionId: "c",
    productId: `p-${productCode}`,
    title: `${productCode} ${refNum}`,
    displayName: null,
    stable: false,
    activityType: "standard",
    createdAt: updatedAt,
    updatedAt,
    archived: false,
    tags: [],
    ...extra,
  };
}
const summary = (canonical: boolean, stale = false): ActivitySummary => ({
  canonical,
  hasPlan: stale,
  done: 1,
  total: 3,
  status: stale ? { kind: "stale", what: "mediaPlan" } : { kind: "next", milestone: "mediaPlan" },
});

const items = [
  item("a3", "ants", 3, "2026-09-20T00:00:00Z"),
  item("a5", "ants", 5, "2026-09-27T00:00:00Z"),
  item("b1", "book", 1, "2026-09-25T00:00:00Z", { activityType: "book", tags: ["Reading"] }),
];
const summaries = { a3: summary(true), a5: summary(false, true), b1: summary(true) };
const all = { sort: "recent" as const, search: "", tag: null };

describe("groupByProduct", () => {
  it("groups by product code, newest group first, canonical ref first inside", () => {
    const groups = groupByProduct(items, summaries, all);
    expect(groups.map((group) => group.productCode)).toEqual(["ants", "book"]);
    expect(groups[0]!.items.map((entry) => entry.id)).toEqual(["a3", "a5"]);
    expect(groups[0]!).toMatchObject({ canonicalId: "a3", attention: 1, latest: "2026-09-27T00:00:00Z" });
    expect(groups[1]!.activityType).toBe("book");
  });

  it("sorts A-Z by product code", () => {
    const groups = groupByProduct(items, summaries, { ...all, sort: "code" });
    expect(groups.map((group) => group.productCode)).toEqual(["ants", "book"]);
    const reversed = groupByProduct(
      [item("z1", "zebra", 1, "2026-09-28T00:00:00Z"), ...items],
      summaries,
      { ...all, sort: "code" },
    );
    expect(reversed.map((group) => group.productCode)).toEqual(["ants", "book", "zebra"]);
  });

  it("filters inside groups and drops groups left empty", () => {
    const groups = groupByProduct(items, summaries, { ...all, search: "5" });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((entry) => entry.id)).toEqual(["a5"]);
    expect(groupByProduct(items, summaries, { ...all, tag: "reading" }).map((g) => g.productCode)).toEqual(["book"]);
  });

  it("keeps an activity without a product or summary", () => {
    const orphan = item("o1", "legacy", 1, "2026-09-01T00:00:00Z", { productId: null });
    const groups = groupByProduct([orphan], {}, all);
    expect(groups).toEqual([
      expect.objectContaining({ productCode: "legacy", canonicalId: null, attention: 0 }),
    ]);
  });
});

describe("collapsed groups", () => {
  function memory() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }
  it("remembers collapsed groups per project", () => {
    const storage = memory();
    writeCollapsed("p1", new Set(["ants"]), storage);
    expect([...readCollapsed("p1", storage)]).toEqual(["ants"]);
    expect(readCollapsed("p2", storage).size).toBe(0);
  });
  it("reads garbage as nothing collapsed", () => {
    const storage = memory();
    storage.setItem("penguin.activities.collapsedGroups", "{not json");
    expect(readCollapsed("p1", storage).size).toBe(0);
  });
  it("readCollapsed with no storage argument returns empty set (node env)", () => {
    // In Node.js test environment, localStorage does not exist and accessing it throws.
    // readCollapsed should not throw; it should catch and return an empty Set.
    expect(() => readCollapsed("p1")).not.toThrow();
    expect(readCollapsed("p1").size).toBe(0);
  });
  it("writeCollapsed with no storage argument does not throw (node env)", () => {
    // In Node.js test environment, localStorage does not exist and accessing it throws.
    // writeCollapsed should not throw; it should catch the error silently.
    expect(() => writeCollapsed("p1", new Set(["ants"]))).not.toThrow();
  });
});
