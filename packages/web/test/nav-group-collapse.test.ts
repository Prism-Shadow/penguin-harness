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
  navKeysFor,
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
    // Traces is deliberately absent: the Trace panel moved into the chat toolbar's panel
    // switcher (features/dock), and /traces stays reachable through its deep links only.
    expect([...NAV_GROUP_KEYS]).toEqual([
      "agents",
      "skills",
      "models",
      "machines",
      "usage",
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
    expect(zh.chat.newSessionMenu).toBeTruthy();
  });
});

describe("navKeysFor", () => {
  it("hides the admin-only entries from a member, and nothing else", () => {
    // /api/machines is admin-gated server-side (it spawns ssh with the server account's
    // keys), so offering a member the row would only ever produce a 403.
    expect([...navKeysFor(false)]).toEqual(["agents", "skills", "models", "usage", "benchmark"]);
    // An admin sees the whole manifest, machines included — the row it hides from a member.
    expect([...navKeysFor(true)]).toEqual([...NAV_GROUP_KEYS]);
  });
});

describe("visibleNavKeys", () => {
  it("expanded shows the whole group; collapsed leaves no entry visible or reachable (the sidebar renders the mounted rows inert at zero height)", () => {
    expect(visibleNavKeys(false)).toEqual(navKeysFor(true));
    expect(visibleNavKeys(true)).toEqual([]);
  });

  it("a member's expanded group is their own manifest, not the admin's", () => {
    expect(visibleNavKeys(false, false)).toEqual(navKeysFor(false));
    expect(visibleNavKeys(true, false)).toEqual([]);
  });

  it("the chevron-button toggle's accessible names exist in both languages (icon-only button: aria + tooltip carry them)", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      expect(dict.nav.collapseGroup, locale).toBeTruthy();
      expect(dict.nav.expandGroup, locale).toBeTruthy();
      // One button, two states: the same name for both would leave the state unreadable.
      expect(dict.nav.collapseGroup, locale).not.toBe(dict.nav.expandGroup);
    }
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
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual(navKeysFor(true));
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

  it("storage whose GETTER throws (blocked site data) degrades instead of escaping the useState initializer", () => {
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as NavCollapseStorage;
    expect(() => initialNavGroupCollapsed(hostile)).not.toThrow();
    expect(initialNavGroupCollapsed(hostile)).toBe(false);
  });
});
