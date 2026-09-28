/**
 * The Workspace finder (src/features/chat/workspace-finder*.tsx): the modal every Workspace
 * picker opens. Its decisions live in workspace-finder-model.ts and are exercised directly —
 * breadcrumbs for both path families, back/forward history, type-to-select, the keyboard map,
 * Favourites per platform and Recent. The suite has no DOM, so the few JSX facts that fail
 * silently are pinned against the source: the finder is a Modal (no second overlay system),
 * and a permission refusal renders its own copy instead of an empty folder.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DirEntryInfo, DirListResponse } from "@prismshadow/penguin-server/api";
import {
  EMPTY_HISTORY,
  canGoBack,
  canGoForward,
  favouritePlaces,
  finderKeyAction,
  historyStep,
  historyVisit,
  parentOf,
  recentWorkspaces,
  resolveGoTo,
  splitBreadcrumbs,
  stepSelection,
  typeSelectIndex,
  visibleEntries,
} from "../src/features/chat/workspace-finder-model";

const dir = (name: string, kind: "dir" | "file" = "dir"): DirEntryInfo => ({
  name,
  path: `/p/${name}`,
  kind,
});

describe("breadcrumbs", () => {
  it("splits a posix path from the root", () => {
    expect(splitBreadcrumbs("/Users/me/Downloads")).toEqual([
      { label: "/", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "me", path: "/Users/me" },
      { label: "Downloads", path: "/Users/me/Downloads" },
    ]);
    expect(splitBreadcrumbs("/")).toEqual([{ label: "/", path: "/" }]);
  });

  it("keeps a drive root whole, so no crumb is drive-relative", () => {
    expect(splitBreadcrumbs("C:\\Users\\me").map((c) => c.path)).toEqual([
      "C:\\",
      "C:\\Users",
      "C:\\Users\\me",
    ]);
    expect(splitBreadcrumbs("C:\\")[0]).toEqual({ label: "C:", path: "C:\\" });
    expect(parentOf("C:\\Users")).toBe("C:\\");
    expect(parentOf("/")).toBeNull();
  });
});

describe("history", () => {
  it("goes back and forward, and a new visit drops what was ahead", () => {
    let h = historyVisit(historyVisit(historyVisit(EMPTY_HISTORY, "/a"), "/a/b"), "/a/b/c");
    h = historyStep(h, -1);
    expect(h.entries[h.index]).toBe("/a/b");
    expect([canGoBack(h), canGoForward(h)]).toEqual([true, true]);
    h = historyVisit(h, "/x");
    expect(h.entries).toEqual(["/a", "/a/b", "/x"]);
    expect(canGoForward(h)).toBe(false);
  });

  it("does not record a reload of the folder already shown", () => {
    const h = historyVisit(EMPTY_HISTORY, "/a");
    expect(historyVisit(h, "/a")).toBe(h);
    expect(historyStep(h, -1)).toBe(h);
  });
});

describe("the list", () => {
  const entries = visibleEntries(
    [dir("zeta"), dir("notes.txt", "file"), dir(".git"), dir("Alpha"), dir("beta")],
    "",
  );

  it("drops hidden entries and puts folders first", () => {
    expect(entries.map((e) => e.name)).toEqual(["Alpha", "beta", "zeta", "notes.txt"]);
    expect(visibleEntries(entries, "ET").map((e) => e.name)).toEqual(["beta", "zeta"]);
  });

  it("type-to-select finds a folder by prefix, never a file", () => {
    expect(typeSelectIndex(entries, "b")).toBe(1);
    expect(typeSelectIndex(entries, "ZE")).toBe(2);
    expect(typeSelectIndex(entries, "no")).toBe(-1);
  });

  it("arrow keys skip files and stop at the ends", () => {
    expect(stepSelection(entries, -1, 1)).toBe(0);
    expect(stepSelection(entries, 2, 1)).toBe(2);
    expect(stepSelection(entries, -1, -1)).toBe(2);
  });
});

describe("keyboard map", () => {
  type Mods = Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>>;
  const key = (k: string, mods: Mods = {}) => ({
    key: k,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  });

  it("reads the Finder chords with ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(finderKeyAction(key("ArrowUp", { meta: true }), true, true)).toBe("parent");
    expect(finderKeyAction(key("ArrowUp", { ctrl: true }), false, true)).toBe("parent");
    expect(finderKeyAction(key("ArrowUp", { ctrl: true }), true, true)).toBeNull();
    expect(finderKeyAction(key("[", { meta: true }), true, true)).toBe("back");
    expect(finderKeyAction(key("]", { ctrl: true }), false, true)).toBe("forward");
    expect(finderKeyAction(key("G", { meta: true, shift: true }), true, false)).toBe("goto");
    expect(finderKeyAction(key("ArrowDown", { meta: true }), true, true)).toBe("open");
  });

  it("leaves Enter and Home/End to a text field, but lets Up/Down steer the list", () => {
    expect(finderKeyAction(key("Enter"), false, true)).toBe("open");
    expect(finderKeyAction(key("Enter"), false, false)).toBeNull();
    expect(finderKeyAction(key("Home"), false, false)).toBeNull();
    expect(finderKeyAction(key("ArrowDown"), false, false)).toBe("down");
  });
});

describe("favourites", () => {
  const home = (over: Partial<DirListResponse>): DirListResponse => ({
    path: "/Users/me",
    parent: "/Users",
    entries: [],
    ...over,
  });

  it("offers home and the standard folders that exist there", () => {
    const places = favouritePlaces(
      home({
        platform: "darwin",
        entries: [
          { name: "Downloads", path: "/Users/me/Downloads", kind: "dir" },
          { name: "Desktop", path: "/Users/me/Desktop", kind: "dir" },
          { name: "Documents", path: "/Users/me/Documents", kind: "file" },
        ],
      }),
    );
    expect(places.map((p) => [p.key, p.path])).toEqual([
      ["home", "/Users/me"],
      ["desktop", "/Users/me/Desktop"],
      ["downloads", "/Users/me/Downloads"],
    ]);
  });

  it("matches Windows folder names ignoring case and adds the drive roots", () => {
    const places = favouritePlaces({
      path: "C:\\Users\\me",
      parent: "C:\\Users",
      platform: "win32",
      roots: ["C:\\", "D:\\"],
      entries: [{ name: "documents", path: "C:\\Users\\me\\documents", kind: "dir" }],
    });
    expect(places.map((p) => [p.key, p.label])).toEqual([
      ["home", "me"],
      ["documents", "documents"],
      ["drive", "C:"],
      ["drive", "D:"],
    ]);
  });
});

describe("recent and go to folder", () => {
  it("folds the newest Session per Workspace across Agents, temporary ones left out", () => {
    const latest = new Map<string, Record<string, string>>([
      ["a1", { "/srv/app": "2026-09-01T00:00:00.000Z", "/srv/old": "2026-08-01T00:00:00.000Z" }],
      [
        "a2",
        {
          "/srv/app": "2026-09-03T00:00:00.000Z",
          "far\0/srv/app": "2026-09-02T00:00:00.000Z",
          "\0temp-workspaces": "2026-09-09T00:00:00.000Z",
        },
      ],
    ]);
    expect(recentWorkspaces(latest, () => true)).toEqual([
      { path: "/srv/app", machineId: null, at: "2026-09-03T00:00:00.000Z" },
      { path: "/srv/app", machineId: "far", at: "2026-09-02T00:00:00.000Z" },
      { path: "/srv/old", machineId: null, at: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(recentWorkspaces(latest, (m) => m === null).map((r) => r.machineId)).toEqual([
      null,
      null,
    ]);
  });

  it("resolves ~ against the machine's home", () => {
    expect(resolveGoTo("~/work", "/home/me")).toBe("/home/me/work");
    expect(resolveGoTo("~", "C:\\Users\\me")).toBe("C:\\Users\\me");
    expect(resolveGoTo(" /srv ", null)).toBe("/srv");
  });
});

describe("the modal (source contract)", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8");
  const finder = read("features/chat/workspace-finder.tsx");
  const select = read("features/chat/workspace-select.tsx");

  it("is the shared Modal, so it stacks on a host dialog through the one Escape stack", () => {
    expect(finder).toContain("<Modal");
    expect(finder).not.toContain("createPortal");
    expect(finder).not.toMatch(/fixed inset-0/);
    expect(select).not.toContain("Dropdown");
  });

  it("says a refused folder is refused, and names the macOS setting only on darwin", () => {
    expect(finder).toContain('code === "dir_permission_denied"');
    expect(finder).toMatch(/platform === "darwin"\s*\?\s*f\.deniedMac/);
  });
});
