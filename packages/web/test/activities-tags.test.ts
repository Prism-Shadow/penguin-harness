import { describe, expect, it } from "vitest";
import {
  TAGS_MAX,
  TAG_MAX,
  filterByTag,
  normalizeTagInput,
  tagCounts,
} from "../src/features/activities/activity-tags";
import { filterActivities } from "../src/features/activities/preview";

const item = (id: string, title: string, tags: string[]) => ({
  id,
  title,
  productCode: id,
  refNum: 1,
  tags,
});

const items = [
  item("a", "Sight words", ["phonics", "Grade 1"]),
  item("b", "Letter hunt", ["Phonics"]),
  item("c", "Counting", ["math", "grade 1"]),
  item("d", "Untagged", []),
];

describe("tagCounts", () => {
  it("counts each tag once per activity, A to Z ignoring case", () => {
    expect(tagCounts(items)).toEqual([
      { tag: "Grade 1", count: 2 },
      { tag: "math", count: 1 },
      { tag: "phonics", count: 2 },
    ]);
  });

  it("is empty when nothing is tagged, and tolerates records without tags", () => {
    expect(tagCounts([item("d", "Untagged", [])])).toEqual([]);
    expect(tagCounts([{}])).toEqual([]);
  });
});

describe("filterByTag", () => {
  it("keeps only activities carrying the tag, ignoring case", () => {
    expect(filterByTag(items, "PHONICS").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(filterByTag(items, "grade 1").map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("keeps everything when no tag is chosen", () => {
    expect(filterByTag(items, null)).toHaveLength(4);
  });

  it("combines with the search", () => {
    const tagged = filterByTag(items, "phonics");
    expect(filterActivities(tagged, "letter").map((entry) => entry.id)).toEqual(["b"]);
    expect(filterActivities(tagged, "counting")).toEqual([]);
  });
});

describe("normalizeTagInput", () => {
  it("adds a trimmed, collapsed tag to the end", () => {
    expect(normalizeTagInput("  grade \t 2 ", ["phonics"])).toEqual({
      tags: ["phonics", "grade 2"],
    });
  });

  it("changes nothing for an empty entry or a duplicate ignoring case", () => {
    expect(normalizeTagInput("   ", ["phonics"])).toEqual({ tags: ["phonics"] });
    expect(normalizeTagInput("PHONICS", ["phonics"])).toEqual({ tags: ["phonics"] });
  });

  it("names what the server would refuse", () => {
    expect(normalizeTagInput("x".repeat(TAG_MAX + 1), [])).toEqual({ problem: "tooLong" });
    expect(normalizeTagInput("x".repeat(TAG_MAX), [])).toEqual({ tags: ["x".repeat(TAG_MAX)] });
    expect(normalizeTagInput("bell\u0007", [])).toEqual({ problem: "invalid" });
    const full = Array.from({ length: TAGS_MAX }, (_, index) => `t${index}`);
    expect(normalizeTagInput("one more", full)).toEqual({ problem: "tooMany" });
    // A duplicate is still no change, even when full.
    expect(normalizeTagInput("T0", full)).toEqual({ tags: full });
  });
});
