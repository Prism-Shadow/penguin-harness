/**
 * The sidebar header's group-list helpers (components/ui/group-list.tsx).
 *
 * - The create button creates what the list is grouped into: an Agent in Agent grouping, a
 *   Workspace (a new-chat draft) in Workspace grouping, and a conversation in time grouping,
 *   which nothing can be created into.
 * - Every grouping and sort option in the list-options menu wears a different glyph, so an
 *   icon tells the options apart rather than decorating them.
 */
import { describe, expect, it } from "vitest";
import {
  GROUP_MODE_ICONS,
  SORT_MODE_ICONS,
  newEntityForGroupMode,
} from "../src/components/ui/group-list";

describe("newEntityForGroupMode", () => {
  it.each([
    ["agent", "agent"],
    ["workspace", "workspace"],
    ["time", "chat"],
  ] as const)("%s grouping creates a %s", (mode, entity) => {
    expect(newEntityForGroupMode(mode)).toBe(entity);
  });
});

describe("list-options glyphs", () => {
  it("gives every row a glyph that differs, so an icon distinguishes rather than decorates", () => {
    // The calendar of "group by time" against the clock of "sort by recency" in particular:
    // two rows of one menu wearing one mark would read as one setting.
    const icons = [...Object.values(GROUP_MODE_ICONS), ...Object.values(SORT_MODE_ICONS)];
    expect(icons.every((d) => d.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
