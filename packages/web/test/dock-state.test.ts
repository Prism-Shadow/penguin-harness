/**
 * The dock store (features/dock/dock-state.ts): two docks (right/bottom) of uniform tabs
 * — singleton panels plus per-shell terminal tabs — with a GLOBAL arrangement that
 * survives Session switches and reloads. Hiding a dock keeps its tabs; closing a tab
 * removes it; a panel opened again returns to its remembered home.
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

/** Back to an empty arrangement without reloading the module. */
beforeEach(() => {
  for (const position of ["right", "bottom"] as const) {
    dock.setDockOpen(position, true);
    for (const tab of [...dock.dockTabs(position)]) dock.removeTab(dock.tabKey(tab));
  }
});

describe("panel tabs", () => {
  it("opens a panel as a tab in its default dock and shows it", () => {
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

  it("remembers a panel's home dock and reopens it there", () => {
    dock.openPanel("agents", "bottom");
    dock.closePanel("agents");
    expect(dock.panelDock("agents")).toBeNull();
    dock.openPanel("agents");
    expect(dock.panelDock("agents")).toBe("bottom");
  });

  it("toggles: shown → closed; behind another tab → brought to front", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    // workspace exists but memory is the shown tab: the toggle activates, never closes.
    dock.togglePanel("workspace");
    expect(dock.panelDock("workspace")).toBe("right");
    expect(dock.dockActiveKey("right")).toBe("workspace");
    // Now shown: the toggle closes the tab.
    dock.togglePanel("workspace");
    expect(dock.panelDock("workspace")).toBeNull();
    expect(dock.dockActiveKey("right")).toBe("memory");
  });
});

describe("terminal tabs", () => {
  it("adds one tab per shell, defaulting to the bottom dock", () => {
    // First terminal ever: nothing remembered yet, so the built-in bottom default applies.
    // (Later tests pass positions explicitly — the remembered terminal home is a
    // preference and deliberately survives the per-test cleanup.)
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

  it("prunes dead shells' tabs and falls back to the last remaining tab", () => {
    dock.addTerminalTab("term-a", "bottom");
    dock.addTerminalTab("term-b", "bottom");
    dock.pruneTerminalTabs(new Set(["term-a"]));
    expect(dock.terminalTabIds()).toEqual(["term-a"]);
    expect(dock.dockActiveKey("bottom")).toBe("terminal:term-a");
    dock.pruneTerminalTabs(new Set());
    expect(dock.isDockVisible("bottom")).toBe(false);
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

describe("hiding and closing", () => {
  it("hides a dock keeping its tabs, and reopening a panel restores the whole strip", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    dock.hideView({ position: "right", merged: false, tabs: [], activeKey: null });
    expect(dock.isDockVisible("right")).toBe(false);
    expect(dock.dockTabs("right")).toHaveLength(2);
    // Toggling a hidden panel brings the dock back with both tabs still there.
    dock.togglePanel("memory");
    expect(dock.isDockVisible("right")).toBe(true);
    expect(dock.dockTabs("right")).toHaveLength(2);
    expect(dock.dockActiveKey("right")).toBe("memory");
  });

  it("removing the active tab falls back to the last remaining one", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    dock.openPanel("trace", "right");
    dock.removeTab("trace");
    expect(dock.dockActiveKey("right")).toBe("memory");
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

  it("moves a whole dock, merging after the target's own tabs and keeping the shown tab", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "bottom");
    dock.moveDock("right", "bottom");
    expect(dock.dockTabs("right")).toHaveLength(0);
    expect(dock.dockTabs("bottom").map(dock.tabKey)).toEqual(["memory", "workspace"]);
    expect(dock.dockActiveKey("bottom")).toBe("workspace");
    // The moved panels' home follows, so reopening lands on the new edge.
    dock.closePanel("workspace");
    dock.openPanel("workspace");
    expect(dock.panelDock("workspace")).toBe("bottom");
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
  it("round-trips the whole arrangement — tabs, active, open flags, sizes — across a reload", async () => {
    dock.openPanel("workspace", "right");
    dock.addTerminalTab("term-a", "bottom");
    dock.openPanel("memory", "bottom");
    dock.setDockOpen("right", false);
    dock.setBottomRatio(0.5);

    // Reload: a second module instance reading the same storage back from scratch.
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    expect(reloaded.panelDock("workspace")).toBe("right");
    expect(reloaded.isDockVisible("right")).toBe(false); // hidden stays hidden
    expect(reloaded.dockTabs("bottom").map(reloaded.tabKey)).toEqual(["terminal:term-a", "memory"]);
    expect(reloaded.dockActiveKey("bottom")).toBe("memory");
    expect(reloaded.isDockVisible("bottom")).toBe(true);
    expect(reloaded.bottomRatio()).toBe(0.5);
  });

  it("degrades a malformed stored entry to an empty dock", async () => {
    store.set("penguin.dock.layout", '{"right": {"tabs": ["nonsense", 42]}, "bottomRatio": "x"}');
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    expect(reloaded.dockTabs("right")).toHaveLength(0);
    expect(reloaded.isDockVisible("right")).toBe(false);
    expect(reloaded.bottomRatio()).toBeCloseTo(0.4);
  });
});

describe("view models", () => {
  it("renders one view per visible dock", () => {
    dock.openPanel("workspace", "right");
    dock.addTerminalTab("term-a", "bottom");
    const views = dock.dockViews();
    expect(views.map((v) => v.position)).toEqual(["right", "bottom"]);
    expect(views[0]?.merged).toBe(false);
    expect(views[0]?.activeKey).toBe("workspace");
    expect(views[1]?.activeKey).toBe("terminal:term-a");
  });
});
