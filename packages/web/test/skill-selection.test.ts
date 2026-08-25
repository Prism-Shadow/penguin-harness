/**
 * skill-selection.ts unit test: the selection arithmetic behind the multi-select skill panel —
 * the composer's toggle and the Agent create dialog's select-all / select-none, which act on the
 * names the search box currently leaves visible rather than on the whole library.
 */
import { describe, expect, it } from "vitest";
import {
  addSkillNames,
  removeSkillNames,
  toggleSkillName,
} from "../src/features/skills/skill-selection";

describe("skill selection arithmetic", () => {
  it("toggle adds an absent name at the end and drops a present one, keeping the rest in order", () => {
    expect(toggleSkillName(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleSkillName(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(toggleSkillName([], "a")).toEqual(["a"]);
  });

  it("select-all appends only what is missing, so an already-picked name keeps its position", () => {
    expect(addSkillNames(["c"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
    expect(addSkillNames([], ["a", "b"])).toEqual(["a", "b"]);
    expect(addSkillNames(["a"], [])).toEqual(["a"]);
  });

  it("select-none drops only the named entries, so a filtered clear leaves the rest picked", () => {
    expect(removeSkillNames(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(removeSkillNames(["a", "b"], ["a", "b"])).toEqual([]);
    expect(removeSkillNames(["a"], ["z"])).toEqual(["a"]);
  });

  it("never mutates the input array", () => {
    const selected = ["a", "b"];
    toggleSkillName(selected, "c");
    addSkillNames(selected, ["c"]);
    removeSkillNames(selected, ["a"]);
    expect(selected).toEqual(["a", "b"]);
  });
});
