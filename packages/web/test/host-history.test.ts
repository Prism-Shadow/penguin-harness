/** @vitest-environment jsdom */
/**
 * Leaving a view that hosts an embedded app (src/lib/host-history.ts). The browser's Navigation
 * API is the boundary, faked with the host's own entries only, as the browser lists them: the
 * pages an app's iframe went through are never among them.
 *
 * - Given the host entry before the current one is the destination, returning traverses to it,
 *   however many pages the iframe added, and pushes nothing.
 * - Given that entry is somewhere else, returning replaces the current entry with the destination.
 * - Given the current entry was pushed on top of the previous one (`stepBack`), returning
 *   traverses to it wherever it is, the page a window was brought back from included.
 * - Given a traversal the browser refuses while the address has not moved, the reader still
 *   lands on the destination.
 * - Given a browser without the Navigation API, returning replaces the current entry, and a full
 *   page opened from a window takes the window's entry instead of pushing a new one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigateFunction } from "react-router";
import { openFullPage, returnToHostEntry } from "../src/lib/host-history";

/** Installs the host's entries, the last one current, and records every traversal. */
function hostEntries(paths: string[], { refuse = false } = {}): string[] {
  const entries = paths.map((path, i) => ({
    url: new URL(path, window.location.origin).href,
    key: `entry-${i}`,
    sameDocument: true,
  }));
  const traversed: string[] = [];
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: {
      currentEntry: { index: entries.length - 1 },
      entries: () => entries,
      traverseTo: (key: string) => {
        traversed.push(key);
        return { finished: refuse ? Promise.reject(new Error("aborted")) : Promise.resolve() };
      },
    },
  });
  return traversed;
}

let navigate: ReturnType<typeof vi.fn>;
const asNavigate = () => navigate as unknown as NavigateFunction;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  navigate = vi.fn();
  window.history.replaceState(null, "", "/apps?folder=study&app=default_agent%2Fnotes");
});
afterEach(() => {
  delete (window as { navigation?: unknown }).navigation;
});

describe("returning from a view that hosts an app", () => {
  it("traverses to the host entry before it when that entry is the destination", async () => {
    const traversed = hostEntries([
      "/chat",
      "/apps?folder=study",
      "/apps?folder=study&app=default_agent%2Fnotes",
    ]);
    returnToHostEntry(asNavigate(), "/apps?folder=study");
    await settle();
    expect(traversed).toEqual(["entry-1"]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("replaces the current entry when the entry before it is somewhere else", async () => {
    const traversed = hostEntries(["/chat", "/apps?folder=study&app=default_agent%2Fnotes"]);
    returnToHostEntry(asNavigate(), "/apps?folder=study");
    await settle();
    expect(traversed).toEqual([]);
    expect(navigate).toHaveBeenCalledWith("/apps?folder=study", { replace: true });
  });

  it("steps back to the entry the current one was pushed on, wherever it is", async () => {
    const traversed = hostEntries(["/chat/s1", "/apps?folder=study&app=default_agent%2Fnotes"]);
    returnToHostEntry(asNavigate(), "/apps?folder=study", { stepBack: true });
    await settle();
    expect(traversed).toEqual(["entry-0"]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("lands on the destination when the browser refuses the traversal", async () => {
    hostEntries(["/apps?folder=study", "/apps?folder=study&app=default_agent%2Fnotes"], {
      refuse: true,
    });
    returnToHostEntry(asNavigate(), "/apps?folder=study");
    await settle();
    expect(navigate).toHaveBeenCalledWith("/apps?folder=study", { replace: true });
  });

  it("pushes a full page from a window when the browser can traverse host entries", () => {
    hostEntries(["/apps", "/apps?app=default_agent%2Fnotes"]);
    openFullPage(asNavigate(), "/app/p/a/notes", "/apps?app=default_agent%2Fnotes", {
      fromWindow: true,
    });
    expect(navigate).toHaveBeenCalledWith("/app/p/a/notes", {
      state: { returnTo: "/apps?app=default_agent%2Fnotes" },
      replace: false,
    });
  });
});

describe("a browser without the Navigation API", () => {
  it("replaces the current entry, even when asked to step back", () => {
    returnToHostEntry(asNavigate(), "/apps?folder=study", { stepBack: true });
    expect(navigate).toHaveBeenCalledWith("/apps?folder=study", { replace: true });
  });

  it("opens a full page from a window in the window's entry, and from the grid as a new one", () => {
    openFullPage(asNavigate(), "/app/p/a/notes", "/apps?app=default_agent%2Fnotes", {
      fromWindow: true,
    });
    openFullPage(asNavigate(), "/app/p/a/notes", "/apps", { fromWindow: false });
    expect(navigate.mock.calls).toEqual([
      ["/app/p/a/notes", { state: { returnTo: "/apps?app=default_agent%2Fnotes" }, replace: true }],
      ["/app/p/a/notes", { state: { returnTo: "/apps" }, replace: false }],
    ]);
  });
});
