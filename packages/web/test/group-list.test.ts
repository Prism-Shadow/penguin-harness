/**
 * group-list.tsx pure helpers: the sidebar header's mode-dependent create button —
 * the created object follows the grouping mode (用户口径: 具体新建的对象按分组方式决定).
 * Agent grouping creates an Agent (the Agents page's existing create dialog, reached
 * via route state); workspace grouping creates a Workspace (a new-chat draft — there
 * is no standalone Workspace entity, one comes into being with the conversation
 * created in it).
 *
 * Plus the list-options menu's glyphs. The icons are decorative — every row keeps its
 * own text label — but they are only worth drawing if they tell the options apart, so
 * the mapping is pinned per option rather than merely asserted non-empty. Grouping reads
 * its glyphs from the same map the two-icon header toggle uses, so a mode cannot end up
 * wearing one icon in the toggle and another in the menu.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_GROUP_ICON,
  CLOCK_ICON,
  FOLDER_ICON,
  GROUP_MODE_ICONS,
  REORDER_ICON,
  SORT_MODE_ICONS,
  newEntityForGroupMode,
} from "../src/components/ui/group-list";
import type { GroupMode } from "../src/components/ui/group-list";
import type { SessionSortMode } from "../src/lib/session-order";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("newEntityForGroupMode", () => {
  it("agent grouping creates an Agent; workspace grouping (the default) creates a Workspace", () => {
    expect(newEntityForGroupMode("agent")).toBe("agent");
    expect(newEntityForGroupMode("workspace")).toBe("workspace");
  });
});

describe("list-options glyphs", () => {
  it("names each grouping mode by what the list is grouped into", () => {
    // The same glyphs the header's grouping toggle shows, so the two surfaces agree.
    expect(GROUP_MODE_ICONS).toEqual({ workspace: FOLDER_ICON, agent: AGENT_GROUP_ICON });
  });

  it("names each sort mode by what decides the order: a clock, and the reorder arrows", () => {
    expect(SORT_MODE_ICONS).toEqual({ recent: CLOCK_ICON, manual: REORDER_ICON });
  });

  it("covers every option of both menus exactly once", () => {
    const groupModes: GroupMode[] = ["workspace", "agent"];
    const sortModes: SessionSortMode[] = ["recent", "manual"];
    expect(Object.keys(GROUP_MODE_ICONS).sort()).toEqual([...groupModes].sort());
    expect(Object.keys(SORT_MODE_ICONS).sort()).toEqual([...sortModes].sort());
  });

  it("gives all four rows glyphs that differ, so an icon distinguishes rather than decorates", () => {
    const icons = [...Object.values(GROUP_MODE_ICONS), ...Object.values(SORT_MODE_ICONS)];
    expect(icons.every((d) => d.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("leaves every row a real label in both locales — the glyph never carries the name", () => {
    for (const dict of [zh, en]) {
      expect(dict.chat.groupByWorkspace).toBeTruthy();
      expect(dict.chat.groupByAgent).toBeTruthy();
      expect(dict.chat.sortRecent).toBeTruthy();
      expect(dict.chat.sortManual).toBeTruthy();
    }
  });
});
