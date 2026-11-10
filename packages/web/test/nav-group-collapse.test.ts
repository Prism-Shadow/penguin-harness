/**
 * The sidebar's nav entries and how they fold (web-app/sidebar/nav-state.ts): every entry — New
 * chat, then the viewer's pages — is pinned (always shown) or collapsible (inside the area the
 * chevron folds away), and the fold and the pin choices each persist in one global
 * localStorage key.
 *
 * - New chat comes first, then the viewer's pages; a member sees the admin's pages minus the
 *   admin-only Machines page, and nothing else; an unreleased page is offered to nobody.
 * - By default New chat, Agents, the App Center, Models and Plugins are pinned and the rest
 *   collapsible; a member's areas are cut from their own entries.
 * - A pin toggle stores only the deviation from the default, both areas keep page order
 *   whatever order the moves came in, moving back removes the stored choice, and a move that
 *   changes nothing returns the same record. New chat is always pinned.
 * - Everything pinned leaves nothing to fold; everything collapsible folds to New chat alone.
 * - Expanded shows the pinned area then the collapsible one; collapsed shows the pinned area.
 * - With nothing stored the fold is expanded and no pin is moved, and reading writes nothing;
 *   each choice persists and a remount reads it back.
 * - An unrecognized fold value reads as expanded; pin choices keep only known entries with
 *   boolean values, and anything unparseable reads as none.
 * - A storage that throws (quota, private mode, a throwing getter) never escapes: storing is a
 *   no-op and reading yields the defaults.
 * - A contributed mode (company mode): with nothing stored no row is a favourite, so all start
 *   in the fold. Starring one moves it to the favourites in the mode's order and is kept under
 *   that mode's own key; a remount reads it back, and unstarring removes the stored choice.
 * - Starring in one mode never moves an entry in another: no mode's choices are written to, or
 *   read from, another's key.
 */
import { describe, expect, it } from "vitest";
import {
  MODE_NAV_PINNED_PREFIX,
  NAV_GROUP_COLLAPSED_KEY,
  NAV_PINNED_KEY,
  initialModeNavPinOverrides,
  initialNavGroupCollapsed,
  initialNavPinOverrides,
  isNavPinnable,
  isNavPinned,
  navEntryKeysFor,
  navKeysFor,
  splitModeNavItems,
  splitNavEntries,
  storeNavGroupCollapsed,
  storeModeNavPinOverrides,
  storeNavPinOverrides,
  visibleNavKeys,
  withModeNavPinned,
  withNavPinned,
  type NavCollapseStorage,
  type NavPage,
  type NavPinOverrides,
} from "../src/web-app/sidebar/nav-state";
import { blockedStorage, memoryStorage } from "./helpers/storage";

/** The main nav as the modules contribute it (web-root.test.ts pins the real one to this). */
const NAV: readonly NavPage[] = [
  { key: "agents", admin: false, released: true },
  { key: "apps", admin: false, released: true },
  { key: "models", admin: false, released: true },
  { key: "plugins", admin: false, released: true },
  { key: "machines", admin: true, released: true },
  { key: "usage", admin: false, released: true },
  { key: "benchmark", admin: false, released: true },
];

/** Storage whose GETTER throws (blocked site data): touching the method itself raises. */
const hostileStorage = {
  get getItem(): never {
    throw new Error("SecurityError");
  },
  setItem: () => undefined,
} as unknown as NavCollapseStorage;

describe("navEntryKeysFor", () => {
  it("puts New chat first, then this user's pages", () => {
    expect([...navEntryKeysFor(NAV, true)]).toEqual(["newChat", ...navKeysFor(NAV, true)]);
    expect([...navEntryKeysFor(NAV, false)]).toEqual(["newChat", ...navKeysFor(NAV, false)]);
  });
});

describe("navKeysFor", () => {
  it("a member sees the admin's entries minus Machines, which the server refuses them", () => {
    // /api/machines is admin-gated server-side (it spawns ssh with the server account's
    // keys), so offering a member the row would only ever produce a 403.
    expect(navKeysFor(NAV, true)).toContain("machines");
    expect(navKeysFor(NAV, false)).toEqual(
      navKeysFor(NAV, true).filter((key) => key !== "machines"),
    );
  });

  it("offers an unreleased page to nobody, and keeps the rest in page order", () => {
    const nav = NAV.map((p) => (p.key === "usage" ? { ...p, released: false } : p));
    expect(navKeysFor(nav, true)).toEqual([
      "agents",
      "apps",
      "models",
      "plugins",
      "machines",
      "benchmark",
    ]);
    expect(navKeysFor(nav, false)).toEqual(["agents", "apps", "models", "plugins", "benchmark"]);
  });
});

describe("pinned vs. collapsible", () => {
  it("defaults: New chat, Agents, the App Center, Models and Plugins pinned; the rest collapsible", () => {
    expect(splitNavEntries(navEntryKeysFor(NAV, true), {})).toEqual({
      pinned: ["newChat", "agents", "apps", "models", "plugins"],
      collapsible: ["machines", "usage", "benchmark"],
    });
  });

  it("a member's areas are cut from their own entries: an admin-only page is in neither", () => {
    expect(splitNavEntries(navEntryKeysFor(NAV, false), {})).toEqual({
      pinned: ["newChat", "agents", "apps", "models", "plugins"],
      collapsible: ["usage", "benchmark"],
    });
    // A choice stored for it (an admin signed in on this browser before) offers nothing.
    const { pinned, collapsible } = splitNavEntries(navEntryKeysFor(NAV, false), {
      machines: true,
    });
    expect([...pinned, ...collapsible]).not.toContain("machines");
  });

  it("unpinning stores the deviation, and the entry joins the collapsible area in manifest order", () => {
    const unpinned = withNavPinned({}, "models", false);
    expect(unpinned).toEqual({ models: false });
    expect(isNavPinned("models", unpinned)).toBe(false);
    // Models lands ahead of Machines (its manifest place), not at the end it was moved to.
    expect(splitNavEntries(navEntryKeysFor(NAV, true), unpinned)).toEqual({
      pinned: ["newChat", "agents", "apps", "plugins"],
      collapsible: ["models", "machines", "usage", "benchmark"],
    });
  });

  it("pinning a collapsible entry keeps manifest order however the moves were ordered", () => {
    const first = withNavPinned(withNavPinned({}, "benchmark", true), "usage", true);
    const second = withNavPinned(withNavPinned({}, "usage", true), "benchmark", true);
    expect(first).toEqual(second);
    expect(splitNavEntries(navEntryKeysFor(NAV, true), first)).toEqual({
      pinned: ["newChat", "agents", "apps", "models", "plugins", "usage", "benchmark"],
      collapsible: ["machines"],
    });
  });

  it("moving an entry back to its default removes the stored choice", () => {
    const back = withNavPinned(withNavPinned({}, "models", false), "models", true);
    expect(back).toEqual({});
    expect("models" in back).toBe(false);
    const machines = withNavPinned(withNavPinned({}, "machines", true), "machines", false);
    expect(machines).toEqual({});
  });

  it("a move that changes nothing returns the same object, so the caller skips the write", () => {
    const overrides: NavPinOverrides = { models: false };
    expect(withNavPinned(overrides, "agents", true)).toBe(overrides);
    expect(withNavPinned(overrides, "models", false)).toBe(overrides);
    expect(withNavPinned(overrides, "usage", false)).toBe(overrides);
  });

  it("New chat is always pinned: no choice moves it, and a stored one is ignored", () => {
    expect(isNavPinnable("newChat")).toBe(false);
    expect(isNavPinnable("usage")).toBe(true);
    const overrides: NavPinOverrides = {};
    expect(withNavPinned(overrides, "newChat", false)).toBe(overrides);
    expect(isNavPinned("newChat", { newChat: false })).toBe(true);
    expect(splitNavEntries(navEntryKeysFor(NAV, true), { newChat: false }).pinned[0]).toBe(
      "newChat",
    );
    const storage = memoryStorage();
    storage.setItem(NAV_PINNED_KEY, JSON.stringify({ newChat: false, usage: true }));
    expect(initialNavPinOverrides(NAV, storage)).toEqual({ usage: true });
  });

  it("everything pinned leaves the collapsible area empty, so folding hides nothing", () => {
    let overrides: NavPinOverrides = {};
    for (const key of navEntryKeysFor(NAV, true)) overrides = withNavPinned(overrides, key, true);
    expect(overrides).toEqual({ machines: true, usage: true, benchmark: true });
    const { collapsible } = splitNavEntries(navEntryKeysFor(NAV, true), overrides);
    expect(collapsible).toEqual([]);
    expect(visibleNavKeys(NAV, true, true, overrides)).toEqual(navEntryKeysFor(NAV, true));
  });

  it("everything collapsible still leaves New chat pinned, and folding shows only it", () => {
    let overrides: NavPinOverrides = {};
    for (const key of navEntryKeysFor(NAV, true)) overrides = withNavPinned(overrides, key, false);
    expect(splitNavEntries(navEntryKeysFor(NAV, true), overrides).pinned).toEqual(["newChat"]);
    expect(visibleNavKeys(NAV, true, true, overrides)).toEqual(["newChat"]);
  });
});

describe("visibleNavKeys", () => {
  it("expanded shows the viewer's every entry; collapsed leaves only the pinned ones visible and reachable (the sidebar renders the folded rows inert at zero height)", () => {
    expect(visibleNavKeys(NAV, false)).toEqual(navEntryKeysFor(NAV, true));
    expect(visibleNavKeys(NAV, true)).toEqual(["newChat", "agents", "apps", "models", "plugins"]);
    expect(visibleNavKeys(NAV, false, false)).toEqual(navEntryKeysFor(NAV, false));
    expect(visibleNavKeys(NAV, true, false)).toEqual([
      "newChat",
      "agents",
      "apps",
      "models",
      "plugins",
    ]);
  });

  it("renders the pinned area first, then the collapsible one", () => {
    const overrides = withNavPinned({}, "models", false);
    expect(visibleNavKeys(NAV, false, true, overrides)).toEqual([
      "newChat",
      "agents",
      "apps",
      "plugins",
      "models",
      "machines",
      "usage",
      "benchmark",
    ]);
    expect(visibleNavKeys(NAV, true, true, overrides)).toEqual([
      "newChat",
      "agents",
      "apps",
      "plugins",
    ]);
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
    // Collapse: what the sidebar renders shrinks to the pinned entries and the toggle …
    storeNavGroupCollapsed(true, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("collapsed");
    // … and a re-mount (initialNavGroupCollapsed is the useState initializer) restores it.
    expect(initialNavGroupCollapsed(s)).toBe(true);
    expect(visibleNavKeys(NAV, initialNavGroupCollapsed(s))).toEqual([
      "newChat",
      "agents",
      "apps",
      "models",
      "plugins",
    ]);
    // Expand again: the choice round-trips both ways.
    storeNavGroupCollapsed(false, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("expanded");
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(visibleNavKeys(NAV, initialNavGroupCollapsed(s))).toEqual(navEntryKeysFor(NAV, true));
  });

  it("a stored collapsed state folds the collapsible area only; the pinned entries stay", () => {
    const s = memoryStorage({ [NAV_GROUP_COLLAPSED_KEY]: "collapsed" });
    expect(initialNavGroupCollapsed(s)).toBe(true);
    const shown = visibleNavKeys(
      NAV,
      initialNavGroupCollapsed(s),
      true,
      initialNavPinOverrides(NAV, s),
    );
    expect(shown).toEqual(["newChat", "agents", "apps", "models", "plugins"]);
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
    expect(() => initialNavGroupCollapsed(hostileStorage)).not.toThrow();
    expect(initialNavGroupCollapsed(hostileStorage)).toBe(false);
  });
});

describe("persisted pin choices (one global localStorage key)", () => {
  it("nothing stored reads as no choices — the defaults — and reading never writes", () => {
    const s = memoryStorage();
    expect(initialNavPinOverrides(NAV, s)).toEqual({});
    expect(s.map.size).toBe(0);
  });

  it("a move → store → a fresh mount-time read restores the areas", () => {
    const s = memoryStorage();
    const moved = withNavPinned(withNavPinned({}, "models", false), "usage", true);
    storeNavPinOverrides(moved, s);
    expect(JSON.parse(s.map.get(NAV_PINNED_KEY)!)).toEqual({ models: false, usage: true });
    const restored = initialNavPinOverrides(NAV, s);
    expect(restored).toEqual(moved);
    expect(splitNavEntries(navEntryKeysFor(NAV, true), restored)).toEqual({
      pinned: ["newChat", "agents", "apps", "plugins", "usage"],
      collapsible: ["models", "machines", "benchmark"],
    });
  });

  it("only the deviations are stored: moving back empties the record", () => {
    const s = memoryStorage();
    storeNavPinOverrides(withNavPinned(withNavPinned({}, "models", false), "models", true), s);
    expect(s.map.get(NAV_PINNED_KEY)).toBe("{}");
  });

  it("keys this build does not know are ignored, so a page without a stored choice takes its default", () => {
    const s = memoryStorage({
      [NAV_PINNED_KEY]: JSON.stringify({
        traces: true,
        reports: false,
        models: false,
        machines: true,
      }),
    });
    // machines is admin-only but still a manifest key: an admin's choice survives a member's
    // visit in the same browser.
    expect(initialNavPinOverrides(NAV, s)).toEqual({ models: false, machines: true });
  });

  it("a value that is not a boolean is ignored, and the entry keeps its default", () => {
    const s = memoryStorage({
      [NAV_PINNED_KEY]: JSON.stringify({ models: "false", usage: 1, agents: null }),
    });
    expect(initialNavPinOverrides(NAV, s)).toEqual({});
  });

  it("unparseable or non-object values read as no choices", () => {
    const s = memoryStorage();
    for (const raw of ["", "{", "null", "[]", '["models"]', "true", "7", '"models"']) {
      s.map.set(NAV_PINNED_KEY, raw);
      expect(initialNavPinOverrides(NAV, s), raw).toEqual({});
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the defaults", () => {
    const broken = blockedStorage();
    expect(() => storeNavPinOverrides({ models: false }, broken)).not.toThrow();
    expect(initialNavPinOverrides(NAV, broken)).toEqual({});
  });

  it("storage whose GETTER throws degrades instead of escaping the useState initializer", () => {
    expect(() => initialNavPinOverrides(NAV, hostileStorage)).not.toThrow();
    expect(initialNavPinOverrides(NAV, hostileStorage)).toEqual({});
  });
});

describe("a contributed mode's favourites (a localStorage key per mode)", () => {
  /** Company mode's rows as its contribution lists them. */
  const ORG = ["overview", "chart", "calendar", "tickets", "finance", "handbook"].map((key) => ({
    key,
  }));
  const keysOf = (rows: readonly { key: string }[]) => rows.map((r) => r.key);

  it("with nothing stored no row is a favourite: all start in the fold, and reading writes nothing", () => {
    const s = memoryStorage();
    const { pinned, collapsible } = splitModeNavItems(
      ORG,
      initialModeNavPinOverrides("company", s),
    );
    expect(pinned).toEqual([]);
    expect(keysOf(collapsible)).toEqual(keysOf(ORG));
    expect(s.map.size).toBe(0);
  });

  it("a star moves a row to the favourites in the mode's order, a remount reads it back, and unstarring forgets it", () => {
    const s = memoryStorage();
    const starred = withModeNavPinned(withModeNavPinned({}, "finance", true), "chart", true);
    storeModeNavPinOverrides("company", starred, s);
    const restored = initialModeNavPinOverrides("company", s);
    const split = splitModeNavItems(ORG, restored);
    expect(keysOf(split.pinned)).toEqual(["chart", "finance"]);
    expect(keysOf(split.collapsible)).toEqual(["overview", "calendar", "tickets", "handbook"]);
    const back = withModeNavPinned(restored, "chart", false);
    expect(back).toEqual({ finance: true });
    // A star that changes nothing returns the same record, so the sidebar skips the write.
    expect(withModeNavPinned(back, "finance", true)).toBe(back);
    expect(withModeNavPinned(back, "overview", false)).toBe(back);
  });

  it("a star in one mode never moves an entry in another", () => {
    const s = memoryStorage();
    storeNavPinOverrides(withNavPinned({}, "models", false), s);
    const devBefore = s.map.get(NAV_PINNED_KEY);
    storeModeNavPinOverrides("company", withModeNavPinned({}, "tickets", true), s);
    // Company mode's star left development mode's record and its areas as they were …
    expect(s.map.get(NAV_PINNED_KEY)).toBe(devBefore);
    expect(
      splitNavEntries(navEntryKeysFor(NAV, true), initialNavPinOverrides(NAV, s)).pinned,
    ).toEqual(["newChat", "agents", "apps", "plugins"]);
    // … development mode's star moved nothing in company mode, nor company's in another mode.
    expect(keysOf(splitModeNavItems(ORG, initialModeNavPinOverrides("company", s)).pinned)).toEqual(
      ["tickets"],
    );
    expect(initialModeNavPinOverrides("other", s)).toEqual({});
    expect(s.map.has(`${MODE_NAV_PINNED_PREFIX}company`)).toBe(true);
  });

  it("storage that throws reads as no favourites and is never escaped", () => {
    expect(() =>
      storeModeNavPinOverrides("company", { overview: true }, blockedStorage()),
    ).not.toThrow();
    expect(initialModeNavPinOverrides("company", blockedStorage())).toEqual({});
    expect(initialModeNavPinOverrides("company", hostileStorage)).toEqual({});
  });
});
