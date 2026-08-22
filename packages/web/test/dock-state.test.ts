/**
 * The dock store (features/dock/dock-state.ts): two docks (right/bottom) of uniform tabs
 * — singleton panels plus per-shell terminal tabs — SCOPED per conversation like browser
 * windows managing their own tabs: switching Sessions switches the whole arrangement, and
 * no conversation's tabs depend on another's. An open dock with no tabs is still visible
 * (it shows the picker); closing a tab removes it, and the last tab closing puts the dock
 * away; a dock's own toggle hides it keeping its tabs.
 *
 * The module reads localStorage at import time, so the stub is installed first and the
 * module imported dynamically.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let dock: typeof import("../src/features/dock/dock-state");
/** The stub's backing map, so a test can assert what a RELOAD would read back. */
let store: Map<string, string>;

beforeAll(async () => {
  store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  dock = await import("../src/features/dock/dock-state");
});

let scopeSeq = 0;
/** A fresh, never-used conversation scope per test — scopes are the isolation boundary. */
beforeEach(() => {
  scopeSeq += 1;
  dock.setDockScope(`test-session-${scopeSeq}`);
});

describe("panel tabs", () => {
  it("opens a panel as a right-dock tab by default and shows it", () => {
    dock.openPanel("workspace");
    expect(dock.panelDock("workspace")).toBe("right");
    expect(dock.isDockVisible("right")).toBe(true);
    expect(dock.dockActiveKey("right")).toBe("workspace");
    expect(dock.isTabShown("workspace")).toBe(true);
  });

  it("keeps panels singletons: opening in the other dock MOVES the tab", () => {
    dock.openPanel("memory", "right");
    dock.openPanel("memory", "bottom");
    expect(dock.panelDock("memory")).toBe("bottom");
    expect(dock.dockTabs("right")).toHaveLength(0);
    expect(dock.dockTabs("bottom")).toHaveLength(1);
  });

  it("reopens a panel where its tab already lives instead of moving it home", () => {
    dock.openPanel("agents", "bottom");
    dock.openPanel("workspace", "bottom");
    dock.openPanel("agents"); // no position: the existing bottom tab activates
    expect(dock.panelDock("agents")).toBe("bottom");
    expect(dock.dockActiveKey("bottom")).toBe("agents");
  });

  it("closing a panel tab removes it; closing the last one puts the dock away", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    dock.closePanel("memory");
    expect(dock.panelDock("memory")).toBeNull();
    expect(dock.dockActiveKey("right")).toBe("workspace");
    expect(dock.isDockVisible("right")).toBe(true);
    dock.closePanel("workspace");
    expect(dock.isDockVisible("right")).toBe(false);
  });
});

describe("the toolbar's dock toggles and the picker", () => {
  it("an open dock with no tabs is visible (the picker state)", () => {
    expect(dock.isDockVisible("right")).toBe(false);
    dock.toggleDock("right");
    expect(dock.isDockVisible("right")).toBe(true);
    expect(dock.dockTabs("right")).toHaveLength(0);
    expect(dock.dockViews()).toEqual([
      { position: "right", merged: false, tabs: [], activeKey: null },
    ]);
    dock.toggleDock("right");
    expect(dock.isDockVisible("right")).toBe(false);
  });

  it("toggling a dock closed keeps its tabs for the next open", () => {
    dock.openPanel("workspace", "bottom");
    dock.toggleDock("bottom");
    expect(dock.isDockVisible("bottom")).toBe(false);
    expect(dock.dockTabs("bottom")).toHaveLength(1);
    dock.toggleDock("bottom");
    expect(dock.dockActiveKey("bottom")).toBe("workspace");
  });
});

describe("terminal tabs", () => {
  it("adds one tab per shell, defaulting to the bottom dock", () => {
    dock.addTerminalTab("term-a");
    dock.addTerminalTab("term-b");
    expect(dock.terminalTabDock("term-a")).toBe("bottom");
    expect(dock.terminalTabIds()).toEqual(["term-a", "term-b"]);
    expect(dock.dockActiveKey("bottom")).toBe("terminal:term-b");
  });

  it("shows an existing tab where it lives instead of duplicating it", () => {
    dock.addTerminalTab("term-a", "right");
    dock.addTerminalTab("term-b", "right");
    dock.showTerminal("term-a");
    expect(dock.terminalTabIds()).toEqual(["term-a", "term-b"]);
    expect(dock.dockActiveKey("right")).toBe("terminal:term-a");
  });

  it("mixes freely with panel tabs in one dock", () => {
    dock.openPanel("workspace", "bottom");
    dock.addTerminalTab("term-a", "bottom");
    expect(dock.dockTabs("bottom").map(dock.tabKey)).toEqual(["workspace", "terminal:term-a"]);
    dock.activateTab("workspace");
    expect(dock.isTabShown("workspace")).toBe(true);
    expect(dock.isTabShown("terminal:term-a")).toBe(false);
  });
});

describe("conversation scopes (each window manages its own tabs)", () => {
  it("switches the whole arrangement with the Session, and restores it on return", () => {
    const a = `scope-a-${scopeSeq}`;
    const b = `scope-b-${scopeSeq}`;
    dock.setDockScope(a);
    dock.openPanel("workspace", "right");
    dock.addTerminalTab("term-a", "bottom");

    // A conversation that never arranged anything shows nothing.
    dock.setDockScope(b);
    expect(dock.isDockVisible("right")).toBe(false);
    expect(dock.isDockVisible("bottom")).toBe(false);
    expect(dock.terminalTabIds()).toEqual([]);

    // B's own arrangement never leaks into A's, and A's comes back intact.
    dock.openPanel("memory", "bottom");
    dock.setDockScope(a);
    expect(dock.panelDock("workspace")).toBe("right");
    expect(dock.panelDock("memory")).toBeNull();
    expect(dock.terminalTabIds()).toEqual(["term-a"]);
  });

  it("does not lend one Session's terminals to another's docks", () => {
    const a = `scope-c-${scopeSeq}`;
    dock.setDockScope(a);
    dock.addTerminalTab("term-owned", "bottom");
    dock.setDockScope(`scope-d-${scopeSeq}`);
    expect(dock.terminalTabDock("term-owned")).toBeNull();
    // …and cross-scope ownership still counts: the shell is not adoptable here.
    expect(dock.unownedTerminals(["term-owned", "term-free"])).toEqual(["term-free"]);
  });

  it("hands a placeholder-scope arrangement to the first Session chosen", () => {
    dock.setDockScope(null); // ~none: /chat before it resolves to a conversation
    dock.addTerminalTab("term-staged", "bottom");
    dock.setDockScope(`scope-resolved-${scopeSeq}`);
    expect(dock.terminalTabDock("term-staged")).toBe("bottom");
    // Moved, not copied: going back off-conversation shows nothing.
    dock.setDockScope(null);
    expect(dock.terminalTabIds()).toEqual([]);
  });

  it("adoptDockScope moves a draft's arrangement to the born Session, never clobbering", () => {
    const draft = `new-${scopeSeq}`;
    const born = `scope-born-${scopeSeq}`;
    dock.setDockScope(draft);
    dock.openPanel("workspace", "right");
    dock.adoptDockScope(born);
    expect(dock.currentDockScope()).toBe(born);
    expect(dock.panelDock("workspace")).toBe("right");
    // The next draft starts clean rather than inheriting it.
    dock.setDockScope(draft);
    expect(dock.panelDock("workspace")).toBeNull();

    // Never clobbers a Session that already has an arrangement of its own.
    const owner = `scope-owner-${scopeSeq}`;
    dock.setDockScope(owner);
    dock.openPanel("memory", "bottom");
    dock.setDockScope(draft);
    dock.openPanel("trace", "right");
    dock.adoptDockScope(owner);
    expect(dock.panelDock("memory")).toBe("bottom");
    expect(dock.panelDock("trace")).toBeNull();
  });

  it("prunes dead shells' tabs across every scope, not just the one on screen", () => {
    const a = `scope-e-${scopeSeq}`;
    const b = `scope-f-${scopeSeq}`;
    dock.setDockScope(a);
    dock.addTerminalTab("term-dead", "bottom");
    dock.setDockScope(b);
    dock.addTerminalTab("term-live", "bottom");
    dock.pruneTerminalTabs(new Set(["term-live"]));
    expect(dock.terminalTabIds()).toEqual(["term-live"]);
    dock.setDockScope(a);
    expect(dock.terminalTabIds()).toEqual([]);
    expect(dock.isDockVisible("bottom")).toBe(false); // its only tab died: the dock went away
  });
});

describe("moving", () => {
  it("moves a single tab to the other dock and activates it there", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    dock.moveTab("workspace", "bottom");
    expect(dock.panelDock("workspace")).toBe("bottom");
    expect(dock.dockActiveKey("bottom")).toBe("workspace");
    // The source dock moved on to its remaining tab.
    expect(dock.dockActiveKey("right")).toBe("memory");
  });

  it("moving the only tab closes its source dock instead of leaving an empty surface", () => {
    dock.openPanel("workspace", "right");
    dock.moveTab("workspace", "bottom");
    expect(dock.isDockVisible("right")).toBe(false);
    expect(dock.isDockVisible("bottom")).toBe(true);
  });

  it("moves a whole dock, merging after the target's own tabs and keeping the shown tab", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "bottom");
    dock.moveDock("right", "bottom");
    expect(dock.isDockVisible("right")).toBe(false);
    expect(dock.dockTabs("bottom").map(dock.tabKey)).toEqual(["memory", "workspace"]);
    expect(dock.dockActiveKey("bottom")).toBe("workspace");
  });

  it("reorders a dock's strip only with a complete, matching key list", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    dock.reorderDock("right", ["memory", "workspace"]);
    expect(dock.dockTabs("right").map(dock.tabKey)).toEqual(["memory", "workspace"]);
    // A stale drag (a key that no longer exists) changes nothing.
    dock.reorderDock("right", ["memory", "trace"]);
    expect(dock.dockTabs("right").map(dock.tabKey)).toEqual(["memory", "workspace"]);
  });
});

describe("the terminal toggle (Ctrl+`)", () => {
  it("reports no tab so the caller adopts/creates, then hides and restores", () => {
    expect(dock.toggleTerminalDocks()).toBe(false); // nothing to toggle: async path takes over
    dock.addTerminalTab("term-a");
    expect(dock.toggleTerminalDocks()).toBe(true); // shown → hidden
    expect(dock.isDockVisible("bottom")).toBe(false);
    expect(dock.toggleTerminalDocks()).toBe(true); // hidden → shown again
    expect(dock.isDockVisible("bottom")).toBe(true);
    expect(dock.dockActiveKey("bottom")).toBe("terminal:term-a");
  });

  it("brings the terminal to the front when a panel covers it, instead of hiding", () => {
    dock.addTerminalTab("term-a", "bottom");
    dock.openPanel("workspace", "bottom"); // workspace now shown, terminal behind it
    expect(dock.toggleTerminalDocks()).toBe(true);
    expect(dock.dockActiveKey("bottom")).toBe("terminal:term-a");
  });
});

describe("persistence", () => {
  it("round-trips each scope's arrangement — tabs, active, open flags — across a reload", async () => {
    const a = `scope-persist-a-${scopeSeq}`;
    const b = `scope-persist-b-${scopeSeq}`;
    dock.setDockScope(a);
    dock.openPanel("workspace", "right");
    dock.addTerminalTab("term-a", "bottom");
    dock.toggleDock("bottom"); // hidden, tabs kept
    dock.setBottomRatio(0.5);
    dock.setDockScope(b);
    dock.openPanel("memory", "bottom");

    // Reload: a second module instance reading the same storage back from scratch.
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    reloaded.setDockScope(a);
    expect(reloaded.panelDock("workspace")).toBe("right");
    expect(reloaded.isDockVisible("right")).toBe(true);
    expect(reloaded.isDockVisible("bottom")).toBe(false); // hidden stays hidden
    expect(reloaded.terminalTabIds()).toEqual(["term-a"]);
    expect(reloaded.bottomRatio()).toBe(0.5); // sizes are one preference, not per scope
    reloaded.setDockScope(b);
    expect(reloaded.dockActiveKey("bottom")).toBe("memory");
  });

  it("degrades a malformed stored entry to empty docks", async () => {
    store.set(
      "penguin.dock.layout",
      '{"scopes": {"s": {"right": {"tabs": [42]}}}, "bottomRatio": "x"}',
    );
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    reloaded.setDockScope("s");
    expect(reloaded.dockTabs("right")).toHaveLength(0);
    expect(reloaded.isDockVisible("right")).toBe(false);
    expect(reloaded.bottomRatio()).toBeCloseTo(0.4);
  });
});

describe("instant changes (no animation)", () => {
  it("bumps instantVersion for scope switches and moves, not for toggles", () => {
    const before = dock.instantVersion();
    dock.openPanel("workspace", "right");
    dock.toggleDock("bottom");
    dock.removeTab("workspace");
    expect(dock.instantVersion()).toBe(before); // animated changes leave it alone
    dock.openPanel("workspace", "right");
    dock.moveTab("workspace", "bottom");
    expect(dock.instantVersion()).toBe(before + 1);
    dock.openPanel("memory", "bottom");
    dock.moveDock("bottom", "right");
    expect(dock.instantVersion()).toBe(before + 2);
    dock.setDockScope(`scope-instant-${scopeSeq}`);
    expect(dock.instantVersion()).toBe(before + 3);
  });
});

describe("the detach round trip", () => {
  it("restores a terminal tab into the scope it left, even while another is on screen", () => {
    const a = `scope-detach-a-${scopeSeq}`;
    dock.setDockScope(a);
    dock.addTerminalTab("term-win", "bottom");
    dock.removeTab("terminal:term-win"); // the detach: tab leaves while the shell moves out
    expect(dock.isDockVisible("bottom")).toBe(false);

    dock.setDockScope(`scope-detach-b-${scopeSeq}`); // the user wandered off meanwhile
    dock.restoreTerminalTab(a, "term-win", "bottom");
    expect(dock.terminalTabIds()).toEqual([]); // not into the scope on screen
    dock.setDockScope(a);
    expect(dock.terminalTabIds()).toEqual(["term-win"]);
    expect(dock.isDockVisible("bottom")).toBe(true);
    expect(dock.dockActiveKey("bottom")).toBe("terminal:term-win");
  });

  it("does nothing when some conversation already holds the shell again", () => {
    const a = `scope-detach-c-${scopeSeq}`;
    dock.setDockScope(a);
    dock.addTerminalTab("term-back", "bottom"); // the user re-tabbed it before the window closed
    dock.restoreTerminalTab(`scope-detach-d-${scopeSeq}`, "term-back", "right");
    dock.setDockScope(`scope-detach-d-${scopeSeq}`);
    expect(dock.terminalTabIds()).toEqual([]);
  });
});

describe("view models", () => {
  it("renders one view per open dock", () => {
    dock.openPanel("workspace", "right");
    dock.addTerminalTab("term-a", "bottom");
    const views = dock.dockViews();
    expect(views.map((v) => v.position)).toEqual(["right", "bottom"]);
    expect(views[0]?.merged).toBe(false);
    expect(views[0]?.activeKey).toBe("workspace");
    expect(views[1]?.activeKey).toBe("terminal:term-a");
  });
});
