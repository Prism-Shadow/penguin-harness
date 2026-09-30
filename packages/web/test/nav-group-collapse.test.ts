/**
 * nav-group-collapse.ts unit tests: the sidebar's nav entries and how they fold. In
 * development mode every entry — New chat, then the page manifest — is pinned (always shown)
 * or collapsible (inside the area a nav-row-wide chevron button folds away; no label —
 * tooltip and aria carry the collapse/expand names; arrow up = collapse, and the button
 * itself stays while collapsed as the way back). New chat, Agents, Models and Plugins are
 * pinned by default; a pin toggle or a drop moves an entry across, only the changes from the
 * defaults are stored, and both areas keep manifest order. The fold and the pin choices each
 * persist in one global localStorage key (injectable storage): a remount reads them back, and
 * nothing stored / unrecognized values / throwing storage all fall back to the defaults.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PINNED_NAV_KEYS,
  NAV_GROUP_COLLAPSED_KEY,
  NAV_GROUP_KEYS,
  NAV_PINNED_KEY,
  initialNavGroupCollapsed,
  initialNavPinOverrides,
  isNavPinnable,
  isNavPinned,
  navEntryKeysFor,
  navKeysFor,
  splitNavEntries,
  storeNavGroupCollapsed,
  storeNavPinOverrides,
  visibleNavKeys,
  withNavPinned,
} from "../src/lib/nav-group-collapse";
import type { NavCollapseStorage, NavPinOverrides } from "../src/lib/nav-group-collapse";
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

/** Storage whose every call throws (quota exceeded / private mode). */
const brokenStorage: NavCollapseStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

/** Storage whose GETTER throws (blocked site data): touching the method itself raises. */
const hostileStorage = {
  get getItem(): never {
    throw new Error("SecurityError");
  },
  setItem: () => undefined,
} as unknown as NavCollapseStorage;

describe("NAV_GROUP_KEYS", () => {
  it("covers exactly the Agents → Evaluation Center range, in rendered order", () => {
    // Traces is deliberately absent: the Trace panel moved into the chat toolbar's panel
    // switcher (features/dock), and /traces stays reachable through its deep links only.
    expect([...NAV_GROUP_KEYS]).toEqual([
      "agents",
      "models",
      "plugins",
      "machines",
      "usage",
      "benchmark",
    ]);
    // Pin the endpoints by label: a manifest edit that shifts the range shows up here.
    expect(zh.nav[NAV_GROUP_KEYS[0]!]).toBe("智能体");
    expect(zh.nav[NAV_GROUP_KEYS[NAV_GROUP_KEYS.length - 1]!]).toBe("评估中心");
  });

  it("every entry has a zh label, an en label, and a nav icon (the sidebar renders straight off the manifest)", () => {
    for (const key of NAV_GROUP_KEYS) {
      expect(zh.nav[key]).toBeTruthy();
      expect(en.nav[key]).toBeTruthy();
      expect(NAV_ICONS[key]).toBeTruthy();
    }
  });

  it("New chat is not a page of the manifest: it opens a draft, not a route", () => {
    expect(NAV_GROUP_KEYS as readonly string[]).not.toContain("newChat");
    expect(NAV_GROUP_KEYS as readonly string[]).not.toContain("chat");
  });
});

describe("navEntryKeysFor", () => {
  it("puts New chat first, then this user's pages", () => {
    expect([...navEntryKeysFor(true)]).toEqual(["newChat", ...navKeysFor(true)]);
    expect([...navEntryKeysFor(false)]).toEqual(["newChat", ...navKeysFor(false)]);
  });

  it("reads one set of names in one order, in both languages", () => {
    const keys = navEntryKeysFor(true);
    expect(keys.map((key) => zh.nav[key])).toEqual([
      "新建对话",
      "智能体",
      "模型库",
      "插件市场",
      "机器管理",
      "成本中心",
      "评估中心",
    ]);
    expect(keys.map((key) => en.nav[key])).toEqual([
      "New chat",
      "Agents",
      "Models",
      "Plugins",
      "Machines",
      "Cost Center",
      "Evaluation Center",
    ]);
  });

  it("New chat's nav label is the one its tooltip and the collapsed rail use", () => {
    expect(zh.nav.newChat).toBe(zh.chat.newSessionMenu);
    expect(en.nav.newChat).toBe(en.chat.newSessionMenu);
  });

  it("the Machines page heading is its nav label", () => {
    expect(zh.machines.pageTitle).toBe(zh.nav.machines);
    expect(en.machines.pageTitle).toBe(en.nav.machines);
  });
});

describe("navKeysFor", () => {
  it("hides the admin-only entries from a member, and nothing else", () => {
    // /api/machines is admin-gated server-side (it spawns ssh with the server account's
    // keys), so offering a member the row would only ever produce a 403.
    expect([...navKeysFor(false)]).toEqual(["agents", "models", "plugins", "usage", "benchmark"]);
    // An admin sees the whole manifest, machines included — the row it hides from a member.
    // The Plugins page carries the built-in library and the deployment's registry both,
    // under one key.
    expect([...navKeysFor(true)]).toEqual([...NAV_GROUP_KEYS]);
    expect(NAV_GROUP_KEYS as readonly string[]).toContain("machines");
  });
});

describe("pinned vs. collapsible", () => {
  it("defaults: New chat, Agents, Models and Plugins pinned; the rest collapsible", () => {
    expect([...DEFAULT_PINNED_NAV_KEYS]).toEqual(["newChat", "agents", "models", "plugins"]);
    expect(splitNavEntries(navEntryKeysFor(true), {})).toEqual({
      pinned: ["newChat", "agents", "models", "plugins"],
      collapsible: ["machines", "usage", "benchmark"],
    });
  });

  it("a member's areas are cut from their own entries: an admin-only page is in neither", () => {
    expect(splitNavEntries(navEntryKeysFor(false), {})).toEqual({
      pinned: ["newChat", "agents", "models", "plugins"],
      collapsible: ["usage", "benchmark"],
    });
    // A choice stored for it (an admin signed in on this browser before) offers nothing.
    const { pinned, collapsible } = splitNavEntries(navEntryKeysFor(false), { machines: true });
    expect([...pinned, ...collapsible]).not.toContain("machines");
  });

  it("unpinning stores the deviation, and the entry joins the collapsible area in manifest order", () => {
    const unpinned = withNavPinned({}, "models", false);
    expect(unpinned).toEqual({ models: false });
    expect(isNavPinned("models", unpinned)).toBe(false);
    // Models lands ahead of Machines (its manifest place), not at the end it was moved to.
    expect(splitNavEntries(navEntryKeysFor(true), unpinned)).toEqual({
      pinned: ["newChat", "agents", "plugins"],
      collapsible: ["models", "machines", "usage", "benchmark"],
    });
  });

  it("pinning a collapsible entry keeps manifest order however the moves were ordered", () => {
    const first = withNavPinned(withNavPinned({}, "benchmark", true), "usage", true);
    const second = withNavPinned(withNavPinned({}, "usage", true), "benchmark", true);
    expect(first).toEqual(second);
    expect(splitNavEntries(navEntryKeysFor(true), first)).toEqual({
      pinned: ["newChat", "agents", "models", "plugins", "usage", "benchmark"],
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
    expect(splitNavEntries(navEntryKeysFor(true), { newChat: false }).pinned[0]).toBe("newChat");
    const storage = memStorage();
    storage.setItem(NAV_PINNED_KEY, JSON.stringify({ newChat: false, usage: true }));
    expect(initialNavPinOverrides(storage)).toEqual({ usage: true });
  });

  it("everything pinned leaves the collapsible area empty, so folding hides nothing", () => {
    let overrides: NavPinOverrides = {};
    for (const key of navEntryKeysFor(true)) overrides = withNavPinned(overrides, key, true);
    expect(overrides).toEqual({ machines: true, usage: true, benchmark: true });
    const { collapsible } = splitNavEntries(navEntryKeysFor(true), overrides);
    expect(collapsible).toEqual([]);
    expect(visibleNavKeys(true, true, overrides)).toEqual(navEntryKeysFor(true));
  });

  it("everything collapsible still leaves New chat pinned, and folding shows only it", () => {
    let overrides: NavPinOverrides = {};
    for (const key of navEntryKeysFor(true)) overrides = withNavPinned(overrides, key, false);
    expect(splitNavEntries(navEntryKeysFor(true), overrides).pinned).toEqual(["newChat"]);
    expect(visibleNavKeys(true, true, overrides)).toEqual(["newChat"]);
  });

  it("the pin toggle's accessible names exist in both languages, pin and unpin distinct", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      expect(dict.nav.pinEntry, locale).toBeTruthy();
      expect(dict.nav.unpinEntry, locale).toBeTruthy();
      expect(dict.nav.pinEntry, locale).not.toBe(dict.nav.unpinEntry);
    }
  });
});

describe("visibleNavKeys", () => {
  it("expanded shows every entry; collapsed leaves only the pinned ones visible and reachable (the sidebar renders the folded rows inert at zero height)", () => {
    expect(visibleNavKeys(false)).toEqual(navEntryKeysFor(true));
    expect(visibleNavKeys(true)).toEqual(["newChat", "agents", "models", "plugins"]);
  });

  it("a member's nav is their own manifest, not the admin's", () => {
    expect(visibleNavKeys(false, false)).toEqual(navEntryKeysFor(false));
    expect(visibleNavKeys(true, false)).toEqual(["newChat", "agents", "models", "plugins"]);
  });

  it("renders the pinned area first, then the collapsible one", () => {
    const overrides = withNavPinned({}, "models", false);
    expect(visibleNavKeys(false, true, overrides)).toEqual([
      "newChat",
      "agents",
      "plugins",
      "models",
      "machines",
      "usage",
      "benchmark",
    ]);
    expect(visibleNavKeys(true, true, overrides)).toEqual(["newChat", "agents", "plugins"]);
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
    // Collapse: what the sidebar renders shrinks to the pinned entries and the toggle …
    storeNavGroupCollapsed(true, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("collapsed");
    // … and a re-mount (initialNavGroupCollapsed is the useState initializer) restores it.
    expect(initialNavGroupCollapsed(s)).toBe(true);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual([
      "newChat",
      "agents",
      "models",
      "plugins",
    ]);
    // Expand again: the choice round-trips both ways.
    storeNavGroupCollapsed(false, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("expanded");
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual(navEntryKeysFor(true));
  });

  it("a stored collapsed state folds the collapsible area only; the pinned entries stay", () => {
    const s = memStorage();
    s.map.set(NAV_GROUP_COLLAPSED_KEY, "collapsed");
    expect(initialNavGroupCollapsed(s)).toBe(true);
    const shown = visibleNavKeys(initialNavGroupCollapsed(s), true, initialNavPinOverrides(s));
    expect(shown).toEqual(["newChat", "agents", "models", "plugins"]);
  });

  it("unrecognized stored values fall back to expanded", () => {
    const s = memStorage();
    for (const raw of ["", "true", "1", "COLLAPSED", "yes"]) {
      s.map.set(NAV_GROUP_COLLAPSED_KEY, raw);
      expect(initialNavGroupCollapsed(s)).toBe(false);
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the default", () => {
    expect(() => storeNavGroupCollapsed(true, brokenStorage)).not.toThrow();
    expect(initialNavGroupCollapsed(brokenStorage)).toBe(false);
  });

  it("storage whose GETTER throws (blocked site data) degrades instead of escaping the useState initializer", () => {
    expect(() => initialNavGroupCollapsed(hostileStorage)).not.toThrow();
    expect(initialNavGroupCollapsed(hostileStorage)).toBe(false);
  });
});

describe("persisted pin choices (one global localStorage key)", () => {
  it("nothing stored reads as no choices — the defaults — and reading never writes", () => {
    const s = memStorage();
    expect(initialNavPinOverrides(s)).toEqual({});
    expect(s.map.size).toBe(0);
  });

  it("a move → store → a fresh mount-time read restores the areas", () => {
    const s = memStorage();
    const moved = withNavPinned(withNavPinned({}, "models", false), "usage", true);
    storeNavPinOverrides(moved, s);
    expect(JSON.parse(s.map.get(NAV_PINNED_KEY)!)).toEqual({ models: false, usage: true });
    const restored = initialNavPinOverrides(s);
    expect(restored).toEqual(moved);
    expect(splitNavEntries(navEntryKeysFor(true), restored)).toEqual({
      pinned: ["newChat", "agents", "plugins", "usage"],
      collapsible: ["models", "machines", "benchmark"],
    });
  });

  it("only the deviations are stored: moving back empties the record", () => {
    const s = memStorage();
    storeNavPinOverrides(withNavPinned(withNavPinned({}, "models", false), "models", true), s);
    expect(s.map.get(NAV_PINNED_KEY)).toBe("{}");
  });

  it("keys this build does not know are ignored, so a page without a stored choice takes its default", () => {
    const s = memStorage();
    s.map.set(
      NAV_PINNED_KEY,
      JSON.stringify({ traces: true, apps: false, models: false, machines: true }),
    );
    // machines is admin-only but still a manifest key: an admin's choice survives a member's
    // visit in the same browser.
    expect(initialNavPinOverrides(s)).toEqual({ models: false, machines: true });
  });

  it("a value that is not a boolean is ignored, and the entry keeps its default", () => {
    const s = memStorage();
    s.map.set(NAV_PINNED_KEY, JSON.stringify({ models: "false", usage: 1, agents: null }));
    expect(initialNavPinOverrides(s)).toEqual({});
  });

  it("unparseable or non-object values read as no choices", () => {
    const s = memStorage();
    for (const raw of ["", "{", "null", "[]", '["models"]', "true", "7", '"models"']) {
      s.map.set(NAV_PINNED_KEY, raw);
      expect(initialNavPinOverrides(s), raw).toEqual({});
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the defaults", () => {
    expect(() => storeNavPinOverrides({ models: false }, brokenStorage)).not.toThrow();
    expect(initialNavPinOverrides(brokenStorage)).toEqual({});
  });

  it("storage whose GETTER throws degrades instead of escaping the useState initializer", () => {
    expect(() => initialNavPinOverrides(hostileStorage)).not.toThrow();
    expect(initialNavPinOverrides(hostileStorage)).toEqual({});
  });
});
