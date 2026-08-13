/**
 * nav-group-collapse.ts unit tests: the sidebar's collapsible page-nav group, toggled
 * by a nav-row-wide chevron button under the group's last entry (no label — tooltip
 * and aria carry the collapse/expand names; arrow up = collapse, and the button
 * itself stays while collapsed as the way back). The group covers exactly
 * the 智能体 → 评估中心 run of entries in rendered order (the sidebar derives its nav
 * rows from the NAV_GROUP_KEYS manifest, so the range is pinned here); the pinned
 * "New chat" block is never part of the manifest, so collapsing cannot hide it. The
 * choice persists globally in one localStorage key (injectable storage): a remount
 * reads it back, nothing stored / unrecognized values / throwing storage all fall
 * back to expanded — the default.
 */
import { describe, expect, it } from "vitest";
import {
  NAV_GROUP_COLLAPSED_KEY,
  NAV_GROUP_KEYS,
  initialNavGroupCollapsed,
  storeNavGroupCollapsed,
  visibleNavKeys,
} from "../src/lib/nav-group-collapse";
import type { NavCollapseStorage } from "../src/lib/nav-group-collapse";
import { NAV_ICONS } from "../src/components/ui/icons";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** In-memory storage (vitest runs in a Node environment, no localStorage; draft-cache.test.ts convention). */
function memStorage(): NavCollapseStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("NAV_GROUP_KEYS", () => {
  it("covers exactly the 智能体 → 评估中心 range, in rendered order", () => {
    expect([...NAV_GROUP_KEYS]).toEqual([
      "agents",
      "skills",
      "models",
      "usage",
      "traces",
      "benchmark",
    ]);
    // Pin the endpoints by label: a manifest edit that shifts the range shows up here.
    expect(zh.nav[NAV_GROUP_KEYS[0]]).toBe("智能体");
    expect(zh.nav[NAV_GROUP_KEYS[NAV_GROUP_KEYS.length - 1]!]).toBe("评估中心");
  });

  it("every entry has a zh label, an en label, and a nav icon (the sidebar renders straight off the manifest)", () => {
    for (const key of NAV_GROUP_KEYS) {
      expect(zh.nav[key]).toBeTruthy();
      expect(en.nav[key]).toBeTruthy();
      expect(NAV_ICONS[key]).toBeTruthy();
    }
  });

  it("the pinned New chat entry is not in the group, so collapsing cannot hide it", () => {
    // The "New chat" block (S.chat.newSessionMenu, 「新建对话」) renders above the nav,
    // outside the group container — the manifest never governs it.
    expect(NAV_GROUP_KEYS as readonly string[]).not.toContain("newChat");
    expect(NAV_GROUP_KEYS as readonly string[]).not.toContain("chat");
    expect(zh.chat.newSessionMenu).toBe("新建对话");
  });
});

describe("visibleNavKeys", () => {
  it("expanded shows the whole group; collapsed leaves no entry visible or reachable (the sidebar renders the mounted rows inert at zero height)", () => {
    expect(visibleNavKeys(false)).toEqual(NAV_GROUP_KEYS);
    expect(visibleNavKeys(true)).toEqual([]);
  });

  it("the chevron-button toggle's accessible names exist in both languages (icon-only button: aria + tooltip carry them)", () => {
    expect(zh.nav.collapseGroup).toBe("折叠");
    expect(zh.nav.expandGroup).toBe("展开");
    expect(en.nav.collapseGroup).toBe("Collapse");
    expect(en.nav.expandGroup).toBe("Expand");
  });
});

describe("persisted collapse state (one global localStorage key)", () => {
  it("default is expanded with nothing stored, and reading never writes", () => {
    const s = memStorage();
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it("toggle → store → a fresh mount-time read restores the collapsed state", () => {
    const s = memStorage();
    // Collapse: what the sidebar renders shrinks to nothing but the header toggle …
    storeNavGroupCollapsed(true, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("collapsed");
    // … and a re-mount (initialNavGroupCollapsed is the useState initializer) restores it.
    expect(initialNavGroupCollapsed(s)).toBe(true);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual([]);
    // Expand again: the choice round-trips both ways.
    storeNavGroupCollapsed(false, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("expanded");
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual(NAV_GROUP_KEYS);
  });

  it("unrecognized stored values fall back to expanded", () => {
    const s = memStorage();
    for (const raw of ["", "true", "1", "COLLAPSED", "yes"]) {
      s.map.set(NAV_GROUP_COLLAPSED_KEY, raw);
      expect(initialNavGroupCollapsed(s)).toBe(false);
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the default", () => {
    const broken: NavCollapseStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => storeNavGroupCollapsed(true, broken)).not.toThrow();
    expect(initialNavGroupCollapsed(broken)).toBe(false);
  });
});
