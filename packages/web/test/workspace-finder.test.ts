/**
 * The Workspace finder (src/features/chat/workspace-finder*.tsx): the modal every Workspace
 * picker opens. Its decisions live in workspace-finder-model.ts and are exercised directly —
 * breadcrumbs for both path families, back/forward history, type-to-select, the keyboard map,
 * Quick access per platform with the user's own edits, the context menu's rows, Recent, what
 * the box for a refused folder offers, and the footer's no-folder button. The suite has no DOM,
 * so the few JSX facts that fail silently are pinned against the source: the finder is a Modal
 * (no second overlay system), a permission refusal renders its own box instead of an empty
 * folder, the address bar is the one place a path is typed, a folder row carries its own way
 * in, and no folder is a footer button rather than a sentence.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DirEntryInfo, DirListResponse } from "@prismshadow/penguin-server/api";
import {
  EMPTY_HISTORY,
  NO_EDITS,
  addToQuickAccess,
  canGoBack,
  canGoForward,
  clearButton,
  defaultPlaces,
  deniedBox,
  drivePlaces,
  finderKeyAction,
  finderMenuItems,
  historyStep,
  historyVisit,
  loadQuickAccess,
  parentOf,
  pathTail,
  quickAccessKey,
  quickAccessPlaces,
  recentWorkspaces,
  removeFromQuickAccess,
  resolveGoTo,
  saveQuickAccess,
  splitBreadcrumbs,
  stepSelection,
  tempWorkspacePath,
  typeSelectIndex,
  visibleEntries,
} from "../src/features/chat/workspace-finder-model";
import type {
  AccessAsk,
  DeniedBox,
  QuickAccessStorage,
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

describe("quick access", () => {
  const folders = (base: string, names: string[], sep = "/"): DirEntryInfo[] =>
    names.map((name) => ({ name, path: `${base}${sep}${name}`, kind: "dir" }));
  const home = (over: Partial<DirListResponse>): DirListResponse => ({
    path: "/home/me",
    parent: "/home",
    entries: [],
    ...over,
  });
  const std = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"];

  it("offers each platform's own standard folders, in its file manager's order", () => {
    const keys = (h: DirListResponse) => defaultPlaces(h).map((p) => p.key);
    // Explorer: Desktop, Downloads, Documents, Pictures.
    expect(
      keys(
        home({
          path: "C:\\Users\\me",
          platform: "win32",
          entries: folders("C:\\Users\\me", std, "\\"),
        }),
      ),
    ).toEqual(["home", "desktop", "downloads", "documents", "pictures"]);
    // Finder: Desktop, Documents, Downloads — no Pictures.
    expect(
      keys(home({ path: "/Users/me", platform: "darwin", entries: folders("/Users/me", std) })),
    ).toEqual(["home", "desktop", "documents", "downloads"]);
    // A Linux desktop's XDG folders; a machine over ssh reports no platform and reads the same.
    expect(keys(home({ platform: "linux", entries: folders("/home/me", std) }))).toEqual([
      "home",
      "desktop",
      "documents",
      "downloads",
      "pictures",
    ]);
    expect(keys(home({ entries: folders("/home/me", std) }))).toEqual([
      "home",
      "desktop",
      "documents",
      "downloads",
      "pictures",
    ]);
  });

  it("lists only folders that exist there, and matches Windows names ignoring case", () => {
    const linux = defaultPlaces(
      home({
        platform: "linux",
        entries: [
          { name: "Downloads", path: "/home/me/Downloads", kind: "dir" },
          { name: "Documents", path: "/home/me/Documents", kind: "file" },
        ],
      }),
    );
    expect(linux.map((p) => [p.key, p.path])).toEqual([
      ["home", "/home/me"],
      ["downloads", "/home/me/Downloads"],
    ]);
    const win = defaultPlaces({
      path: "C:\\Users\\me",
      parent: "C:\\Users",
      platform: "win32",
      roots: ["C:\\", "D:\\"],
      entries: [{ name: "documents", path: "C:\\Users\\me\\documents", kind: "dir" }],
    });
    expect(win.map((p) => [p.key, p.label])).toEqual([
      ["home", "me"],
      ["documents", "documents"],
    ]);
  });

  it("keeps Windows' drives for This PC, apart from Quick access", () => {
    const listing = home({ platform: "win32", roots: ["C:\\", "D:\\"] });
    expect(drivePlaces(listing).map((p) => [p.key, p.label, p.path])).toEqual([
      ["drive", "C:", "C:\\"],
      ["drive", "D:", "D:\\"],
    ]);
    expect(defaultPlaces(listing).some((p) => p.key === "drive")).toBe(false);
    expect(drivePlaces(home({ platform: "linux" }))).toEqual([]);
  });

  it("adds any folder at the end, and removes any entry — a default included", () => {
    const defaults = defaultPlaces(home({ platform: "linux", entries: folders("/home/me", std) }));
    const paths = (e: typeof NO_EDITS) => quickAccessPlaces(defaults, e).map((p) => p.path);
    let edits = addToQuickAccess(NO_EDITS, defaults, "/srv/work");
    expect(paths(edits).at(-1)).toBe("/srv/work");
    expect(quickAccessPlaces(defaults, edits).at(-1)).toMatchObject({
      key: "folder",
      label: "work",
    });
    // Adding what is already there changes nothing.
    expect(addToQuickAccess(edits, defaults, "/srv/work")).toBe(edits);
    expect(addToQuickAccess(edits, defaults, "/home/me/Desktop")).toBe(edits);
    // A removed default is remembered as removed, and adding it back restores it in place.
    edits = removeFromQuickAccess(edits, defaults, "/home/me/Desktop");
    expect(paths(edits)).not.toContain("/home/me/Desktop");
    edits = addToQuickAccess(edits, defaults, "/home/me/Desktop");
    expect(paths(edits).indexOf("/home/me/Desktop")).toBe(1);
    // An added folder is simply forgotten.
    edits = removeFromQuickAccess(edits, defaults, "/srv/work");
    expect(edits).toEqual(NO_EDITS);
  });

  it("stores the edits per machine, and reads anything unreadable as none", () => {
    const store = new Map<string, string>();
    const storage: QuickAccessStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    };
    const edits = { added: ["/srv/work"], removed: ["/home/me/Desktop"] };
    saveQuickAccess(null, edits, storage);
    saveQuickAccess("m-1", NO_EDITS, storage);
    expect(loadQuickAccess(null, storage)).toEqual(edits);
    expect(loadQuickAccess("m-1", storage)).toEqual(NO_EDITS);
    expect(quickAccessKey(null)).toBe("penguin.finderQuickAccess.local");
    expect(quickAccessKey("m-1")).toBe("penguin.finderQuickAccess.m-1");
    store.set(quickAccessKey("m-2"), "{not json");
    expect(loadQuickAccess("m-2", storage)).toEqual(NO_EDITS);
    store.set(quickAccessKey("m-3"), JSON.stringify({ added: ["/a", 3, ""], removed: "x" }));
    expect(loadQuickAccess("m-3", storage)).toEqual({ added: ["/a"], removed: [] });
  });
});

describe("the context menu", () => {
  it("offers a folder open, choose, Quick access and copy; a file only copy", () => {
    const folder = { kind: "folder" as const, path: "/p/a", machine: null };
    expect(finderMenuItems(folder, false)).toEqual([
      "open",
      "choose",
      "addToQuickAccess",
      "copyPath",
    ]);
    expect(finderMenuItems(folder, true)).toContain("removeFromQuickAccess");
    expect(finderMenuItems({ ...folder, kind: "file" }, false)).toEqual(["copyPath"]);
  });

  it("acts on the open folder from the list's empty space, with Refresh", () => {
    expect(finderMenuItems({ kind: "here", path: "/p", machine: null }, false)).toEqual([
      "choose",
      "addToQuickAccess",
      "copyPath",
      "refresh",
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

describe("a folder the server may not read", () => {
  const idle: AccessAsk = { phase: "idle" };
  const asking: AccessAsk = { phase: "asking" };
  const refusedApp: AccessAsk = { phase: "asked", packaged: true };
  const refusedDev: AccessAsk = { phase: "asked", packaged: false };
  const plain: DeniedBox = { text: "denied", allow: "none", settings: null, retry: true };
  const server: DeniedBox = { text: "deniedMacServer", allow: "none", settings: null, retry: true };

  it("offers the desktop app's own request only on a Mac, in the shell, browsing its own server", () => {
    const table: Array<[string, string | undefined, boolean, string | null, AccessAsk, DeniedBox]> =
      [
        // Off macOS nothing asks for a folder: the account simply lacks the permission.
        ["a Linux server, in the shell", "linux", true, null, idle, plain],
        ["a Windows server, after an ask", "win32", true, null, refusedApp, plain],
        ["no listing yet to name the platform", undefined, true, null, idle, plain],
        // A browser tab has no shell to ask; a machine's listing comes from another computer.
        ["a browser tab", "darwin", false, null, idle, server],
        ["a browser tab, whatever is on record", "darwin", false, null, refusedApp, server],
        ["a Mac machine, from the shell", "darwin", true, "m1", idle, server],
        [
          "the shell, before asking: Allow access and nothing else",
          "darwin",
          true,
          null,
          idle,
          { text: "deniedMacAsk", allow: "ready", settings: null, retry: false },
        ],
        [
          "the shell, while macOS waits for the user",
          "darwin",
          true,
          null,
          asking,
          { text: "deniedMacAsk", allow: "waiting", settings: null, retry: false },
        ],
        [
          "the shell, still refused, packaged: Full Disk Access",
          "darwin",
          true,
          null,
          refusedApp,
          { text: "deniedMacRefused", allow: "none", settings: "fullDisk", retry: true },
        ],
        [
          "the shell, still refused, a development instance: its terminal",
          "darwin",
          true,
          null,
          refusedDev,
          { text: "deniedMacRefusedDev", allow: "none", settings: "files", retry: true },
        ],
      ];
    for (const [label, platform, desktopShell, machine, ask, expected] of table) {
      expect(deniedBox({ platform, desktopShell, machine, ask }), label).toEqual(expected);
    }
  });

  it("never offers Retry alone where there is something better to do", () => {
    for (const ask of [idle, asking, refusedApp, refusedDev]) {
      const box = deniedBox({ platform: "darwin", desktopShell: true, machine: null, ask });
      expect(box.allow !== "none" || box.settings !== null, ask.phase).toBe(true);
    }
  });
});

describe("the footer's no-folder button", () => {
  const stateDir = "/home/me/.penguin/data/default_project/agents/writer/agent_state";
  const base = { offered: true, workspace: "", stateDir: null, machine: null };

  it("is there whenever the host offers no folder, pressed only while nothing is chosen", () => {
    expect(clearButton({ ...base, offered: false })).toBeNull();
    expect(clearButton(base)?.pressed).toBe(true);
    expect(clearButton({ ...base, workspace: "  " })?.pressed).toBe(true);
    expect(clearButton({ ...base, workspace: "/srv/app" })?.pressed).toBe(false);
  });

  it("names the folder a temporary Workspace would get, cut to its tail on the button", () => {
    expect(clearButton({ ...base, workspace: "/srv/app", stateDir })).toEqual({
      pressed: false,
      path: "…/agents/writer/workspaces/tmp-…",
      fullPath: "/home/me/.penguin/data/default_project/agents/writer/workspaces/tmp-…",
    });
  });

  it("names none without the Agent's directory, or while another machine is browsed", () => {
    expect(clearButton(base)).toEqual({ pressed: true, path: null, fullPath: null });
    expect(clearButton({ ...base, stateDir, machine: "far" })).toEqual({
      pressed: true,
      path: null,
      fullPath: null,
    });
  });

  it("keeps a Windows path's separator, and names nothing for an unknown layout", () => {
    expect(tempWorkspacePath("C:\\Users\\me\\.penguin\\data\\p\\agents\\a\\agent_state")).toBe(
      "C:\\Users\\me\\.penguin\\data\\p\\agents\\a\\workspaces\\tmp-…",
    );
    expect(tempWorkspacePath("/srv/agents/a/state")).toBeNull();
    expect(tempWorkspacePath("/")).toBeNull();
  });

  it("cuts a path to its last segments, and leaves a short one whole", () => {
    expect(pathTail("/a/b/c/d/e", 2)).toBe("…/d/e");
    expect(pathTail("C:\\a\\b\\c", 2)).toBe("…\\b\\c");
    expect(pathTail("/a/b", 2)).toBe("/a/b");
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

  it("says a refused folder is refused, in the box deniedBox decides", () => {
    expect(finder).toContain('code === "dir_permission_denied"');
    expect(finder).toContain("f[denied.text]");
    // The one renderer marker (lib/desktop-renderer.ts), not a check of the finder's own.
    expect(finder).toContain("isElectronRenderer(navigator.userAgent)");
    expect(finder).toMatch(/api\s*\.requestDirAccess\(projectId, target\)/);
    // A server with no shell behind it gets the browser tab's explanation, not an error loop.
    expect(finder).toContain('err.code === "shell_unreachable"');
  });

  it("types a path in the address bar itself — no separate Go to row or button", () => {
    expect(finder).toContain("onClick={editAddress}");
    expect(finder).not.toMatch(/goToSubmit|gotoRow/);
  });

  it("gives a folder row an enter button, and one context menu covers the finder", () => {
    expect(finder).toContain("aria-label={f.openFolder(entry.name)}");
    expect(finder).toContain("useRowContextMenu()");
    expect(finder).toContain("anchorRect={menu.anchor}");
  });

  it("offers no folder as a footer button, with no rule spelled out beside it", () => {
    expect(finder).toContain("aria-pressed={clear.pressed}");
    expect(finder).toMatch(/api\s*\.getAgentConfig\(projectId, agentId\)/);
    expect(finder).not.toMatch(/hint/i);
    // The sidebar's new-workspace button adds a folder: it has no empty value to go back to.
    expect(select).toMatch(/onClear=\{\s*clearable/);
  });
});
