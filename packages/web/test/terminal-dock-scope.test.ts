/**
 * The terminal dock is scoped to the conversation it was opened in
 * (terminal-dock-state.ts): switching Sessions switches the arrangement, switching back
 * restores it, and one conversation's shells never show up in another's tab strip.
 *
 * The module reads localStorage at import time, so the stub is installed first and the
 * module imported dynamically.
 */
import { beforeAll, describe, expect, it } from "vitest";

let dock: typeof import("../src/features/terminal/terminal-dock-state");

beforeAll(async () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  dock = await import("../src/features/terminal/terminal-dock-state");
});

describe("dock scopes", () => {
  it("switches the whole arrangement with the Session, and restores it on return", () => {
    dock.setDockScope("session-a");
    dock.assignTerminalToPane("term-a", "bottom");
    expect(dock.isTerminalDockOpen()).toBe(true);
    expect(dock.paneCurrent("bottom")).toBe("term-a");

    // A conversation that never opened a terminal shows none — the dock is simply gone.
    dock.setDockScope("session-b");
    expect(dock.isTerminalDockOpen()).toBe(false);
    expect(dock.openPanes()).toEqual([]);

    dock.setDockScope("session-a");
    expect(dock.isTerminalDockOpen()).toBe(true);
    expect(dock.openPanes()).toEqual(["bottom"]);
    expect(dock.paneCurrent("bottom")).toBe("term-a");
  });

  it("does not lend one Session's terminals to another's panes", () => {
    dock.setDockScope("session-a");
    dock.assignTerminalToPane("term-a", "bottom");
    dock.setDockScope("session-c");
    dock.setTerminalDockOpen(true); // opens a pane of its own

    expect(dock.openPanes()).toEqual(["bottom"]);
    // Membership is explicit: term-a belongs to session-a, so it is not a tab here.
    expect(dock.paneOfTerminal("term-a")).toBeNull();
  });

  it("adopts a terminal picked from the toolbar into the current Session's pane", () => {
    dock.setDockScope("session-a");
    dock.assignTerminalToPane("term-a", "bottom");
    dock.setDockScope("session-d");
    dock.showTerminal("term-a");

    expect(dock.paneOfTerminal("term-a")).toBe("bottom");
    expect(dock.paneCurrent("bottom")).toBe("term-a");
    // …and it stays in the Session it came from too.
    dock.setDockScope("session-a");
    expect(dock.paneOfTerminal("term-a")).toBe("bottom");
  });

  it("keeps pane sizes global — a body preference, not a per-conversation one", () => {
    dock.setDockScope("session-a");
    dock.setPaneRatio("bottom", 0.5);
    dock.setDockScope("session-e");
    expect(dock.paneRatio("bottom")).toBe(0.5);
  });

  it("forgets a Session whose terminals are all gone", () => {
    dock.setDockScope("session-f");
    dock.assignTerminalToPane("term-f", "bottom");
    dock.pruneAssignments(new Set<string>());
    dock.closePane("bottom");

    dock.setDockScope("session-a");
    dock.setDockScope("session-f");
    expect(dock.isTerminalDockOpen()).toBe(false);
    expect(dock.paneOfTerminal("term-f")).toBeNull();
  });

  it("keeps its terminals when the last pane closes, so reopening comes back to them", () => {
    dock.setDockScope("session-g");
    dock.assignTerminalToPane("term-g", "bottom");
    dock.closePane("bottom"); // the header's X: the shell keeps running
    expect(dock.isTerminalDockOpen()).toBe(false);

    dock.setTerminalDockOpen(true);
    expect(dock.paneOfTerminal("term-g")).toBe("bottom");
  });
});

describe("the scope-less dock", () => {
  it("is handed to the first Session chosen, since /chat resolves to one after it loads", () => {
    dock.setDockScope(null);
    dock.assignTerminalToPane("term-staged", "bottom");

    dock.setDockScope("session-resolved");
    expect(dock.isTerminalDockOpen()).toBe(true);
    expect(dock.paneOfTerminal("term-staged")).toBe("bottom");
    // Moved, not copied: going back to no Session shows nothing.
    dock.setDockScope(null);
    expect(dock.isTerminalDockOpen()).toBe(false);
  });

  it("keeps a pane's error across the hand-off, since the pane itself does not change", () => {
    dock.setDockScope(null);
    dock.assignTerminalToPane("term-erring", "bottom");
    dock.setPaneError("bottom", "Could not start a shell");

    dock.setDockScope("session-handed");
    expect(dock.paneError("bottom")).toBe("Could not start a shell");
    // A real switch does clear it: that pane left the screen.
    dock.setDockScope("session-elsewhere");
    expect(dock.paneError("bottom")).toBeNull();
  });

  it("never clobbers a Session that already has an arrangement", () => {
    dock.setDockScope("session-owning");
    dock.assignTerminalToPane("term-owned", "bottom");
    dock.setDockScope(null);
    dock.assignTerminalToPane("term-staged", "top");

    dock.setDockScope("session-owning");
    expect(dock.paneOfTerminal("term-owned")).toBe("bottom");
    expect(dock.paneOfTerminal("term-staged")).toBeNull();
  });
});

describe("the side, shared with the chat panels", () => {
  it("displaces left and right panes while a panel holds it, and gives them back", () => {
    dock.setDockScope("session-side");
    dock.assignTerminalToPane("term-right", "right");
    expect(dock.visiblePanes()).toEqual(["right"]);

    dock.setChatSidePanelOpen(true);
    expect(dock.visiblePanes()).toEqual([]);
    // Displaced, not closed: the arrangement still holds it, which is what lets it return.
    expect(dock.openPanes()).toEqual(["right"]);
    expect(dock.paneOfTerminal("term-right")).toBe("right");

    dock.setChatSidePanelOpen(false);
    expect(dock.visiblePanes()).toEqual(["right"]);
  });

  it("leaves top and bottom alone — they cost height, not width", () => {
    dock.setDockScope("session-bottom");
    dock.assignTerminalToPane("term-bottom", "bottom");
    dock.setChatSidePanelOpen(true);
    expect(dock.visiblePanes()).toEqual(["bottom"]);
  });

  it("hands the side back the moment a terminal is put on screen", () => {
    dock.setDockScope("session-retake");
    dock.assignTerminalToPane("term-left", "left");
    dock.setChatSidePanelOpen(true);
    expect(dock.chatSidePanelOpen()).toBe(true);

    // What the chat page watches: the flag drops, and it retracts its panels in response.
    dock.showTerminal("term-left");
    expect(dock.chatSidePanelOpen()).toBe(false);
    expect(dock.visiblePanes()).toEqual(["left"]);
  });

  it("hands it back for the hotkey too, not just for a pane that already exists", () => {
    dock.setDockScope("session-hotkey");
    dock.setChatSidePanelOpen(true);
    dock.setTerminalDockOpen(true);
    expect(dock.chatSidePanelOpen()).toBe(false);
  });
});

describe("the dock's own idea of being open", () => {
  it("does not count a displaced side pane, so the toggle reclaims instead of closing", () => {
    dock.setDockScope("session-toggle");
    dock.assignTerminalToPane("term-side", "right");
    dock.setChatSidePanelOpen(true);
    expect(dock.isTerminalDockOpen()).toBe(false); // nothing on screen, whatever the arrangement says

    dock.toggleTerminalDock();
    expect(dock.chatSidePanelOpen()).toBe(false);
    expect(dock.isTerminalDockOpen()).toBe(true);
    expect(dock.visiblePanes()).toEqual(["right"]);
    // No stray bottom pane invented along the way: the arrangement already had one.
    expect(dock.openPanes()).toEqual(["right"]);
  });
});
