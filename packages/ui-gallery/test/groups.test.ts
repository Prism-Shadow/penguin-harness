/**
 * The module groups: every module is in exactly one, the groups keep their fixed order and the
 * modules inside keep the index order, and both dictionaries name every group.
 */
import { describe, expect, it } from "vitest";
import { MODULE_IDS } from "../../ui/src/module";
import { GROUP_IDS, groupOf, MODULE_GROUPS } from "../src/lib/groups";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

describe("the module groups", () => {
  it("place every module in exactly one group", () => {
    const placed = MODULE_GROUPS.flatMap((group) => group.modules);
    expect([...placed].sort()).toEqual([...MODULE_IDS].sort());
    expect(new Set(placed).size).toBe(placed.length);
    for (const id of MODULE_IDS) {
      expect(MODULE_GROUPS.find((group) => group.id === groupOf(id))?.modules).toContain(id);
    }
  });

  it("keep the fixed group order, each group non-empty, its modules in index order", () => {
    expect(MODULE_GROUPS.map((group) => group.id)).toEqual([...GROUP_IDS]);
    for (const group of MODULE_GROUPS) {
      expect(group.modules.length, group.id).toBeGreaterThan(0);
      const order = group.modules.map((id) => MODULE_IDS.indexOf(id));
      expect(order, group.id).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("open on Foundations and close on Screens, as the index does", () => {
    expect(MODULE_GROUPS[0]).toEqual({ id: "foundations", modules: ["foundations"] });
    expect(MODULE_GROUPS[MODULE_GROUPS.length - 1]).toEqual({
      id: "screens",
      modules: ["screens"],
    });
  });

  it("have a title in both languages", () => {
    for (const id of GROUP_IDS) {
      expect(zh.groups[id].trim(), id).not.toBe("");
      expect(en.groups[id].trim(), id).not.toBe("");
    }
  });
});
