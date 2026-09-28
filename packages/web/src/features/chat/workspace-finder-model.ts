/**
 * The Workspace finder's decisions, kept apart from the modal so they are testable without a
 * DOM: path breadcrumbs, back/forward history, what the list shows and in which order,
 * type-to-select, the sidebar's places, and the keyboard map.
 *
 * Paths come from whichever machine is being browsed, so nothing here asks the browser's own
 * platform about a path — a Windows server's `C:\Users\me` and a Linux one's `/home/me` both
 * have to split correctly in the same tab.
 */
import type { DirEntryInfo, DirListResponse } from "@prismshadow/penguin-server/api";
import {
  TEMP_WORKSPACE_GROUP_KEY,
  isTempWorkspace,
  workspaceGroupMachine,
  workspaceGroupPath,
} from "../../lib/session-grouping";

/** A path the dirs API accepts as-is: posix absolute, a drive path, or a UNC share. */
export function isAbsoluteDirPath(path: string): boolean {
  return /^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path);
}

/** One clickable breadcrumb: the label shown, and the absolute path it opens. */
export interface Crumb {
  label: string;
  path: string;
}

/**
 * The segments of an absolute path, root first, each carrying the path up to and including
 * it. The root keeps its own spelling (`/`, `C:\`, `\\server\share\`) because every other
 * segment is joined onto it with the separator that root implies.
 */
export function splitBreadcrumbs(path: string): Crumb[] {
  const p = path.trim();
  if (p === "") return [];
  let root: string;
  let rest: string;
  let sep: string;
  const unc = /^(\\\\[^\\]+\\[^\\]+)\\?(.*)$/.exec(p);
  const drive = /^([A-Za-z]:)[\\/]?(.*)$/.exec(p);
  if (unc) {
    root = `${unc[1]}\\`;
    rest = unc[2] ?? "";
    sep = "\\";
  } else if (drive) {
    root = `${drive[1]}\\`;
    rest = drive[2] ?? "";
    sep = "\\";
  } else {
    root = "/";
    rest = p.replace(/^\/+/, "");
    sep = "/";
  }
  const crumbs: Crumb[] = [{ label: root === "/" ? "/" : root.replace(/\\$/, ""), path: root }];
  let acc = root;
  for (const part of rest.split(/[\\/]+/).filter(Boolean)) {
    acc = acc.endsWith(sep) ? `${acc}${part}` : `${acc}${sep}${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

/** The folder above `path`, or null at a root — for a folder that failed to load, whose listing (and its `parent`) never arrived. */
export function parentOf(path: string): string | null {
  const crumbs = splitBreadcrumbs(path);
  return crumbs.length > 1 ? (crumbs[crumbs.length - 2]?.path ?? null) : null;
}

/** The last segment of a path, for a label and for picking a folder out of its parent. */
export function baseName(path: string): string {
  const crumbs = splitBreadcrumbs(path);
  return crumbs[crumbs.length - 1]?.label ?? path;
}

/** Back/forward history: the visited folders and where in them the finder stands. */
export interface NavHistory {
  entries: string[];
  index: number;
}

export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 };

/**
 * Visiting a folder: anything ahead of the current position is dropped, as in a browser. A
 * reload of the folder already shown is not a visit, or Back would have to be pressed twice.
 */
export function historyVisit(h: NavHistory, path: string): NavHistory {
  if (h.entries[h.index] === path) return h;
  const entries = [...h.entries.slice(0, h.index + 1), path];
  return { entries, index: entries.length - 1 };
}

/** One step back or forward; the same history when there is nowhere to go. */
export function historyStep(h: NavHistory, delta: -1 | 1): NavHistory {
  const index = h.index + delta;
  if (index < 0 || index >= h.entries.length) return h;
  return { entries: h.entries, index };
}

export const canGoBack = (h: NavHistory): boolean => h.index > 0;
export const canGoForward = (h: NavHistory): boolean => h.index < h.entries.length - 1;

/** Whether an entry is a folder: an entry with no kind came from a listing that reports folders only. */
export const isFolder = (entry: DirEntryInfo): boolean => entry.kind !== "file";

/**
 * What the list shows: hidden entries dropped, the filter applied (case-insensitive
 * substring), folders first and then by name.
 */
export function visibleEntries(entries: readonly DirEntryInfo[], filter: string): DirEntryInfo[] {
  const q = filter.trim().toLowerCase();
  return entries
    .filter((e) => !e.name.startsWith("."))
    .filter((e) => q === "" || e.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const fa = isFolder(a);
      if (fa !== isFolder(b)) return fa ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Type-to-select: the first selectable entry whose name starts with what has been typed,
 * ignoring case. Only folders can be selected, so a file never catches the prefix. -1 when
 * nothing matches, so the selection stays where it was.
 */
export function typeSelectIndex(entries: readonly DirEntryInfo[], typed: string): number {
  const q = typed.toLowerCase();
  if (q === "") return -1;
  return entries.findIndex((e) => isFolder(e) && e.name.toLowerCase().startsWith(q));
}

/**
 * The next selectable row from `from` in direction `delta`, skipping files; -1 when there is
 * none. From no selection (-1), Down lands on the first folder and Up on the last.
 */
export function stepSelection(
  entries: readonly DirEntryInfo[],
  from: number,
  delta: -1 | 1,
): number {
  let i = from === -1 ? (delta === 1 ? 0 : entries.length - 1) : from + delta;
  for (; i >= 0 && i < entries.length; i += delta) {
    const entry = entries[i];
    if (entry !== undefined && isFolder(entry)) return i;
  }
  return from;
}

/** A sidebar place. `key` picks its label and icon; `path` is what clicking it opens. */
export interface Place {
  key: "home" | "desktop" | "documents" | "downloads" | "drive";
  path: string;
  /** The label for places named by their path (home by its folder name, a drive by its letter). */
  label: string;
}

/** The standard folders offered under Favourites, in the order Finder lists them. */
const STANDARD_FOLDERS = [
  ["desktop", "Desktop"],
  ["documents", "Documents"],
  ["downloads", "Downloads"],
] as const;

/**
 * Favourites for one machine, from that machine's own home listing: home itself, the standard
 * folders that actually exist there, and — on Windows — the drive roots. The home listing is
 * the source rather than a guessed path because only that machine knows whether the folder is
 * there (a Linux server without a desktop has none of them). Windows keeps the same folder
 * names under the profile directory, but matches them ignoring case as its filesystem does.
 */
export function favouritePlaces(home: DirListResponse | null): Place[] {
  if (home === null) return [];
  const win = home.platform === "win32";
  const places: Place[] = [{ key: "home", path: home.path, label: baseName(home.path) }];
  for (const [key, name] of STANDARD_FOLDERS) {
    const found = home.entries.find(
      (e) => isFolder(e) && (win ? e.name.toLowerCase() === name.toLowerCase() : e.name === name),
    );
    if (found !== undefined) places.push({ key, path: found.path, label: found.name });
  }
  for (const root of home.roots ?? []) {
    places.push({ key: "drive", path: root, label: root.replace(/\\$/, "") });
  }
  return places;
}

/** A Workspace recently used in this Project, and the machine it is on (null: this server). */
export interface RecentWorkspace {
  path: string;
  machineId: string | null;
  /** Newest Session's createdAt there — what orders the list. */
  at: string;
}

/**
 * Recent Workspaces, newest first: the Sessions list already reports, per Agent, each
 * Workspace's newest Session (keyed by machine and path), so this folds those stamps across
 * Agents. Temporary Workspaces are left out — they are made per conversation and are never
 * worth picking again. `machines` restricts the list to the machines the finder may browse.
 */
export function recentWorkspaces(
  latestByAgent: ReadonlyMap<string, Readonly<Record<string, string>>>,
  machines: (machineId: string | null) => boolean,
  limit = 6,
): RecentWorkspace[] {
  const newest = new Map<string, RecentWorkspace>();
  for (const byGroup of latestByAgent.values()) {
    for (const [groupKey, at] of Object.entries(byGroup)) {
      const path = workspaceGroupPath(groupKey);
      if (path === TEMP_WORKSPACE_GROUP_KEY || isTempWorkspace(path)) continue;
      const machineId = workspaceGroupMachine(groupKey);
      if (!machines(machineId)) continue;
      const held = newest.get(groupKey);
      if (held === undefined || held.at < at) newest.set(groupKey, { path, machineId, at });
    }
  }
  return [...newest.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

/**
 * "Go to folder" input → the path to load: `~` and `~/…` resolve against the machine's home
 * when it is known (the dirs API takes absolute paths only); anything else is sent as typed
 * and the server decides.
 */
export function resolveGoTo(input: string, home: string | null): string {
  const p = input.trim();
  if (home === null) return p;
  if (p === "~") return home;
  const m = /^~[\\/](.*)$/.exec(p);
  if (m === null) return p;
  const sep = /^[A-Za-z]:|^\\\\/.test(home) ? "\\" : "/";
  return home.endsWith(sep) ? `${home}${m[1]}` : `${home}${sep}${m[1]}`;
}

/** What a key press asks the finder to do. */
export type FinderAction =
  "up" | "down" | "first" | "last" | "open" | "parent" | "back" | "forward" | "goto" | "choose";

/** The keyboard-event fields the map reads (a subset of KeyboardEvent, for tests). */
export type FinderKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/**
 * The finder's keyboard map. The modifier is ⌘ on a Mac and Ctrl elsewhere, so the Finder
 * chords (⌘↑ parent, ⌘↓ open, ⌘[ / ⌘] back and forward, ⌘⇧G go to folder) read the same
 * on every platform; Alt+arrows are accepted too off the Mac, where Explorer and the
 * browsers taught them. Plain arrows, Home/End and Enter are list keys — `inList` is false
 * for a text field, where they belong to the field (Up/Down excepted: the filter box steers
 * the list the way a combobox does).
 */
export function finderKeyAction(
  e: FinderKey,
  isMac: boolean,
  inList: boolean,
): FinderAction | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const bare = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (mod && e.shiftKey && !e.altKey && (e.key === "g" || e.key === "G")) return "goto";
  if (mod && !e.shiftKey && !e.altKey) {
    if (e.key === "ArrowUp") return "parent";
    if (e.key === "ArrowDown") return "open";
    if (e.key === "[") return "back";
    if (e.key === "]") return "forward";
    if (e.key === "Enter") return "choose";
  }
  if (!isMac && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") return "back";
    if (e.key === "ArrowRight") return "forward";
    if (e.key === "ArrowUp") return "parent";
  }
  if (!bare || e.shiftKey) return null;
  if (e.key === "ArrowDown") return "down";
  if (e.key === "ArrowUp") return "up";
  if (!inList) return null;
  if (e.key === "Home") return "first";
  if (e.key === "End") return "last";
  if (e.key === "Enter") return "open";
  return null;
}

/** Whether a key press is a character to feed type-to-select: one printable character, no modifier. */
export function isTypeSelectKey(e: FinderKey): boolean {
  return e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
}

/** How long type-to-select keeps adding to what was typed before starting over. */
export const TYPE_SELECT_RESET_MS = 900;
