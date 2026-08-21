/**
 * group-list.tsx pure helpers: the sidebar header's mode-dependent create button —
 * the created object follows the grouping mode (用户口径: 具体新建的对象按分组方式决定).
 * Agent grouping creates an Agent (the Agents page's existing create dialog, reached
 * via route state); workspace grouping creates a Workspace (a new-chat draft — there
 * is no standalone Workspace entity, one comes into being with the conversation
 * created in it); time grouping buckets by last activity, which nothing can be created
 * into, so it falls back to the conversation itself.
 *
 * Plus the list-options menu's glyphs. The icons are decorative — every row keeps its
 * own text label — but they are only worth drawing if they tell the options apart, so
 * the mapping is pinned per option rather than merely asserted non-empty. Grouping reads
 * its glyphs from the same map the two-icon header toggle uses, so a mode cannot end up
 * wearing one icon in the toggle and another in the menu.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_GROUP_ICON,
  CALENDAR_ICON,
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

  it("time grouping has no entity of its own, so it creates a conversation", () => {
    expect(newEntityForGroupMode("time")).toBe("chat");
  });
});

describe("list-options glyphs", () => {
  it("names each grouping mode by what the list is grouped into", () => {
    // The same glyphs the header's grouping toggle shows, so the two surfaces agree.
    expect(GROUP_MODE_ICONS).toEqual({
      workspace: FOLDER_ICON,
      agent: AGENT_GROUP_ICON,
      time: CALENDAR_ICON,
    });
  });

  it("names each sort mode by what decides the order: a clock, and the reorder arrows", () => {
    expect(SORT_MODE_ICONS).toEqual({ recent: CLOCK_ICON, manual: REORDER_ICON });
  });

  it("is what the menu rows and the header toggle both actually render", () => {
    // The claim worth pinning is not the map's contents but that nothing re-picks an icon
    // beside it: a hardcoded glyph at either call site is how the toggle and the menu would
    // drift apart. Node-only suite, so this reads the sources (title-reveal.test.ts).
    const read = (p: string) =>
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");
    const sidebar = read("../src/components/layout/sidebar.tsx");
    for (const mode of ["workspace", "agent", "time"] satisfies GroupMode[])
      expect(sidebar).toContain(`icon={GROUP_MODE_ICONS.${mode}}`);
    for (const mode of ["recent", "manual"] satisfies SessionSortMode[])
      expect(sidebar).toContain(`icon={SORT_MODE_ICONS.${mode}}`);
    // The header toggle reads the same map rather than the raw constants.
    expect(read("../src/components/ui/group-list.tsx")).toContain("GROUP_MODE_ICONS.workspace");
  });

  it("gives every row a glyph that differs, so an icon distinguishes rather than decorates", () => {
    // The calendar of "group by time" against the clock of "sort by recency" in particular:
    // two rows of one menu wearing one mark would read as one setting.
    const icons = [...Object.values(GROUP_MODE_ICONS), ...Object.values(SORT_MODE_ICONS)];
    expect(icons.every((d) => d.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("leaves every row a real label in both locales — the glyph never carries the name", () => {
    for (const dict of [zh, en]) {
      expect(dict.chat.groupByWorkspace).toBeTruthy();
      expect(dict.chat.groupByAgent).toBeTruthy();
      expect(dict.chat.groupByTime).toBeTruthy();
      for (const bucket of ["day", "month", "earlier"] as const)
        expect(dict.chat.timeGroups[bucket]).toBeTruthy();
      expect(dict.chat.sortRecent).toBeTruthy();
      expect(dict.chat.sortManual).toBeTruthy();
    }
  });
});
