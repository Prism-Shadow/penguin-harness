/**
 * The dock store (features/dock/dock-state.ts): two docks (right and bottom) of uniform tabs —
 * singleton panels, the terminal panel among them — scoped per conversation, the way browser
 * windows manage their own tabs. The module reads localStorage at import time, so the storage
 * is installed first (for the whole file: a reload reads it back) and the module imported after.
 *
 * - A panel opens as a right-dock tab by default and stays a singleton: opening it in the other
 *   dock moves the tab, and reopening shows it where it lives; the scheduled-tasks panel and the
 *   built-in browser open like any other. Closing a tab removes it, and the last one puts the
 *   dock away.
 * - An open dock with no tabs is visible (the picker); toggling a dock closed keeps its tabs.
 * - A panel with no tab yet lands in the dock asked for, else at its own default edge (the
 *   terminal's is the bottom), and stays one tab; the shell the terminal panel shows is kept per
 *   conversation.
 * - The whole arrangement switches with the Session and comes back on return; a placeholder
 *   scope's arrangement passes to the first Session chosen (a draft's to the Session it becomes,
 *   never clobbering).
 * - A tab moves to the other dock and activates there (the only tab closes its source dock); a
 *   whole dock moves, merging after the target's tabs; a strip reorders only with a complete,
 *   matching key list.
 * - The panel toggle (Ctrl+`) reports a missing tab so the caller opens the panel, hides the
 *   shown panel's dock and restores it, and brings the panel to the front when another tab
 *   covers it.
 * - Each scope's arrangement round-trips across a reload, the terminal's shown shell included
 *   (sizes are one preference); a stored tab key that is no well-formed id is dropped, not the
 *   dock, while a well-formed id nothing has registered (a plugin's panel not loaded yet) is kept;
 *   a malformed entry reads as empty docks.
 * - Given an arrangement stored with a tab per shell (`terminal:<id>`, before the terminal became
 *   one panel), each dock's first one reads back as the terminal panel's tab in its place, the
 *   shell it showed stays shown, and the right dock's copy wins; a draft's arrangement loses them.
 * - Scope switches and moves are instant (no animation); toggles animate.
 * - There is one view per open dock; a hidden dock keeps its view to stay mounted on, an empty
 *   one has none.
 * - At most one surface is fullscreen, and only an open dock with tabs enters it. It lasts while
 *   that dock is open with tabs and no dock it covers comes forward: the right dock's cover is its
 *   own row, so the bottom dock opening or activating leaves it, while the bottom dock's cover
 *   reaches the right dock, so the right dock opening or activating ends it. Hiding the surface or
 *   closing its last tab ends either; switching tabs within it does not.
 * - Given Sessions with different fullscreen docks, switching away and back restores each one's
 *   fullscreen without applying it to a new Session; explicitly exiting stays exited on return.
 * - Given a fullscreen draft, its first send hands fullscreen to the new Session, but never
 *   overwrites an existing Session's fullscreen. A new draft starts at normal size.
 * - Given fullscreen docks, reloading restores their tabs and sizes at normal size.
 * - Given fullscreen docks in several Sessions, crossing the narrow breakpoint clears all of
 *   them; fullscreen chosen in the merged view still survives switching Sessions.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "./helpers/storage";

let dock: typeof import("../src/features/dock/dock-state");

beforeAll(async () => {
  // Not vi.stubGlobal: the package config unstubs globals before every test, and the module
  // (and the reload below) must keep reading this one storage for the whole file.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage(),
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

  it("opens the scheduled-tasks panel like any other", () => {
    dock.openPanel("schedules", "right");
    expect(dock.panelDock("schedules")).toBe("right");
    expect(dock.dockActiveKey("right")).toBe("schedules");
  });

  it("opens the built-in browser like any other", () => {
    dock.openPanel("builtin-browser");
    expect(dock.panelDock("builtin-browser")).toBe("right");
    expect(dock.isTabShown("builtin-browser")).toBe(true);
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

describe("the terminal panel", () => {
  it("lands where it is asked, else at its own default edge, and stays one tab", () => {
    dock.openPanel("terminal", undefined, "bottom");
    expect(dock.panelDock("terminal")).toBe("bottom");
    dock.openPanel("workspace", "bottom");
    dock.openPanel("terminal", undefined, "bottom"); // reopening shows it where it lives
    expect(dock.dockTabs("bottom").map(dock.tabKey)).toEqual(["terminal", "workspace"]);
    expect(dock.dockActiveKey("bottom")).toBe("terminal");
    dock.openPanel("terminal", "right"); // a dock asking for it moves it there
    expect(dock.panelDock("terminal")).toBe("right");
  });

  it("keeps the shell it shows per conversation", () => {
    const a = `scope-shell-a-${scopeSeq}`;
    dock.setDockScope(a);
    dock.openPanel("terminal", undefined, "bottom");
    dock.setShownShell("t2");
    dock.setDockScope(`scope-shell-b-${scopeSeq}`);
    expect(dock.shownShell()).toBeNull();
    dock.setDockScope(a);
    expect(dock.shownShell()).toBe("t2");
  });
});

describe("conversation scopes (each window manages its own tabs)", () => {
  it("switches the whole arrangement with the Session, and restores it on return", () => {
    const a = `scope-a-${scopeSeq}`;
    const b = `scope-b-${scopeSeq}`;
    dock.setDockScope(a);
    dock.openPanel("workspace", "right");
    dock.openPanel("terminal", "bottom");

    // A conversation that never arranged anything shows nothing.
    dock.setDockScope(b);
    expect(dock.isDockVisible("right")).toBe(false);
    expect(dock.isDockVisible("bottom")).toBe(false);
    expect(dock.panelDock("terminal")).toBeNull();

    // B's own arrangement never leaks into A's, and A's comes back intact.
    dock.openPanel("memory", "bottom");
    dock.setDockScope(a);
    expect(dock.panelDock("workspace")).toBe("right");
    expect(dock.panelDock("memory")).toBeNull();
    expect(dock.panelDock("terminal")).toBe("bottom");
  });

  it("hands a placeholder-scope arrangement to the first Session chosen", () => {
    dock.setDockScope(null); // ~none: /chat before it resolves to a conversation
    dock.openPanel("trace", "bottom");
    dock.setDockScope(`scope-resolved-${scopeSeq}`);
    expect(dock.panelDock("trace")).toBe("bottom");
    // Moved, not copied: going back off-conversation shows nothing.
    dock.setDockScope(null);
    expect(dock.panelDock("trace")).toBeNull();
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

describe("the panel toggle (Ctrl+`)", () => {
  it("reports a missing tab so the caller opens the panel, then hides and restores", () => {
    expect(dock.togglePanelShown("terminal")).toBe(false);
    dock.openPanel("terminal", undefined, "bottom");
    expect(dock.togglePanelShown("terminal")).toBe(true); // shown → hidden
    expect(dock.isDockVisible("bottom")).toBe(false);
    expect(dock.togglePanelShown("terminal")).toBe(true); // hidden → shown again
    expect(dock.isDockVisible("bottom")).toBe(true);
    expect(dock.dockActiveKey("bottom")).toBe("terminal");
  });

  it("brings the panel to the front when another tab covers it, instead of hiding", () => {
    dock.openPanel("terminal", "bottom");
    dock.openPanel("workspace", "bottom"); // workspace now shown, the terminal behind it
    expect(dock.togglePanelShown("terminal")).toBe(true);
    expect(dock.dockActiveKey("bottom")).toBe("terminal");
    expect(dock.isDockVisible("bottom")).toBe(true);
  });
});

describe("persistence", () => {
  it("round-trips each scope's arrangement — tabs, active, open flags — across a reload", async () => {
    const a = `scope-persist-a-${scopeSeq}`;
    const b = `scope-persist-b-${scopeSeq}`;
    dock.setDockScope(a);
    dock.openPanel("workspace", "right");
    dock.openPanel("terminal", "bottom");
    dock.setShownShell("t-shown");
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
    expect(reloaded.panelDock("terminal")).toBe("bottom");
    expect(reloaded.shownShell()).toBe("t-shown");
    expect(reloaded.bottomRatio()).toBe(0.5); // sizes are one preference, not per scope
    reloaded.setDockScope(b);
    expect(reloaded.dockActiveKey("bottom")).toBe("memory");
  });

  it("keeps a well-formed stored tab id, a plugin's namespaced one too, and drops the rest", async () => {
    // A stored id nothing has registered (a plugin's panel not loaded yet) stays, to render a
    // placeholder; a key that is no id at all is dropped, never the whole dock.
    const tabs = ["schedules", "acme.kanban", "Bad Key!", "acme/"];
    localStorage.setItem(
      "penguin.dock.layout",
      JSON.stringify({ scopes: { s: { right: { tabs, active: "acme.kanban", open: true } } } }),
    );
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    reloaded.setDockScope("s");
    expect(reloaded.dockTabs("right").map(reloaded.tabKey)).toEqual(["schedules", "acme.kanban"]);
    expect(reloaded.dockActiveKey("right")).toBe("acme.kanban");
    expect(reloaded.isDockVisible("right")).toBe(true);
  });

  it("folds a stored tab per shell into the one terminal panel tab, keeping the shown shell", async () => {
    localStorage.setItem(
      "penguin.dock.layout",
      JSON.stringify({
        scopes: {
          "session-old": {
            right: {
              tabs: ["workspace", "terminal:t1", "terminal:t2"],
              active: "terminal:t2",
              open: true,
            },
            bottom: { tabs: ["terminal:t3", "memory"], active: "memory", open: true },
          },
          // A draft has no Session, so no terminal: its shell tabs simply go.
          "default_project:new": {
            bottom: { tabs: ["terminal:t9", "trace"], active: "terminal:t9", open: true },
          },
        },
      }),
    );
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    reloaded.setDockScope("session-old");
    expect(reloaded.dockTabs("right").map(reloaded.tabKey)).toEqual(["workspace", "terminal"]);
    expect(reloaded.dockActiveKey("right")).toBe("terminal");
    expect(reloaded.shownShell()).toBe("t2");
    // The right dock's copy wins, as with any panel stored in both.
    expect(reloaded.dockTabs("bottom").map(reloaded.tabKey)).toEqual(["memory"]);
    reloaded.setDockScope("default_project:new");
    expect(reloaded.dockTabs("bottom").map(reloaded.tabKey)).toEqual(["trace"]);
    expect(reloaded.dockActiveKey("bottom")).toBe("trace");
    expect(reloaded.shownShell()).toBeNull();
  });

  it("reads a stored built-in browser tab back", async () => {
    const scope = `scope-browser-${scopeSeq}`;
    dock.setDockScope(scope);
    dock.openPanel("builtin-browser", "bottom");
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    reloaded.setDockScope(scope);
    expect(reloaded.panelDock("builtin-browser")).toBe("bottom");
    expect(reloaded.dockActiveKey("bottom")).toBe("builtin-browser");
  });

  it("degrades a malformed stored entry to empty docks", async () => {
    localStorage.setItem(
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

describe("view models", () => {
  it("renders one view per open dock", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("terminal", "bottom");
    const views = dock.dockViews();
    expect(views.map((v) => v.position)).toEqual(["right", "bottom"]);
    expect(views[0]?.merged).toBe(false);
    expect(views[0]?.activeKey).toBe("workspace");
    expect(views[1]?.activeKey).toBe("terminal");
  });

  it("a hidden dock keeps a view to stay mounted on, an empty one has nothing to keep", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    // Open: dockViews() owns it, so there is nothing to keep mounted separately.
    expect(dock.closedDockView("right")).toBeNull();
    dock.toggleDock("right");
    expect(dock.dockViews()).toEqual([]);
    expect(dock.closedDockView("right")).toEqual({
      position: "right",
      merged: false,
      tabs: dock.dockTabs("right"),
      activeKey: "memory",
    });
    // The last tab's × takes the dock away with it: no body left to keep.
    dock.closePanel("workspace");
    dock.closePanel("memory");
    expect(dock.closedDockView("right")).toBeNull();
  });
});

describe("fullscreen", () => {
  it("enters only on an open dock with tabs: closed, hidden or the picker is a no-op", () => {
    dock.setDockFullscreen("right"); // nothing open
    expect(dock.fullscreenDock()).toBeNull();
    dock.toggleDock("right"); // the picker: open, no tabs
    dock.setDockFullscreen("right");
    expect(dock.fullscreenDock()).toBeNull();
    dock.openPanel("workspace", "right");
    dock.toggleDock("right"); // hidden, its tab kept
    dock.setDockFullscreen("right");
    expect(dock.fullscreenDock()).toBeNull();

    dock.toggleDock("right");
    const before = dock.dockVersion();
    dock.setDockFullscreen("right");
    expect(dock.fullscreenDock()).toBe("right");
    expect(dock.dockVersion()).toBeGreaterThan(before); // subscribers re-render
    dock.setDockFullscreen(null);
    expect(dock.fullscreenDock()).toBeNull();
  });

  it("exits when its dock hides, and does not come back when the dock reopens", () => {
    dock.openPanel("workspace", "right");
    dock.setDockFullscreen("right");
    dock.toggleDock("right");
    expect(dock.fullscreenDock()).toBeNull();
    dock.toggleDock("right");
    expect(dock.fullscreenDock()).toBeNull();
  });

  it("outlives closing one of its tabs and exits with the last", () => {
    dock.openPanel("workspace", "bottom");
    dock.openPanel("memory", "bottom");
    dock.setDockFullscreen("bottom");
    dock.closePanel("memory");
    expect(dock.fullscreenDock()).toBe("bottom");
    dock.closePanel("workspace");
    expect(dock.fullscreenDock()).toBeNull();
  });

  it("keeps covering while another tab of the same dock activates or opens there", () => {
    dock.openPanel("workspace", "right");
    dock.openPanel("memory", "right");
    dock.setDockFullscreen("right");
    dock.activateTab("workspace");
    dock.openPanel("trace"); // a new panel lands in the right dock by default
    expect(dock.fullscreenDock()).toBe("right");
  });

  it("right: survives the bottom dock opening, activating and receiving a panel", () => {
    dock.openPanel("memory", "bottom");
    dock.openPanel("builtin-browser", "bottom");
    dock.openPanel("workspace", "right");
    dock.setDockFullscreen("right");
    dock.toggleDock("bottom"); // hidden
    dock.toggleDock("bottom"); // open again, focused — it shows below the covered row
    dock.activateTab("memory");
    // The agent opens the browser, whose tab lives at the bottom: shown there, under nothing.
    dock.openPanel("builtin-browser");
    expect(dock.fullscreenDock()).toBe("right");
  });

  it("bottom: ends when the right dock is toggled open", () => {
    dock.openPanel("workspace", "bottom");
    dock.setDockFullscreen("bottom");
    dock.toggleDock("right");
    expect(dock.fullscreenDock()).toBeNull();
  });

  it("bottom: ends when a tab of the right dock activates or a panel lands there", () => {
    dock.openPanel("memory", "right");
    dock.openPanel("workspace", "bottom");
    dock.setDockFullscreen("bottom");
    dock.activateTab("memory"); // the covered dock takes the stage
    expect(dock.fullscreenDock()).toBeNull();

    dock.setDockFullscreen("bottom");
    dock.openPanel("trace"); // a new panel lands in the right dock by default
    expect(dock.fullscreenDock()).toBeNull();
  });

  it("restores each Session's fullscreen independently and remembers an explicit exit", () => {
    const a = `scope-fullscreen-a-${scopeSeq}`;
    const b = `scope-fullscreen-b-${scopeSeq}`;
    dock.setDockScope(b);
    dock.openPanel("workspace", "right");
    dock.setDockScope(a);
    dock.openPanel("workspace", "right");
    dock.setDockFullscreen("right");
    dock.setDockScope(b); // the same dock is open and touched last here too
    expect(dock.fullscreenDock()).toBeNull();
    dock.openPanel("memory", "bottom");
    dock.setDockFullscreen("bottom");
    dock.setDockScope(a);
    expect(dock.fullscreenDock()).toBe("right");
    dock.setDockFullscreen(null);
    dock.setDockScope(b);
    expect(dock.fullscreenDock()).toBe("bottom");
    dock.setDockScope(a);
    expect(dock.fullscreenDock()).toBeNull();
  });

  it("hands a draft's fullscreen to its new Session without clobbering an existing layout", () => {
    const draft = dock.currentDockScope();
    const born = `fullscreen-born-${scopeSeq}`;
    dock.openPanel("workspace", "right");
    dock.setDockFullscreen("right");
    dock.adoptDockScope(born);
    expect(dock.fullscreenDock()).toBe("right");
    dock.setDockScope(draft);
    expect(dock.fullscreenDock()).toBeNull();

    dock.openPanel("memory", "bottom");
    dock.setDockFullscreen("bottom");
    dock.adoptDockScope(born);
    expect(dock.fullscreenDock()).toBe("right");
  });

  it("reloads the dock's tabs and size without restoring fullscreen", async () => {
    const owner = dock.currentDockScope();
    dock.openPanel("workspace", "right");
    dock.setDockFullscreen("right");
    dock.openPanel("memory", "right"); // a persisted change made while it still covers
    expect(dock.fullscreenDock()).toBe("right");
    dock.setBottomRatio(0.6);
    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    reloaded.setDockScope(owner);
    expect(reloaded.dockTabs("right").map(reloaded.tabKey)).toEqual(["workspace", "memory"]);
    expect(reloaded.bottomRatio()).toBe(0.6);
    expect(reloaded.fullscreenDock()).toBeNull();
  });

  it("clears all Sessions on a breakpoint change and remembers fullscreen in the merged view", async () => {
    let change = (_event: { matches: boolean }) => {};
    vi.stubGlobal("window", {
      matchMedia: () => ({
        matches: false,
        addEventListener: (_type: string, listener: typeof change) => {
          change = listener;
        },
      }),
    });
    vi.resetModules();
    const responsive = await import("../src/features/dock/dock-state");
    const a = `responsive-a-${scopeSeq}`;
    const b = `responsive-b-${scopeSeq}`;
    responsive.setDockScope(a);
    responsive.openPanel("workspace", "right");
    responsive.setDockFullscreen("right");
    responsive.setDockScope(b);
    responsive.openPanel("memory", "bottom");
    responsive.setDockFullscreen("bottom");

    change({ matches: true });
    expect(responsive.fullscreenDock()).toBeNull();
    responsive.setDockScope(a);
    expect(responsive.fullscreenDock()).toBeNull();
    responsive.setDockFullscreen("bottom");
    responsive.setDockScope(b);
    responsive.setDockScope(a);
    expect(responsive.fullscreenDock()).toBe("bottom");
    change({ matches: false });
    expect(responsive.fullscreenDock()).toBeNull();
  });
});
