/**
 * The Workspace finder every Workspace picker opens; its decisions live in
 * features/chat/workspace-finder-model.ts.
 *
 * - Breadcrumbs split a posix path from the root and keep a drive root whole.
 * - History goes back and forward, a new visit drops what was ahead, and reloading the folder
 *   shown records nothing.
 * - The list hides dot-names and what the machine marks hidden, and puts folders first;
 *   type-to-select finds a folder by prefix and arrow keys skip files, stopping at the ends.
 * - The keyboard map reads the Finder chords with ⌘ on a Mac and Ctrl elsewhere, leaving Enter
 *   and Home/End to a text field; Explorer's address keys work off the Mac, and F5 refreshes
 *   everywhere.
 * - Quick access takes the standard folders the machine resolved itself, or else finds each
 *   platform's by name (Windows ignoring case), takes the user's additions and removals (a
 *   default included), and stores them per machine, reading anything unreadable as none.
 * - Locations keep the machine's order and are named the way its file manager names them: a
 *   Windows drive by its label or its type and then its letter, a Linux root as the file
 *   system, anything else by its own name.
 * - The context menu offers open, choose, Quick access and copy on a folder, copy only on a
 *   file, and acts on the open folder (with Refresh) from the list's empty space.
 * - Recent folds the newest Session per Workspace across Agents, leaving temporary ones out;
 *   "go to" resolves ~ against the machine's home, and a bare drive to its root.
 * - A folder the server may not read gets a box of its own: the desktop app's access request
 *   only on a Mac, in the shell, browsing its own server, and never Retry alone where there is
 *   something better to do.
 * - The footer's no-folder button is there whenever the host offers no folder, and its tooltip
 *   names the folder a temporary Workspace would get (a Windows path keeps its separator) —
 *   none without the Agent's directory, while another machine is browsed, or for an unknown
 *   layout.
 */
import { describe, expect, it } from "vitest";
import type { DirEntryInfo, DirListResponse, DirLocation } from "@prismshadow/penguin-server/api";
import {
  EMPTY_HISTORY,
  NO_EDITS,
  addToQuickAccess,
  canGoBack,
  canGoForward,
  clearButton,
  defaultPlaces,
  deniedBox,
  finderKeyAction,
  finderMenuItems,
  historyStep,
  historyVisit,
  loadQuickAccess,
  locationName,
  locationPlaces,
  parentOf,
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
import type { AccessAsk, DeniedBox } from "../src/features/chat/workspace-finder-model";
import { memoryStorage } from "./helpers/storage";

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
    [
      dir("zeta"),
      dir("notes.txt", "file"),
      dir(".git"),
      { ...dir("AppData"), hidden: true },
      dir("Alpha"),
      dir("beta"),
    ],
    "",
  );

  it("drops dot-names and what the machine marks hidden, and puts folders first", () => {
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

  it("takes Explorer's address keys off the Mac, and F5 everywhere", () => {
    for (const k of [key("l", { ctrl: true }), key("D", { alt: true }), key("F4")]) {
      expect(finderKeyAction(k, false, false), k.key).toBe("goto");
      expect(finderKeyAction(k, true, false), k.key).toBeNull();
    }
    expect(finderKeyAction(key("F5"), true, false)).toBe("refresh");
    expect(finderKeyAction(key("F5"), false, true)).toBe("refresh");
    // A modified F5 is the browser's hard reload, and Ctrl+Shift+L is not Ctrl+L.
    expect(finderKeyAction(key("F5", { ctrl: true }), false, true)).toBeNull();
    expect(finderKeyAction(key("L", { ctrl: true, shift: true }), false, true)).toBeNull();
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

  it("takes the folders the machine resolved itself, whole, in its file manager's order", () => {
    // Windows moved Desktop and Documents into OneDrive, leaving stale English-named folders
    // behind; a German Linux desktop names its XDG folders in German.
    const win = defaultPlaces(
      home({
        path: "C:\\Users\\me",
        platform: "win32",
        entries: folders("C:\\Users\\me", std, "\\"),
        standardFolders: {
          documents: "C:\\Users\\me\\OneDrive\\Documents",
          desktop: "C:\\Users\\me\\OneDrive\\Desktop",
        },
      }),
    );
    expect(win.map((p) => [p.key, p.path])).toEqual([
      ["home", "C:\\Users\\me"],
      ["desktop", "C:\\Users\\me\\OneDrive\\Desktop"],
      ["documents", "C:\\Users\\me\\OneDrive\\Documents"],
    ]);
    const linux = defaultPlaces(
      home({
        platform: "linux",
        standardFolders: {
          downloads: "/home/me/Downloads",
          desktop: "/home/me/Schreibtisch",
          // A folder that is home itself is not listed a second time.
          documents: "/home/me",
        },
      }),
    );
    expect(linux.map((p) => [p.key, p.path])).toEqual([
      ["home", "/home/me"],
      ["desktop", "/home/me/Schreibtisch"],
      ["downloads", "/home/me/Downloads"],
    ]);
  });

  it("finds them by name where the machine did not resolve them, Windows' ignoring case", () => {
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
      entries: [{ name: "documents", path: "C:\\Users\\me\\documents", kind: "dir" }],
    });
    expect(win.map((p) => [p.key, p.label])).toEqual([
      ["home", "me"],
      ["documents", "documents"],
    ]);
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
    const storage = memoryStorage();
    const edits = { added: ["/srv/work"], removed: ["/home/me/Desktop"] };
    saveQuickAccess(null, edits, storage);
    saveQuickAccess("m-1", NO_EDITS, storage);
    expect(loadQuickAccess(null, storage)).toEqual(edits);
    expect(loadQuickAccess("m-1", storage)).toEqual(NO_EDITS);
    storage.setItem(quickAccessKey("m-2"), "{not json");
    expect(loadQuickAccess("m-2", storage)).toEqual(NO_EDITS);
    storage.setItem(quickAccessKey("m-3"), JSON.stringify({ added: ["/a", 3, ""], removed: "x" }));
    expect(loadQuickAccess("m-3", storage)).toEqual({ added: ["/a"], removed: [] });
  });
});

describe("locations", () => {
  const names = {
    drives: {
      drive: "Local Disk",
      removable: "USB Drive",
      network: "Network Drive",
      optical: "CD Drive",
    },
    fileSystem: "File System",
  };
  const named = (locations: DirLocation[]) =>
    locationPlaces({ path: "/", parent: null, entries: [], locations }).map((p) => [
      p.key,
      locationName(p, names),
    ]);

  it("names a Windows drive as Explorer does: its label or its type, then its letter", () => {
    expect(
      named([
        { path: "C:\\", kind: "drive", label: "Windows" },
        { path: "D:\\", kind: "drive" },
        { path: "E:\\", kind: "removable" },
        { path: "F:\\", kind: "optical" },
        { path: "Z:\\", kind: "network", label: "\\\\nas\\media" },
        { path: "Y:\\", kind: "network" },
      ]),
    ).toEqual([
      ["drive", "Windows (C:)"],
      ["drive", "Local Disk (D:)"],
      ["removable", "USB Drive (E:)"],
      ["optical", "CD Drive (F:)"],
      ["network", "\\\\nas\\media (Z:)"],
      ["network", "Network Drive (Y:)"],
    ]);
  });

  it("names a Linux root as the file system, and anything else by its own name or its folder's", () => {
    expect(
      named([
        { path: "/", kind: "root" },
        { path: "/media/me/STICK", kind: "removable" },
        { path: "/mnt/c", kind: "drive", label: "C:" },
      ]),
    ).toEqual([
      ["root", "File System"],
      ["removable", "STICK"],
      ["drive", "C:"],
    ]);
    expect(
      named([
        { path: "/", kind: "volume", label: "Macintosh HD" },
        { path: "/Volumes/Backup", kind: "volume" },
      ]),
    ).toEqual([
      ["volume", "Macintosh HD"],
      ["volume", "Backup"],
    ]);
    // A machine reached over ssh reports none.
    expect(locationPlaces({ path: "/home/me", parent: "/home", entries: [] })).toEqual([]);
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

  it("resolves ~ against the machine's home, and a bare drive to its root", () => {
    expect(resolveGoTo("~/work", "/home/me")).toBe("/home/me/work");
    expect(resolveGoTo("~", "C:\\Users\\me")).toBe("C:\\Users\\me");
    expect(resolveGoTo(" /srv ", null)).toBe("/srv");
    expect(resolveGoTo("d:", null)).toBe("D:\\");
    expect(resolveGoTo(" D: ", "C:\\Users\\me")).toBe("D:\\");
    expect(resolveGoTo("D:\\work", null)).toBe("D:\\work");
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
  const base = { offered: true, stateDir: null, machine: null };

  it("is there whenever the host offers no folder", () => {
    expect(clearButton({ ...base, offered: false })).toBeNull();
    expect(clearButton(base)).not.toBeNull();
  });

  it("names the folder a temporary Workspace would get, in its tooltip", () => {
    expect(clearButton({ ...base, stateDir })).toEqual({
      fullPath: "/home/me/.penguin/data/default_project/agents/writer/workspaces/tmp-…",
    });
  });

  it("names none without the Agent's directory, or while another machine is browsed", () => {
    expect(clearButton(base)).toEqual({ fullPath: null });
    expect(clearButton({ ...base, stateDir, machine: "far" })).toEqual({ fullPath: null });
  });

  it("keeps a Windows path's separator, and names nothing for an unknown layout", () => {
    expect(tempWorkspacePath("C:\\Users\\me\\.penguin\\data\\p\\agents\\a\\agent_state")).toBe(
      "C:\\Users\\me\\.penguin\\data\\p\\agents\\a\\workspaces\\tmp-…",
    );
    expect(tempWorkspacePath("/srv/agents/a/state")).toBeNull();
    expect(tempWorkspacePath("/")).toBeNull();
  });
});
