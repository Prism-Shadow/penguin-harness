/**
 * The sidebar's collapsible page-nav group (lib/nav-group-collapse.ts): which entries a user
 * sees, and the one global collapse preference in localStorage.
 *
 * - A member sees the admin's entries minus the admin-only Machines page, and nothing else.
 * - Expanded, the group shows the viewer's own entries; collapsed, none is visible.
 * - With nothing stored the group is expanded, and reading writes nothing.
 * - Collapsing and expanding each persist, and a remount reads the choice back.
 * - An unrecognized stored value reads as expanded.
 * - A storage that throws (quota, private mode, a throwing getter) never escapes: storing is
 *   a no-op and reading yields the expanded default.
 */
import { describe, expect, it } from "vitest";
import {
  NAV_GROUP_COLLAPSED_KEY,
  initialNavGroupCollapsed,
  navKeysFor,
  storeNavGroupCollapsed,
  visibleNavKeys,
} from "../src/lib/nav-group-collapse";
import type { NavCollapseStorage } from "../src/lib/nav-group-collapse";
import { blockedStorage, memoryStorage } from "./helpers/storage";

describe("navKeysFor", () => {
  it("a member sees the admin's entries minus Machines, which the server refuses them", () => {
    // /api/machines is admin-gated server-side (it spawns ssh with the server account's
    // keys), so offering a member the row would only ever produce a 403.
    expect(navKeysFor(true)).toContain("machines");
    expect(navKeysFor(false)).toEqual(navKeysFor(true).filter((key) => key !== "machines"));
  });
});

describe("visibleNavKeys", () => {
  it("expanded shows the viewer's own entries; collapsed leaves none visible (the sidebar renders the mounted rows inert at zero height)", () => {
    expect(visibleNavKeys(false)).toEqual(navKeysFor(true));
    expect(visibleNavKeys(false, false)).toEqual(navKeysFor(false));
    expect(visibleNavKeys(true)).toEqual([]);
    expect(visibleNavKeys(true, false)).toEqual([]);
  });
});

describe("persisted collapse state (one global localStorage key)", () => {
  it("default is expanded with nothing stored, and reading never writes", () => {
    const s = memoryStorage();
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it("toggle → store → a fresh mount-time read restores the collapsed state", () => {
    const s = memoryStorage();
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
    const s = memoryStorage();
    for (const raw of ["", "true", "1", "COLLAPSED", "yes"]) {
      s.map.set(NAV_GROUP_COLLAPSED_KEY, raw);
      expect(initialNavGroupCollapsed(s)).toBe(false);
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the default", () => {
    const broken = blockedStorage();
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
